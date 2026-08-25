import type { EnginePlayer, Position } from '../engine/types';
import { POSITIONS } from '../engine/types';
import { matchRankings, normalizeName, type MatchCandidate } from './names';
import type { RankingFormat, RankingSet } from './rankings/types';
import { findList } from './rankings/types';

/**
 * Bridge between the data layer and the engine.
 *
 * Takes a ranking set, the pool of players the league actually knows about,
 * and the league's format, and produces the EnginePlayer list the value
 * pipeline consumes. Players that appear on a roster but in no ranking list
 * are carried through as unranked rather than dropped — they are real players
 * occupying real roster spots, and dropping them would quietly change
 * replacement level.
 */

export interface AssembleInput {
  set: RankingSet;
  format: RankingFormat;
  pool: MatchCandidate[];
  /** Player ids that must appear in the output even when unranked. */
  required?: Iterable<string>;
  /** Persisted manual name mappings: normalised name → player id. */
  overrides?: ReadonlyMap<string, string>;
}

export interface UnmatchedEntry {
  name: string;
  position: Position;
  team: string | null;
  lists: string[];
}

export interface AssembleResult {
  players: EnginePlayer[];
  unmatched: UnmatchedEntry[];
  fuzzy: { name: string; matchedTo: string; rule: string }[];
  coverage: {
    dynastyOverall: number;
    redraftOverall: number;
    dynastyPositional: Partial<Record<Position, number>>;
    redraftPositional: Partial<Record<Position, number>>;
  };
  formatUsed: RankingFormat;
}

type RankField =
  | 'dynastyOverallRank'
  | 'redraftOverallRank'
  | 'dynastyPositionRank'
  | 'redraftPositionRank';

export function assemblePlayers(input: AssembleInput): AssembleResult {
  const overrides = input.overrides ?? new Map<string, string>();
  const byId = new Map(input.pool.map((p) => [p.id, p]));

  const ranks = new Map<string, Partial<Record<RankField, number>>>();
  const unmatchedByName = new Map<string, UnmatchedEntry>();
  const fuzzy: AssembleResult['fuzzy'] = [];

  const apply = (
    listKey: string,
    scope: 'overall' | Position,
    horizon: 'dynasty' | 'redraft',
    field: RankField,
  ): number => {
    const list = findList(input.set, horizon, scope, input.format);
    if (!list) return 0;

    const result = matchRankings(list.entries, input.pool, overrides);
    fuzzy.push(...result.fuzzy);

    for (const entry of result.unmatched) {
      const key = normalizeName(entry.name);
      const existing = unmatchedByName.get(key);
      if (existing) existing.lists.push(listKey);
      else unmatchedByName.set(key, { ...entry, lists: [listKey] });
    }

    let matchedCount = 0;
    for (const entry of list.entries) {
      const id = result.matched.get(normalizeName(entry.name));
      if (!id) continue;
      matchedCount += 1;
      const current = ranks.get(id) ?? {};
      // Keep the best rank if a player somehow appears twice in one list.
      if (current[field] == null || entry.rank < (current[field] as number)) {
        current[field] = entry.rank;
      }
      ranks.set(id, current);
    }
    return matchedCount;
  };

  const dynastyOverall = apply('dynasty overall', 'overall', 'dynasty', 'dynastyOverallRank');
  const redraftOverall = apply('redraft overall', 'overall', 'redraft', 'redraftOverallRank');

  const dynastyPositional: Partial<Record<Position, number>> = {};
  const redraftPositional: Partial<Record<Position, number>> = {};
  for (const position of POSITIONS) {
    const d = apply(`dynasty ${position}`, position, 'dynasty', 'dynastyPositionRank');
    if (d > 0) dynastyPositional[position] = d;
    const r = apply(`redraft ${position}`, position, 'redraft', 'redraftPositionRank');
    if (r > 0) redraftPositional[position] = r;
  }

  // Where no positional list exists — running back and wide receiver always,
  // and quarterback or tight end when a user only imported an overall list —
  // derive the ordering from the overall list. The engine reads the scale from
  // overall regardless, so this only ever supplies ordering.
  fillPositionalFromOverall(ranks, byId, 'dynastyOverallRank', 'dynastyPositionRank');
  fillPositionalFromOverall(ranks, byId, 'redraftOverallRank', 'redraftPositionRank');

  const ids = new Set<string>(ranks.keys());
  for (const id of input.required ?? []) if (byId.has(id)) ids.add(id);

  const players: EnginePlayer[] = [];
  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    const r = ranks.get(id) ?? {};
    players.push({
      id,
      name: candidate.name,
      position: candidate.position,
      team: candidate.team,
      age: (candidate as MatchCandidate & { age?: number }).age ?? null,
      dynastyOverallRank: r.dynastyOverallRank ?? null,
      redraftOverallRank: r.redraftOverallRank ?? null,
      dynastyPositionRank: r.dynastyPositionRank ?? null,
      redraftPositionRank: r.redraftPositionRank ?? null,
    });
  }

  return {
    players,
    unmatched: [...unmatchedByName.values()],
    fuzzy,
    coverage: { dynastyOverall, redraftOverall, dynastyPositional, redraftPositional },
    formatUsed: input.format,
  };
}

function fillPositionalFromOverall(
  ranks: Map<string, Partial<Record<RankField, number>>>,
  byId: Map<string, MatchCandidate>,
  overallField: RankField,
  positionField: RankField,
): void {
  const buckets: Record<Position, { id: string; rank: number }[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };
  for (const [id, r] of ranks) {
    if (r[positionField] != null) continue;
    const overall = r[overallField];
    if (overall == null) continue;
    const position = byId.get(id)?.position;
    if (!position) continue;
    buckets[position].push({ id, rank: overall });
  }
  for (const position of POSITIONS) {
    const list = buckets[position].sort((a, b) => a.rank - b.rank);
    // Start after any ranks the positional list already assigned, so the two
    // sources never collide on the same slot.
    let next = 1;
    const taken = new Set<number>();
    for (const [id, r] of ranks) {
      if (byId.get(id)?.position === position && r[positionField] != null) {
        taken.add(r[positionField] as number);
      }
    }
    for (const entry of list) {
      while (taken.has(next)) next += 1;
      const current = ranks.get(entry.id) ?? {};
      current[positionField] = next;
      ranks.set(entry.id, current);
      taken.add(next);
    }
  }
}
