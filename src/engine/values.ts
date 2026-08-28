import type {
  EnginePlayer,
  EngineSettings,
  LeagueShape,
  Position,
  ReplacementResult,
  ValuedPlayer,
} from './types';
import { makeCurve } from './rank';
import { buildPositionalCurves, type PositionalCurves, type RankInput } from './curves';
import {
  compareReplacement,
  observedReplacement,
  simulatedReplacement,
  type ReplacementComparison,
} from './replacement';

/**
 * Steps 4 and 5.
 *
 * The pipeline runs twice over identical league settings: once on dynasty
 * rankings producing long term value, once on redraft rankings producing win
 * now value. Both land in the same units, which is what makes them comparable.
 *
 * Long term value is NEVER computed by subtracting win now from dynasty.
 * Dynasty rank already represents the market's discounted sum of all future
 * seasons; subtracting produces a number that looks precise and is not. These
 * are two independent measurements.
 */

export interface HorizonResult {
  curves: PositionalCurves;
  replacement: ReplacementResult;
  observed?: ReplacementResult;
  simulated?: ReplacementResult;
  comparison?: ReplacementComparison[];
}

export interface PipelineInput {
  players: EnginePlayer[];
  shape: LeagueShape;
  settings: Pick<EngineSettings, 'lambda' | 'curve'>;
  /** playerId → owning roster id. Absent or empty means simulated mode. */
  ownership?: ReadonlyMap<string, number>;
  /** Force simulated replacement even when ownership is available. */
  forceSimulated?: boolean;
}

export interface PipelineResult {
  players: ValuedPlayer[];
  winNow: HorizonResult;
  longTerm: HorizonResult;
  mode: 'observed' | 'simulated';
}

function toRankInputs(
  players: EnginePlayer[],
  which: 'dynasty' | 'redraft',
): RankInput[] {
  return players.map((p) => ({
    id: p.id,
    position: p.position,
    overallRank: which === 'dynasty' ? p.dynastyOverallRank : p.redraftOverallRank,
    positionRank: which === 'dynasty' ? p.dynastyPositionRank : p.redraftPositionRank,
    rating: which === 'dynasty' ? p.dynastyRating : p.redraftRating,
  }));
}

function runHorizon(
  players: EnginePlayer[],
  which: 'dynasty' | 'redraft',
  input: PipelineInput,
): HorizonResult {
  const curve = makeCurve({ lambda: input.settings.lambda, kind: input.settings.curve });
  const curves = buildPositionalCurves(toRankInputs(players, which), curve);
  const simulated = simulatedReplacement(input.shape, curves);

  const hasOwnership = !!input.ownership && input.ownership.size > 0;
  if (!hasOwnership || input.forceSimulated) {
    return { curves, replacement: simulated, simulated };
  }

  const rostered = new Set(input.ownership!.keys());
  const observed = observedReplacement(curves, rostered);
  return {
    curves,
    replacement: observed,
    observed,
    simulated,
    comparison: compareReplacement(observed, simulated),
  };
}

/**
 * Step 4, signed. Positive beats the best free agent at the position, negative
 * loses to him. The replacement player himself is exactly zero by construction.
 */
export function valueOverReplacement(rating: number, replacement: number): number {
  return rating - replacement;
}

/**
 * Step 4, clamped. This is what the rest of the engine consumes: lineup
 * optimisation, roster strength, trades and picks all want MARGINAL value, and
 * a player who would never crack the lineup adds none. Only the display layer
 * wants the signed number.
 */
export function valueAboveReplacement(raw: number, replacement: number): number {
  return Math.max(0, raw - replacement);
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const winNow = runHorizon(input.players, 'redraft', input);
  const longTerm = runHorizon(input.players, 'dynasty', input);

  const valued: ValuedPlayer[] = input.players.map((p) => {
    const winNowRating = winNow.curves.values.get(p.id) ?? 0;
    const longTermRating = longTerm.curves.values.get(p.id) ?? 0;
    const winNowVar = valueOverReplacement(winNowRating, winNow.replacement.levels[p.position]);
    const longTermVar = valueOverReplacement(longTermRating, longTerm.replacement.levels[p.position]);
    return {
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      age: p.age,
      winNowRating,
      longTermRating,
      winNowVar,
      longTermVar,
      winNowRaw: winNowRating,
      longTermRaw: longTermRating,
      winNow: Math.max(0, winNowVar),
      longTerm: Math.max(0, longTermVar),
      // Compared on ratings, so the direction reflects the player rather than
      // the two positions' replacement levels happening to differ.
      timelineGap: winNowRating - longTermRating,
      ownerRosterId: input.ownership?.get(p.id) ?? null,
    };
  });

  return {
    players: valued,
    winNow,
    longTerm,
    mode: winNow.replacement.mode,
  };
}

/**
 * Step 6: the contention timeline slider.
 *   weight 1 = full contender, weight 0 = full rebuild.
 */
export function blendedValue(player: ValuedPlayer, weight: number): number {
  return weight * player.winNow + (1 - weight) * player.longTerm;
}

/** The 0-100 rating blended across the two horizons. Never clamped. */
export function blendedRating(player: ValuedPlayer, weight: number): number {
  return weight * player.winNowRating + (1 - weight) * player.longTermRating;
}

/** Signed value over replacement, blended across the two horizons. */
export function blendedVar(player: ValuedPlayer, weight: number): number {
  return weight * player.winNowVar + (1 - weight) * player.longTermVar;
}

/** Total blended value of a set of players, used by roster efficiency views. */
export function rosterValue(
  players: ValuedPlayer[],
  weight: number,
): { winNow: number; longTerm: number; blended: number } {
  let winNow = 0;
  let longTerm = 0;
  for (const p of players) {
    winNow += p.winNow;
    longTerm += p.longTerm;
  }
  return { winNow, longTerm, blended: weight * winNow + (1 - weight) * longTerm };
}

export function byPosition<T extends { position: Position }>(
  items: T[],
): Record<Position, T[]> {
  const out: Record<Position, T[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const item of items) out[item.position].push(item);
  return out;
}
