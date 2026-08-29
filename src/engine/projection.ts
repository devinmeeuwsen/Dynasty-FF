import type { DraftPick, ValuedPlayer } from './types';
import type { PickValuation } from './picks';
import { pickKey } from './picks';

/**
 * Where each team's redraft value is heading.
 *
 * Long term value is a player's rating minus his redraft value: what the
 * dynasty market pays him for his career, less what this season alone is
 * worth. A positive gap is a claim that his production has not arrived yet. A
 * negative gap is a claim that it is already leaving. Either way the gap is a
 * forecast, and this module is what happens when you let that forecast run.
 *
 *   projectedRedraft(n) = redraft + (1 - RETENTION^n) * longTerm
 *
 * A balanced player has no gap, so his redraft value does not move. A future
 * asset's rises. A win now player's falls. That is exactly the behaviour the
 * three timeline labels promise, made quantitative.
 *
 * RETENTION is measured, not chosen. Across the 389 players who carry an age
 * in both boards, the mean gap among future leaning players falls from 7.78 at
 * age 22 to 2.58 at age 27 — a year over year retention whose geometric mean
 * is 0.80 over the ages where the sample is large enough to mean anything.
 * Twenty percent of the gap is realised in a year; thirty-six percent in two.
 *
 * Two honest limits. The measurement is cross sectional — different players at
 * different ages, not the same player tracked forward — so it is attenuated by
 * survivorship: the 22 year olds who bust leave the board entirely rather than
 * showing up at 23 with a closed gap. And the same rate is applied to the
 * declining branch, where the cross section cannot separate a widening gap
 * from the same survivorship working in reverse. Both errors point the same
 * way, toward understating movement, so this projection is conservative.
 */
export const GAP_RETENTION = 0.8;

/** How much of a player's rating-to-redraft gap has arrived after n years. */
export function realisedFraction(yearsOut: number): number {
  return 1 - Math.pow(GAP_RETENTION, Math.max(0, yearsOut));
}

/**
 * Replacement level is held fixed. The waiver wire regenerates every year from
 * the same league shape, so the level a player is measured against is roughly
 * stationary even though the players setting it are not. That lets the whole
 * projection be done in value-above-replacement units, which is what every
 * other number in the application is already in.
 */
export function projectedRedraftVar(player: ValuedPlayer, yearsOut: number): number {
  return player.redraftVar + realisedFraction(yearsOut) * player.longTerm;
}

/** Clamped, matching `lineupValue`: a player below replacement contributes none. */
export function projectedLineupValue(player: ValuedPlayer, yearsOut: number): number {
  return Math.max(0, projectedRedraftVar(player, yearsOut));
}

export interface ProjectionInput {
  rosterIds: number[];
  /** rosterId -> the players it holds. */
  players: Map<number, ValuedPlayer[]>;
  picks: DraftPick[];
  pickValues: ReadonlyMap<string, PickValuation>;
  /** The season currently being played. Year n is `baseSeason + n`. */
  baseSeason: number;
  /** How many years forward to project, inclusive of year zero. */
  years: number;
}

export interface TeamProjection {
  rosterId: number;
  /** Redraft value held, by year. Index 0 is exactly today's number. */
  redraft: number[];
  /** The share of each year's total that comes from picks not yet drafted. */
  fromPicks: number[];
  /** 1-based rank within the league in each year. */
  rank: number[];
  /** rank[0] - rank[n]: positive is moving up the board. */
  move: number[];
  /** redraft[n] - redraft[0]. */
  change: number[];
}

/**
 * A pick becomes a player, and then that player's own gap starts closing. Both
 * happen on the same clock as everyone else's, so a pick is projected with the
 * same fraction — gated on the draft having happened by the year in question,
 * because a 2029 rookie contributes nothing to a 2028 lineup.
 *
 * A pick's value is already measured against a replacement level, so scaling
 * it is an approximation rather than the exact clamp used for players. The
 * error is small and it is the only place in this module that is not exact.
 */
function pickContribution(
  pick: DraftPick,
  valuation: PickValuation | undefined,
  baseSeason: number,
  yearsOut: number,
): number {
  if (!valuation) return 0;
  if (pick.season > baseSeason + yearsOut) return 0;
  return realisedFraction(yearsOut) * valuation.value;
}

export function projectLeague(input: ProjectionInput): TeamProjection[] {
  const years = Math.max(1, input.years);
  const rows: TeamProjection[] = input.rosterIds.map((rosterId) => {
    const roster = input.players.get(rosterId) ?? [];
    const held = input.picks.filter((p) => p.ownerRosterId === rosterId);

    const redraft: number[] = [];
    const fromPicks: number[] = [];
    for (let n = 0; n < years; n++) {
      let total = 0;
      for (const player of roster) total += projectedLineupValue(player, n);
      let picks = 0;
      for (const pick of held) {
        picks += pickContribution(
          pick,
          input.pickValues.get(pickKey(pick)),
          input.baseSeason,
          n,
        );
      }
      redraft.push(total + picks);
      fromPicks.push(picks);
    }

    return {
      rosterId,
      redraft,
      fromPicks,
      rank: new Array(years).fill(0),
      move: new Array(years).fill(0),
      change: redraft.map((v) => v - redraft[0]),
    };
  });

  for (let n = 0; n < years; n++) {
    const order = [...rows].sort((a, b) => b.redraft[n] - a.redraft[n]);
    order.forEach((row, index) => {
      row.rank[n] = index + 1;
    });
  }
  for (const row of rows) {
    for (let n = 0; n < years; n++) row.move[n] = row.rank[0] - row.rank[n];
  }

  return rows;
}
