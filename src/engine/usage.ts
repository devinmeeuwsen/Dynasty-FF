import type { LeagueShape, ValuedPlayer } from './types';
import { teamStrength } from './depth';
import type { LineupPlayer } from './lineup';
import { projectedLineupValue } from './projection';

/**
 * What a player is worth to the team that holds him, over a horizon.
 *
 * Two numbers, deliberately on identical footing:
 *
 *   horizon  what he is worth to a team that starts him every week
 *   used     what he is worth to THIS roster, where somebody may be ahead of him
 *
 * Both are discounted averages of the same projected season values over the
 * same window, so subtracting them means something. That is the whole point of
 * the design, and it is what the first version got wrong: it compared a dynasty
 * rating — a price for a player's entire remaining career, call it eight years
 * — against one season of lineup contribution. Every good player came out
 * looking like surplus, and a twenty-two year old came out looking like surplus
 * permanently, for the crime of having his best seasons ahead of him.
 *
 * A single season was also too short in the other direction. A rookie behind
 * two starters contributes nothing this year and everything two years from now,
 * and a one-year window cannot tell him apart from a thirty-year-old in the
 * same seat.
 *
 * The elite case is the test this has to pass. The best players start for
 * anyone, so their `used` should sit close to their `horizon` on every roster
 * in the league and their surplus near zero — you cannot buy a star cheap by
 * finding a team that has no use for him, because there is no such team.
 */

/** Discounted, normalised to sum to one, so the result stays on the value scale. */
export function horizonWeights(years: number, discountPerYear: number): number[] {
  const n = Math.max(1, Math.floor(years));
  const d = Math.min(1, Math.max(0, discountPerYear));
  const raw = Array.from({ length: n }, (_, i) => Math.pow(d, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((w) => w / sum) : raw.map(() => 1 / n);
}

export interface HorizonSettings {
  usageHorizonYears: number;
  futureDiscountPerYear: number;
}

/**
 * What he is worth to a team that plays him, over the horizon. Team
 * independent by construction: measured against league replacement, never
 * against whoever happens to be ahead of him.
 */
export function horizonValue(player: ValuedPlayer, settings: HorizonSettings): number {
  const w = horizonWeights(settings.usageHorizonYears, settings.futureDiscountPerYear);
  let total = 0;
  for (let n = 0; n < w.length; n++) total += w[n] * projectedLineupValue(player, n);
  return total;
}

function lineupAt(roster: ValuedPlayer[], yearsOut: number): LineupPlayer[] {
  return roster.map((p) => ({
    id: p.id,
    position: p.position,
    value: projectedLineupValue(p, yearsOut),
  }));
}

/**
 * What this roster's strength loses without him, averaged over the horizon.
 *
 * Marginal, and that is the point: on a roster three deep at his position the
 * next man up absorbs most of what he does, so the team is not getting what
 * the league would pay for him. On a thin roster it gets all of it.
 */
export function playerUsage(
  roster: ValuedPlayer[],
  shape: LeagueShape,
  playerId: string,
  settings: HorizonSettings,
): number {
  const w = horizonWeights(settings.usageHorizonYears, settings.futureDiscountPerYear);
  let total = 0;
  for (let n = 0; n < w.length; n++) {
    const lineup = lineupAt(roster, n);
    const base = teamStrength(lineup, shape.starters).total;
    const without = teamStrength(
      lineup.filter((p) => p.id !== playerId),
      shape.starters,
    ).total;
    total += w[n] * (base - without);
  }
  return total;
}

export interface UsageReading {
  playerId: string;
  /** Dynasty value above replacement. Portable currency, unchanged by roster. */
  market: number;
  /** Worth to a team that starts him, over the horizon. */
  horizon: number;
  /** Worth to this roster over the same horizon. */
  used: number;
  /**
   * Value this roster cannot extract: `horizon - used`, floored at zero.
   *
   * Not `market - used`. Those measure different spans and the subtraction is
   * meaningless — see the note at the top of this file.
   */
  surplus: number;
  /** Share of his usable value going to waste, 0 to 1. The sell signal. */
  idleShare: number;
}

export function readUsage(
  roster: ValuedPlayer[],
  shape: LeagueShape,
  player: ValuedPlayer,
  settings: HorizonSettings,
): UsageReading {
  const horizon = horizonValue(player, settings);
  const used = playerUsage(roster, shape, player.id, settings);
  const surplus = Math.max(0, horizon - used);
  return {
    playerId: player.id,
    market: player.assetValue,
    horizon,
    used,
    surplus,
    idleShare: horizon > 1e-9 ? surplus / horizon : 0,
  };
}
