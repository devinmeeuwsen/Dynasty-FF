import type { Position } from '../../engine/types';

/** One entry in a ranking list. */
export interface RankingEntry {
  name: string;
  position: Position;
  team: string | null;
  /** 1-based rank inside whichever list this entry came from. */
  rank: number;
  /**
   * A 0-100 market value, when the source publishes values rather than only an
   * ordering. KeepTradeCut does; a pasted FantasyPros export does not. Where
   * this is present the engine uses it directly and the rank→value curve is
   * bypassed entirely, because a value carries strictly more information than
   * the ordering it implies.
   */
  rating?: number;
  /**
   * Present ONLY for entries already keyed to Sleeper's own player ids. Never
   * set this from a foreign identifier: match_rankings trusts it and skips name
   * matching, and foreign id spaces collide with Sleeper's — 25 of KeepTradeCut's
   * mflids are also valid Sleeper ids belonging to different players.
   */
  sleeperId?: string;
  age?: number | null;
  tier?: number | null;
}

export type RankingHorizon = 'dynasty' | 'redraft';

/**
 * A board is identified by two league properties that genuinely change what a
 * player is worth, not by scoring in general.
 *
 *   quarterback demand — one starting quarterback, or superflex/2QB
 *   tight end premium — extra points per tight end reception
 *
 * Both move the market, and they move it for different positions, so a
 * superflex league with a tight end premium needs a board that is neither the
 * plain superflex board nor the plain premium one.
 */
export type QbFormat = 'standard' | 'superflex';
export type TePremium = 'base' | 'tep' | 'tepp' | 'teppp';
export type RankingFormat =
  | 'standard'
  | 'standard.tep'
  | 'standard.tepp'
  | 'standard.teppp'
  | 'superflex'
  | 'superflex.tep'
  | 'superflex.tepp'
  | 'superflex.teppp';

export function toRankingFormat(qb: QbFormat, te: TePremium): RankingFormat {
  return (te === 'base' ? qb : `${qb}.${te}`) as RankingFormat;
}

/**
 * Sleeper reports the premium as bonus points per tight end reception.
 * KeepTradeCut publishes boards at the three levels the market actually
 * trades, so anything in between snaps to the nearest one.
 */
export function tePremiumFor(bonusRecTe: number): TePremium {
  if (!Number.isFinite(bonusRecTe) || bonusRecTe <= 0.01) return 'base';
  if (bonusRecTe < 0.75) return 'tep';
  if (bonusRecTe < 1.25) return 'tepp';
  return 'teppp';
}

/**
 * The board a league should be priced on, straight from its own settings.
 *
 * This is the single place the decision is made, so the waiver wire, every
 * roster, the trade calculator and pick valuation all read the same board —
 * mixing boards between them would let a trade look profitable purely because
 * the two sides were priced on different markets.
 */
export function rankingFormatFor(shape: {
  superflex: boolean;
  tightEndPremium: number;
}): RankingFormat {
  return toRankingFormat(
    shape.superflex ? 'superflex' : 'standard',
    tePremiumFor(shape.tightEndPremium),
  );
}

/** The quarterback half of a format, ignoring any tight end premium. */
export function qbFormatOf(format: RankingFormat): QbFormat {
  return format.startsWith('superflex') ? 'superflex' : 'standard';
}

export interface RankingList {
  horizon: RankingHorizon;
  format: RankingFormat;
  /** 'overall' establishes the cross position value scale. */
  scope: 'overall' | Position;
  entries: RankingEntry[];
}

export interface RankingSet {
  id: string;
  label: string;
  /** ISO date the underlying rankings were published or captured. */
  asOf: string;
  provenance: string;
  lists: RankingList[];
}

/**
 * The ranking layer is an interface with three implementations. Two ship: a
 * bundled snapshot so the site works out of the box, and manual paste or file
 * import so a user can drop in their own FantasyPros export. The third,
 * automated refresh, is a stub — it needs a data partnership or a paid feed,
 * and scraping is not something this codebase does.
 */
export interface RankingSource {
  id: string;
  label: string;
  description: string;
  available: boolean;
  load(): Promise<RankingSet>;
}

/**
 * Exact board first, then the same quarterback format without the tight end
 * premium, then anything for this horizon.
 *
 * The order matters. An imported list that only carries plain superflex is a
 * better answer for a superflex premium league than a bundled one-quarterback
 * premium board, because getting quarterback demand wrong misprices a whole
 * starting slot while a missing premium misprices one position.
 */
export function findList(
  set: RankingSet,
  horizon: RankingHorizon,
  scope: RankingList['scope'],
  format: RankingFormat,
): RankingList | undefined {
  const here = (l: RankingList) => l.horizon === horizon && l.scope === scope;
  const qb = qbFormatOf(format);
  return (
    set.lists.find((l) => here(l) && l.format === format) ??
    set.lists.find((l) => here(l) && l.format === qb) ??
    set.lists.find((l) => here(l) && qbFormatOf(l.format) === qb) ??
    set.lists.find(here)
  );
}
