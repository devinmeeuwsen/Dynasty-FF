import type {
  DraftPick,
  EngineSettings,
  FinishMatrix,
  Position,
  ReplacementLevels,
} from './types';
import type { RankToValue } from './rank';

/**
 * Draft pick ownership and valuation.
 *
 * A pick's value depends on where it will land, and where it lands depends on
 * the finish of the team that ORIGINALLY owned it, not the team holding it
 * now. That distinction is load bearing and the lazy version — a pick belongs
 * to whoever holds it — is never implemented here.
 */

export interface TradedPickRecord {
  season: string | number;
  round: number;
  /** Sleeper calls this roster_id: the ORIGINAL owning roster. */
  roster_id: number;
  owner_id: number;
  previous_owner_id?: number;
}

export function pickKey(pick: DraftPick): string {
  return `${pick.season}-${pick.round}-${pick.originalRosterId}`;
}

/**
 * Start from the assumption that every team owns all of its own picks in every
 * covered season, then apply the traded picks list. The result is exact
 * ownership of every future pick in the league.
 */
export function buildPickOwnership(
  rosterIds: number[],
  seasons: number[],
  rounds: number,
  traded: TradedPickRecord[],
): DraftPick[] {
  const picks = new Map<string, DraftPick>();
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (const rosterId of rosterIds) {
        const pick: DraftPick = {
          season,
          round,
          originalRosterId: rosterId,
          ownerRosterId: rosterId,
        };
        picks.set(pickKey(pick), pick);
      }
    }
  }

  const known = new Set(rosterIds);
  for (const record of traded) {
    const season = Number(record.season);
    if (!seasons.includes(season)) continue;
    if (record.round < 1 || record.round > rounds) continue;
    if (!known.has(record.roster_id) || !known.has(record.owner_id)) continue;
    const key = `${season}-${record.round}-${record.roster_id}`;
    const existing = picks.get(key);
    if (existing) existing.ownerRosterId = record.owner_id;
  }

  return [...picks.values()];
}

/**
 * Rookie picks are not position specific, so a pick is valued against a blend
 * of the four positional replacement levels weighted by how rookie draft
 * capital actually gets spent.
 */
export const ROOKIE_POSITION_MIX: Record<Position, number> = {
  WR: 0.45,
  RB: 0.3,
  QB: 0.15,
  TE: 0.1,
};

export function genericReplacement(levels: ReplacementLevels): number {
  let sum = 0;
  for (const pos of Object.keys(ROOKIE_POSITION_MIX) as Position[]) {
    sum += ROOKIE_POSITION_MIX[pos] * levels[pos];
  }
  return sum;
}

/**
 * Historical hit rate by draft slot, expressed as the overall dynasty rank a
 * pick at that slot returns in expectation:
 *
 *   effectiveRank(slot) = pickBaseRank * slot^pickExponent
 *
 * With the defaults, 1.01 returns roughly the dynasty rank 14 asset, 1.06
 * roughly rank 41, 1.12 roughly rank 63, 2.01 roughly rank 67 and 3.12 fades
 * into the replacement pool. The curve is deliberately concave: the gap
 * between 1.01 and 1.04 is far larger than the gap between 2.04 and 2.07,
 * which is what rookie pick markets actually price.
 */
export function pickSlotValue(
  overallSlot: number,
  curve: RankToValue,
  replacement: number,
  settings: Pick<EngineSettings, 'pickBaseRank' | 'pickExponent'>,
): number {
  const effectiveRank = settings.pickBaseRank * Math.pow(Math.max(1, overallSlot), settings.pickExponent);
  return Math.max(0, curve(effectiveRank) - replacement);
}

export interface PickValuationContext {
  /** Draft slot probabilities per team, from the simulation. */
  draftSlots: FinishMatrix;
  teams: number;
  /** The long term rank→value curve. Picks are always valued in long term units. */
  curve: RankToValue;
  longTermReplacement: ReplacementLevels;
  settings: Pick<
    EngineSettings,
    'pickBaseRank' | 'pickExponent' | 'futureDiscountPerYear' | 'futureUncertaintyPerYear'
  >;
  /** The season whose draft happens next. Picks beyond it are discounted. */
  nextDraftSeason: number;
}

