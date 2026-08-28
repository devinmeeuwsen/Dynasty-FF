import type { Rng } from './rng';

/**
 * Bracket resolution that returns a COMPLETE ordering, not just a champion.
 *
 * Every simulated season has to produce one full permutation of the league,
 * because that is what makes the finish matrix doubly stochastic by
 * construction. So losers drop into a placement bracket rather than being
 * discarded, and every team comes out with a distinct position.
 */

export type PlayGame = (a: number, b: number) => number;

/**
 * `seeds` is ordered best seed first. Returns the teams ordered by final
 * placement: index 0 finished first inside this bracket.
 */
export function rankBracket(seeds: number[], play: PlayGame): number[] {
  if (seeds.length <= 1) return [...seeds];
  if (seeds.length === 2) {
    const winner = play(seeds[0], seeds[1]);
    const loser = winner === seeds[0] ? seeds[1] : seeds[0];
    return [winner, loser];
  }

  const size = seeds.length;
  const nextPow2 = 1 << Math.ceil(Math.log2(size));
  const byes = nextPow2 - size;

  const advancing = seeds.slice(0, byes);
  const playing = seeds.slice(byes);

  const winners: number[] = [...advancing];
  const losers: number[] = [];
  for (let i = 0; i < playing.length / 2; i++) {
    const a = playing[i];
    const b = playing[playing.length - 1 - i];
    const w = play(a, b);
    winners.push(w);
    losers.push(w === a ? b : a);
  }

  // Re-seed each sub-bracket by the original seeding, which is how every
  // fantasy platform reseeds between rounds.
  const order = new Map(seeds.map((id, i) => [id, i]));
  winners.sort((x, y) => (order.get(x) as number) - (order.get(y) as number));
  losers.sort((x, y) => (order.get(x) as number) - (order.get(y) as number));

  return [...rankBracket(winners, play), ...rankBracket(losers, play)];
}

/**
 * A single playoff game. Each side draws a score from its own weekly
 * distribution, exactly as in the regular season — playoff variance is not a
 * separate parameter.
 */
export function makeGamePlayer(
  means: Map<number, number>,
  sigma: number,
  rng: Rng,
): PlayGame {
  return (a, b) => {
    const sa = (means.get(a) ?? 0) + sigma * rng.normal();
    const sb = (means.get(b) ?? 0) + sigma * rng.normal();
    if (sa === sb) return rng.next() < 0.5 ? a : b;
    return sa > sb ? a : b;
  };
}
