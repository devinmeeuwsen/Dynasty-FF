import type {
  DraftPick,
  EngineSettings,
  FinishMatrix,
  Position,
  ReplacementLevels,
} from './types';
import type { RankToValue } from './rank';
import { pickSlotRating, type PickBoard } from './pickValues';

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
  /**
   * Published rookie pick values. Present for a real league; absent only in
   * fixtures, where the legacy curve below stands in.
   */
  pickBoard?: PickBoard;
  /** Fallback rank→value curve for when no pick board is available. */
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
  /**
   * Long term value over replacement, which is what the engine trades on.
   * Picks have no win now number by construction: a future rookie plays no
   * games this season.
   */
  value: number;
  /**
   * The 0-100 market rating, on the same scale as a player's. This is the
   * number to show next to players; `value` is the number to do arithmetic
   * with, exactly as with a player's rating and VAR.
   */
  rating: number;
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

  const replacement = genericReplacement(ctx.longTermReplacement);

  // The published board already prices a further-out draft lower, so applying
  // `futureDiscountPerYear` on top of it would discount the same year twice.
  // It survives only on the fallback path, where nothing else encodes distance.
  const discount = ctx.pickBoard
    ? 1
    : Math.pow(ctx.settings.futureDiscountPerYear, yearsOut);

  let rating = 0;
  let expectedSlot = 0;
  for (let i = 0; i < slotDistribution.length; i++) {
    const slotInRound = i + 1;
    const slotRating = ctx.pickBoard
      ? pickSlotRating(
          ctx.pickBoard,
          ctx.nextDraftSeason,
          pick.season,
          pick.round,
          slotInRound,
          teams,
        )
      : ctx.curve(
          ctx.settings.pickBaseRank *
            Math.pow(Math.max(1, (pick.round - 1) * teams + slotInRound), ctx.settings.pickExponent),
        );
    // Every slot is weighted by how likely this pick is to land there, so a
    // team 50% to finish last contributes half of a 1.01 and nothing is ever
    // valued off a point estimate of where a team will end up.
    rating += slotDistribution[i] * slotRating;
    expectedSlot += slotDistribution[i] * slotInRound;
  }

  rating *= discount;

  return {
    key: pickKey(pick),
    pick,
    rating,
    value: Math.max(0, rating - replacement),
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
  // `found` rather than testing `low === 1`: the sentinel collided with a
  // legitimate first slot, so a pick 50% likely to be the 1.01 reported its
  // range as starting at 2.
  let found = false;
  for (let i = 0; i < distribution.length; i++) {
    cumulative += distribution[i];
    if (!found && cumulative >= 0.1) {
      low = i + 1;
      found = true;
    }
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

/**
 * `2027 2nd Rd (elikuiper)`.
 *
 * The name in parentheses is the ORIGINAL owner, not whoever holds the pick.
 * That is the half that carries information: the holder is already obvious
 * from where the pick is listed, while the originator is what decides where it
 * lands and therefore what it is worth.
 */
export function pickLabel(pick: DraftPick, originalOwnerName?: string): string {
  const suffix = originalOwnerName ? ` (${originalOwnerName})` : '';
  return `${pick.season} ${ordinalRound(pick.round)} Rd${suffix}`;
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
