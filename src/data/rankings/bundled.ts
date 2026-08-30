import type { Position } from '../../engine/types';
import type { QbFormat, RankingFormat, RankingList, RankingSet, RankingSource, TePremium } from './types';
import { toRankingFormat, qbFormatOf } from './types';
import type { PickBoard, PickTiers } from '../../engine/pickValues';
import snapshot from './snapshots/bundled.json';

type PlayerRow = [name: string, position: string, team: string | null, age: number | null];

/**
 * Snapshot format 3: two sources, one scale.
 *
 * KeepTradeCut supplies the dynasty board — a player's Rating — and the rookie
 * pick tiers. FantasyPros supplies the redraft ORDER. Boards carry
 * [playerKey, rating] pairs on a 0-100 scale rather than a bare ordering.
 *
 * The keys are KeepTradeCut mflids and are NOT Sleeper ids, so entries
 * deliberately omit `sleeperId` and go through name matching.
 */
interface Snapshot {
  version: number;
  source: string;
  asOf: string;
  provenance: string;
  attribution: { name: string; url: string; supplies: string }[];
  players: Record<string, PlayerRow>;
  boards: Record<string, [key: string, rating: number][]>;
  /** Tight ends only, keyed `${horizon}.${qb}.${variant}`. */
  teOverrides: Record<string, [key: string, rating: number][]>;
  /** Rookie pick tier anchors, by quarterback format then year then round. */
  rookiePicks: Record<string, Record<string, Record<string, PickTiers>>>;
  pickYearDecay: Record<string, number>;
  /**
   * FantasyPros expert consensus ORDER, plus the exponential curve fitted to
   * KeepTradeCut's redraft board that turns a rank into a 0-100 value.
   */
  redraft: Record<string, { scale: number; lambda: number; ranks: [string, number][] }>;
  /** Mean tight end lift per premium variant, keyed `${horizon}.${qb}.${variant}`. */
  teLift: Record<string, number>;
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

/**
 * How many top ranks get a flattened shoulder, and how sharply.
 *
 * The dynasty ladder cliffs early — 100, 100, 99.9, then 92.3 — because a
 * handful of young cornerstones sit clustered at a dynasty market's ceiling.
 * Read straight, that cliff invents a seven point gap between the second and
 * fourth best players for THIS season, who are interchangeable. A cubic
 * shoulder over the top eight spreads it: the first four now sit within two
 * points, and rank eight onward is the untouched ladder.
 */
const SHOULDER_RANKS = 8;
const SHOULDER_POWER = 3;

/**
 * The redraft board: FantasyPros' order, priced on a shouldered dynasty ladder.
 *
 * The ORDER is FantasyPros' because a hundred analysts updated daily beat a
 * trade market at predicting this season. The VALUES come from the dynasty
 * ladder read by rank position, because long term value is the DIFFERENCE
 * between a player's rating and his redraft value, and a difference is only
 * meaningful when both sides are drawn from the same distribution.
 *
 * Three earlier attempts failed in ways worth recording. Fitting an exponential
 * to the redraft market gave an intercept of 84.3 against the dynasty board's
 * 100, capping the best redraft asset sixteen points below the best dynasty one
 * so that anyone elite in both read as future leaning. Using KeepTradeCut's own
 * redraft ladder fixed the ceiling but left the same top cliff. Hand shaping a
 * logistic — flat top, curve, flat tail — gave the shoulder but collapsed to a
 * floor of 6 by rank 200 while dynasty ratings there are near 29, which pushed
 * the median difference to +10 and read almost every deep player as a future
 * asset.
 *
 * Sharing one distribution and smoothing only its shoulder keeps the median at
 * zero across four hundred players while leaving the top flat.
 *
 * FantasyPros publishes no tight end premium variant, so the average lift from
 * KeepTradeCut's premium boards is applied to tight ends here.
 */
function shoulderedLadder(values: number[]): number[] {
  if (values.length < SHOULDER_RANKS) return values;
  const top = values[0];
  const join = values[SHOULDER_RANKS - 1];
  return values.map((v, i) => {
    const rank = i + 1;
    if (rank >= SHOULDER_RANKS) return v;
    return top - (top - join) * Math.pow((rank - 1) / (SHOULDER_RANKS - 1), SHOULDER_POWER);
  });
}

/**
 * How far back to measure the ladder's final slope, and the floor every
 * published rating is held above.
 *
 * The window exists because the bottom of a crowdsourced board is its noisiest
 * region. An earlier version read the slope off the last two entries alone,
 * which held while those happened to be near-identical and then broke the day
 * they were not: the dynasty superflex board ended 4.70, 1.20, the implied
 * ratio fell from 0.999 to the 0.9 floor, and FantasyPros' superflex list runs
 * fifty-nine ranks past the end of that ladder — enough for 4.6 x 0.9^59 to
 * round to 0.0 and hand seven players a rating of zero. A slope averaged over
 * twenty-five entries cannot be moved that far by one player.
 *
 * The floor is the belt to that braces. A rating of 0.0 is not "nearly
 * worthless" to anything downstream; it is indistinguishable from absent, and
 * a board should never publish one whatever the arithmetic upstream does.
 */
export const TAIL_WINDOW = 25;
const MIN_RATING = 0.1;

/**
 * Past the end of the ladder, continue its slope geometrically rather than
 * dropping to zero — a deep player is cheap, not worthless.
 */
export function tailRatio(ladder: number[]): number {
  const n = ladder.length;
  if (n < 2) return 0.98;
  const span = Math.min(TAIL_WINDOW, n - 1);
  const from = ladder[n - 1 - span];
  const to = ladder[n - 1];
  if (!(from > 0) || !(to > 0)) return 0.98;
  return Math.min(0.999, Math.max(0.9, Math.pow(to / from, 1 / span)));
}

function redraftBoard(qb: QbFormat, te: TePremium): [string, number][] | null {
  const source = data.redraft?.[qb];
  const scaleBoard = data.boards[`dynasty.${qb}`];
  if (!source || source.ranks.length === 0 || !scaleBoard?.length) return null;

  const ladder = shoulderedLadder(scaleBoard.map(([, rating]) => rating));
  const lift = te === 'base' ? 1 : (data.teLift?.[`redraft.${qb}.${te}`] ?? 1);
  const ratio = tailRatio(ladder);

  return source.ranks
    .map(([key, rank]) => {
      const raw =
        rank <= ladder.length
          ? ladder[rank - 1]
          : ladder[ladder.length - 1] * Math.pow(ratio, rank - ladder.length);
      const rating = data.players[key]?.[1] === 'TE' ? raw * lift : raw;
      return [key, Math.round(rating * 10) / 10] as [string, number];
    })
    .sort((a, b) => b[1] - a[1]);
}

function toBoard(
  horizon: RankingList['horizon'],
  qb: QbFormat,
  te: TePremium,
): RankingList | null {
  const board = horizon === 'redraft' ? redraftBoard(qb, te) : mergeBoard(horizon, qb, te);
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
        // Held above zero here rather than per board, so no list can ever
        // publish a rating that reads as missing data.
        rating: Math.max(MIN_RATING, rating),
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
    label: `KeepTradeCut + FantasyPros · ${data.asOf}`,
    asOf: data.asOf,
    provenance: data.provenance,
    lists,
  };
}

export const bundledSource: RankingSource = {
  id: 'bundled',
  label: 'KeepTradeCut + FantasyPros',
  description:
    "Rating is KeepTradeCut's crowdsourced dynasty value. Redraft is FantasyPros expert " +
    'consensus order, read through a curve fitted to the redraft market so the two land on ' +
    'one scale. Both captured at build time and shipped with the app, so a visit costs ' +
    'neither source anything.',
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

/**
 * The rookie pick board for a league's format.
 *
 * Quarterback demand changes what a pick is worth — in superflex a first is
 * competing with veteran quarterbacks for the same trade dollars — so the pick
 * board follows the same format the players do. A tight end premium does not
 * move picks, so the premium half of the format is ignored here.
 */
export function bundledPickBoard(format: RankingFormat): PickBoard | undefined {
  const qb = qbFormatOf(format);
  const years = data.rookiePicks?.[qb];
  if (!years || Object.keys(years).length === 0) return undefined;
  return { years, yearDecay: data.pickYearDecay?.[qb] ?? 0.85 };
}
