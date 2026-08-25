import type { Position } from '../../engine/types';

/** One entry in a ranking list. */
export interface RankingEntry {
  name: string;
  position: Position;
  team: string | null;
  /** 1-based rank inside whichever list this entry came from. */
  rank: number;
  /** Present only for entries that came in already keyed to Sleeper. */
  sleeperId?: string;
  age?: number | null;
  tier?: number | null;
}

export type RankingHorizon = 'dynasty' | 'redraft';
/** Leagues that start two quarterbacks need a differently shaped overall list. */
export type RankingFormat = 'standard' | 'superflex';

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

export function findList(
  set: RankingSet,
  horizon: RankingHorizon,
  scope: RankingList['scope'],
  format: RankingFormat,
): RankingList | undefined {
  return (
    set.lists.find(
      (l) => l.horizon === horizon && l.scope === scope && l.format === format,
    ) ?? set.lists.find((l) => l.horizon === horizon && l.scope === scope)
  );
}
