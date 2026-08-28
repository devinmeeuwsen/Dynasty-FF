import type { Position } from '../../engine/types';
import type { RankingList, RankingSet, RankingSource } from './types';
import snapshot from './snapshots/bundled.json';

type PlayerRow = [name: string, position: string, team: string | null, age: number | null];

/**
 * Snapshot format 2: KeepTradeCut market values.
 *
 * Boards carry [playerKey, rating] pairs on a 0-100 scale rather than a bare
 * ordering. The keys are KeepTradeCut mflids and are NOT Sleeper ids, so
 * entries deliberately omit `sleeperId` and go through name matching.
 */
interface Snapshot {
  version: number;
  source: string;
  asOf: string;
  provenance: string;
  attribution: { name: string; url: string };
  players: Record<string, PlayerRow>;
  boards: Record<string, [key: string, rating: number][]>;
}

const data = snapshot as unknown as Snapshot;

function toBoard(
  key: string,
  horizon: RankingList['horizon'],
  format: RankingList['format'],
): RankingList | null {
  const board = data.boards[key];
  if (!board) return null;
  return {
    horizon,
    // KeepTradeCut publishes one cross-positional scale per format, so the
    // overall board is the whole story: there are no positional lists to
    // reconcile against it.
    scope: 'overall',
    format,
    entries: board.map(([playerKey, rating], index) => {
      const [name, position, team, age] = data.players[playerKey];
      return {
        name,
        position: position as Position,
        team,
        age,
        rank: index + 1,
        rating,
      };
    }),
  };
}

export function bundledRankingSet(): RankingSet {
  const lists = [
    toBoard('redraft.standard', 'redraft', 'standard'),
    toBoard('redraft.superflex', 'redraft', 'superflex'),
    toBoard('dynasty.standard', 'dynasty', 'standard'),
    toBoard('dynasty.superflex', 'dynasty', 'superflex'),
  ].filter(Boolean) as RankingList[];

  return {
    id: 'bundled',
    label: `${data.attribution.name} · ${data.asOf}`,
    asOf: data.asOf,
    provenance: data.provenance,
    lists,
  };
}

export const bundledSource: RankingSource = {
  id: 'bundled',
  label: `${data.attribution.name} market values`,
  description:
    'Crowdsourced dynasty and redraft values from KeepTradeCut, rescaled to 0-100. ' +
    'Captured at build time and shipped with the app, so the site works out of the box ' +
    'and a visit costs KeepTradeCut nothing.',
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
