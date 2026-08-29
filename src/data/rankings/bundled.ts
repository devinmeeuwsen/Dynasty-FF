import type { Position } from '../../engine/types';
import type { QbFormat, RankingList, RankingSet, RankingSource, TePremium } from './types';
import { toRankingFormat } from './types';
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
  /** Tight ends only, keyed `${horizon}.${qb}.${variant}`. */
  teOverrides: Record<string, [key: string, rating: number][]>;
}

const data = snapshot as unknown as Snapshot;

const TE_VARIANTS: TePremium[] = ['tep', 'tepp', 'teppp'];

/**
 * A tight end premium board is the base board with its tight ends repriced.
 * Storing it that way keeps the snapshot small without approximating anything:
 * the build asserts that no other position moves, so the merge is exact.
 */
function mergeBoard(
  horizon: RankingList['horizon'],
  qb: QbFormat,
  te: TePremium,
): [string, number][] | null {
  const base = data.boards[`${horizon}.${qb}`];
  if (!base) return null;
  if (te === 'base') return base;
  const override = data.teOverrides?.[`${horizon}.${qb}.${te}`];
  if (!override) return base;
  const repriced = new Map(override);
  return base
    .map(([id, rating]) => [id, repriced.get(id) ?? rating] as [string, number])
    // Repricing tight ends reorders the board, so it is re-sorted rather than
    // left in base order — rank is read off this array.
    .sort((a, b) => b[1] - a[1]);
}

function toBoard(
  horizon: RankingList['horizon'],
  qb: QbFormat,
  te: TePremium,
): RankingList | null {
  const board = mergeBoard(horizon, qb, te);
  const format = toRankingFormat(qb, te);
  if (!board) return null;
  return {
    horizon,
    // KeepTradeCut publishes one cross-positional scale per format, so the
    // overall board is the whole story: there are no positional lists to
    // reconcile against it.
    scope: 'overall',
    format,
    entries: board.map(([playerKey, rating]: [string, number], index: number) => {
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
  const lists: RankingList[] = [];
  for (const horizon of ['dynasty', 'redraft'] as const) {
    for (const qb of ['standard', 'superflex'] as const) {
      for (const te of ['base', ...TE_VARIANTS] as TePremium[]) {
        const list = toBoard(horizon, qb, te);
        if (list) lists.push(list);
      }
    }
  }

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
