import type { Position } from './types';
import { POSITIONS } from './types';
import type { RankToValue } from './rank';

/**
 * Step 2: build four positional value curves.
 *
 * Running backs and wide receivers read raw value directly off overall rank.
 *
 * Quarterbacks and tight ends do NOT get their own value scale. The scale is
 * pulled from the overall list and only the ordering comes from the positional
 * list: collect the raw values of every player at that position from the
 * overall rankings, sort descending, then reassign in order to the positional
 * ranking. If those two positions floated on a separate scale, comparing a
 * tight end against a wide receiver would be meaningless, and that comparison
 * is the entire point of the product.
 */

export interface RankInput {
  id: string;
  position: Position;
  /** 1-based rank in the overall list. Null when the player is unranked. */
  overallRank: number | null;
  /** 1-based rank inside the positional list. Null when absent. */
  positionRank: number | null;
}

/** Positions whose ordering comes from a positional list rather than overall. */
const REORDERED: readonly Position[] = ['QB', 'TE'];

export interface PositionalCurves {
  /** playerId → raw value. */
  values: Map<string, number>;
  /** Position → descending list of { id, value }, the curve itself. */
  byPosition: Record<Position, { id: string; value: number }[]>;
  /** Length of the overall ranking list that produced these curves. */
  overallCount: number;
}

export function buildPositionalCurves(
  players: RankInput[],
  curve: RankToValue,
): PositionalCurves {
  const overallCount = players.reduce(
    (max, p) => (p.overallRank != null && p.overallRank > max ? p.overallRank : max),
    0,
  );

  const values = new Map<string, number>();

  // A player with no overall rank sits below the whole list. Give him a value
  // off the deep tail of the curve so ordering stays stable and he lands under
  // replacement level by construction rather than by a special case.
  const unrankedTailStart = overallCount + 1;

  for (const pos of POSITIONS) {
    const group = players.filter((p) => p.position === pos);
    if (group.length === 0) continue;

    if (!REORDERED.includes(pos)) {
      // Read raw value directly off overall rank.
      const unranked = group
        .filter((p) => p.overallRank == null)
        .sort((a, b) => cmpPositionRank(a, b));
      for (const p of group) {
        if (p.overallRank != null) values.set(p.id, curve(p.overallRank));
      }
      unranked.forEach((p, i) => values.set(p.id, curve(unrankedTailStart + i)));
      continue;
    }

    // Scale from overall, ordering from the positional list.
    const pool = group
      .filter((p) => p.overallRank != null)
      .map((p) => curve(p.overallRank as number))
      .sort((a, b) => b - a);

    const ordered = [...group].sort(cmpPositionRank);

    for (let i = 0; i < ordered.length; i++) {
      const player = ordered[i];
      if (i < pool.length) {
        values.set(player.id, pool[i]);
      } else {
        values.set(player.id, extrapolate(pool, i, curve, unrankedTailStart));
      }
    }
  }

  const byPosition = {} as Record<Position, { id: string; value: number }[]>;
  for (const pos of POSITIONS) {
    byPosition[pos] = players
      .filter((p) => p.position === pos)
      .map((p) => ({ id: p.id, value: values.get(p.id) ?? 0 }))
      .sort((a, b) => b.value - a.value);
  }

  return { values, byPosition, overallCount };
}

/**
 * The positional list runs deeper than the overall list at this position.
 * Continue the geometric decay the pool was already following rather than
 * inventing a floor, so the tail stays monotone and smooth.
 */
function extrapolate(
  pool: number[],
  index: number,
  curve: RankToValue,
  tailStart: number,
): number {
  if (pool.length === 0) return curve(tailStart + index);
  const last = pool[pool.length - 1];
  if (pool.length < 2 || last <= 0) return curve(tailStart + index);
  const ratio = Math.min(0.999, Math.max(0.5, last / pool[pool.length - 2]));
  return last * Math.pow(ratio, index - (pool.length - 1));
}

function cmpPositionRank(a: RankInput, b: RankInput): number {
  const ar = a.positionRank ?? Number.POSITIVE_INFINITY;
  const br = b.positionRank ?? Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  const ao = a.overallRank ?? Number.POSITIVE_INFINITY;
  const bo = b.overallRank ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
