import type { Position } from '../../engine/types';
import type { RankingList, RankingSet, RankingSource } from './types';
import snapshot from './snapshots/bundled.json';

type PlayerRow = [name: string, position: string, team: string | null, age: number];

interface Snapshot {
  version: number;
  asOf: string;
  provenance: string;
  players: Record<string, PlayerRow>;
  lists: Record<string, string[]>;
}

const data = snapshot as unknown as Snapshot;

function toList(
  key: string,
  horizon: RankingList['horizon'],
  scope: RankingList['scope'],
  format: RankingList['format'],
): RankingList | null {
  const ids = data.lists[key];
  if (!ids) return null;
  return {
    horizon,
    scope,
    format,
    entries: ids.map((id, index) => {
      const [name, position, team, age] = data.players[id];
      return {
        name,
        position: position as Position,
        team,
        age,
        rank: index + 1,
        sleeperId: id,
      };
    }),
  };
}

export function bundledRankingSet(): RankingSet {
  const lists = [
    toList('redraft.overall.standard', 'redraft', 'overall', 'standard'),
    toList('redraft.overall.superflex', 'redraft', 'overall', 'superflex'),
    toList('dynasty.overall.standard', 'dynasty', 'overall', 'standard'),
    toList('dynasty.overall.superflex', 'dynasty', 'overall', 'superflex'),
    toList('redraft.QB', 'redraft', 'QB', 'standard'),
    toList('redraft.QB', 'redraft', 'QB', 'superflex'),
    toList('redraft.TE', 'redraft', 'TE', 'standard'),
    toList('redraft.TE', 'redraft', 'TE', 'superflex'),
    toList('dynasty.QB', 'dynasty', 'QB', 'standard'),
    toList('dynasty.QB', 'dynasty', 'QB', 'superflex'),
    toList('dynasty.TE', 'dynasty', 'TE', 'standard'),
    toList('dynasty.TE', 'dynasty', 'TE', 'superflex'),
  ].filter(Boolean) as RankingList[];

  return {
    id: 'bundled',
    label: `Bundled snapshot · ${data.asOf}`,
    asOf: data.asOf,
    provenance: data.provenance,
    lists,
  };
}

export const bundledSource: RankingSource = {
  id: 'bundled',
  label: 'Bundled snapshot',
  description:
    'Ships with the app so it works out of the box. Approximated from public data, ' +
    'not a copy of any subscription ranking product.',
  available: true,
  load: async () => bundledRankingSet(),
};

/** Every player the bundled snapshot knows about, for name matching fallbacks. */
export function bundledPlayerPool() {
  return Object.entries(data.players).map(([id, [name, position, team, age]]) => ({
    id,
    name,
    position: position as Position,
    team,
    age,
  }));
}