export interface PickValuation {
  key: string;
  pick: DraftPick;
  value: number;
  /** Probability distribution over draft slots actually used, after widening. */
  slotDistribution: number[];
  /** Expected draft slot, for display only. Never used in the math. */
  expectedSlot: number;
  /** 10th and 90th percentile slot, so the interface can show a range. */
  slotRange: [number, number];
}

/**
 * A team projected tenth still finishes fourth sometimes, so a pick is always
 * valued across the whole row of the draft slot matrix. Point estimates of
 * finish are never used: they would make pick values look far more precise
 * than they are and would make the dead zone warning fire on noise.
 */
export function valuePick(
  pick: DraftPick,
  ctx: PickValuationContext,
): PickValuation {
  const rowIndex = ctx.draftSlots.rosterIds.indexOf(pick.originalRosterId);
  const teams = ctx.teams;
  const uniform = 1 / teams;
  const yearsOut = Math.max(0, pick.season - ctx.nextDraftSeason);

  const base =
    rowIndex >= 0 ? ctx.draftSlots.rows[rowIndex] : new Array(teams).fill(uniform);

  // Seasons further out are genuinely less predictable. Widening the
  // distribution toward uniform is honest about that; leaving it narrow would
  // make a 2028 pick look as knowable as a 2027 one.
  const widen = Math.min(0.95, ctx.settings.futureUncertaintyPerYear * yearsOut);
  const slotDistribution = base.map((p) => (1 - widen) * p + widen * uniform);

  const discount = Math.pow(ctx.settings.futureDiscountPerYear, yearsOut);

  let value = 0;
  let expectedSlot = 0;
  for (let i = 0; i < slotDistribution.length; i++) {
    const overallSlot = (pick.round - 1) * teams + (i + 1);
    value +=
      slotDistribution[i] *
      pickSlotValue(overallSlot, ctx.curve, genericReplacement(ctx.longTermReplacement), ctx.settings);
    expectedSlot += slotDistribution[i] * (i + 1);
  }

  return {
    key: pickKey(pick),
    pick,
    value: value * discount,
    slotDistribution,
    expectedSlot,
    slotRange: percentileRange(slotDistribution, pick.round, teams),
  };
}

function percentileRange(
  distribution: number[],
  round: number,
  teams: number,
): [number, number] {
  let cumulative = 0;
  let low = 1;
  let high = distribution.length;
  for (let i = 0; i < distribution.length; i++) {
    cumulative += distribution[i];
    if (cumulative >= 0.1 && low === 1) low = i + 1;
    if (cumulative >= 0.9) {
      high = i + 1;
      break;
    }
  }
  return [(round - 1) * teams + low, (round - 1) * teams + high];
}

export function valueAllPicks(
  picks: DraftPick[],
  ctx: PickValuationContext,
): Map<string, PickValuation> {
  const out = new Map<string, PickValuation>();
  for (const pick of picks) out.set(pickKey(pick), valuePick(pick, ctx));
  return out;
}

export function pickLabel(pick: DraftPick, teamName?: string): string {
  const suffix = teamName ? ` (${teamName})` : '';
  return `${pick.season} ${ordinalRound(pick.round)}${suffix}`;
}

function ordinalRound(round: number): string {
  const names = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
  return names[round - 1] ?? `${round}th`;
}

/** Total draft capital held by one roster. */
export function draftCapital(
  picks: DraftPick[],
  valuations: Map<string, PickValuation>,
  rosterId: number,
): number {
  let sum = 0;
  for (const pick of picks) {
    if (pick.ownerRosterId !== rosterId) continue;
    sum += valuations.get(pickKey(pick))?.value ?? 0;
  }
  return sum;
}

/** Reconciliation used by the interface and by the ownership test. */
export interface OwnershipAudit {
  totalPicks: number;
  expectedPicks: number;
  duplicated: string[];
  unowned: string[];
  ok: boolean;
}

export function auditOwnership(
  picks: DraftPick[],
  rosterIds: number[],
  seasons: number[],
  rounds: number,
): OwnershipAudit {
  const seen = new Map<string, number>();
  const unowned: string[] = [];
  const owners = new Set(rosterIds);
  for (const pick of picks) {
    const key = pickKey(pick);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!owners.has(pick.ownerRosterId)) unowned.push(key);
  }
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const expectedPicks = rosterIds.length * rounds * seasons.length;
  return {
    totalPicks: picks.length,
    expectedPicks,
    duplicated,
    unowned,
    ok: picks.length === expectedPicks && duplicated.length === 0 && unowned.length === 0,
  };
}
