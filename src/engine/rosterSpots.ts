import type { LeagueShape, ValuedPlayer } from './types';
import { teamStrength } from './depth';
import type { LineupPlayer } from './lineup';

/**
 * What a roster spot is worth.
 *
 * An earlier version of this file argued that a freed seat is worth exactly
 * zero, because every value here is measured above replacement and replacement
 * level IS the best free agent. That reasoning proves less than it appears to.
 * Value above replacement asks how much better a player is than one you could
 * sign for free — a question that silently assumes you have a spot to put the
 * free one in. When roster capacity binds, that assumption is precisely what is
 * in doubt, so the yardstick cannot measure the seat.
 *
 * What a seat is actually worth is an option. Sign a wire player; keep him if
 * he climbs; drop him for nothing and draw again if he does not. The
 * expectation of any single draw is zero, which is what replacement level
 * means, but you hold the right and not the obligation to keep the result. So
 * the seat earns E[max(0, drift)] rather than E[drift] — a call struck at the
 * money, re-struck every week. Its whole value is volatility, and volatility is
 * never negative.
 *
 * The cost of NOT having a seat is the other half. A team at its roster limit
 * that receives more players than it sends has to release somebody it chose
 * over the wire. So the two for one asymmetry is priced from both directions:
 * credited to the side that ends up with the empty seat, and charged to the
 * side that has to cut to fit.
 *
 * Nothing here is charged for overage a league already has. Sleeper counts
 * injured reserve and taxi players in the same list as everyone else, so a
 * legal roster can read as over the limit; only bodies the trade itself adds
 * beyond the team's headroom are ever cut.
 */

export function rosterCapacity(shape: LeagueShape): number {
  return shape.starters.length + shape.benchSlots + shape.irSlots + shape.taxiSlots;
}



export interface SpotMove {
  player: ValuedPlayer;
  /** Change in this team's strength, signed: negative for a cut. */
  strengthDelta: number;
  /** Change in long term asset value, signed. */
  assetDelta: number;
}

export interface RosterSpotEffect {
  capacity: number;
  /** Roster size before the trade and after it, before any cut. */
  before: number;
  after: number;
  /** Spots the trade frees. Zero unless the side sends more bodies than it gets. */
  freed: number;
  /** Players who have to be released to fit under the limit. */
  cuts: SpotMove[];
  /**
   * Best free agents the freed spots can hold. Each is worth zero above
   * replacement by construction — the option value below is what the seat
   * earns, and these name what would sit in it today.
   */
  adds: SpotMove[];
  /** `freed` seats times the per-seat option value. Zero when none are freed. */
  optionValue: number;
  /**
   * Net change in this season's strength: cuts, adds, and the option value.
   *
   * The option appears in this total AND in `assetDelta`, which is not double
   * counting: the scale blends the two as a weighted average, so a value in
   * both columns contributes exactly itself. That is the correct behaviour — a
   * wire breakout serves a contender as depth and a rebuilder as an asset, so
   * the seat is worth the same to either, and only the use differs.
   */
  strengthDelta: number;
  /** Net change in long term value, on the same terms. */
  assetDelta: number;
}

function toLineup(players: ValuedPlayer[]): LineupPlayer[] {
  return players.map((p) => ({ id: p.id, position: p.position, value: p.lineupValue }));
}

/** How many free agents per position to consider. The best one is decisive. */
const FREE_AGENT_DEPTH = 3;

/**
 * Greedy on both sides, which is correct here for the same reason the lineup
 * optimizer is: strength is a matroid rank function of the roster, so taking
 * the cheapest cut one at a time cannot be beaten by cutting a different set.
 */
export function rosterSpotEffect(
  roster: ValuedPlayer[],
  shape: LeagueShape,
  netBodies: number,
  freeAgents: ValuedPlayer[],
  baselineSize: number,
  optionValuePerSpot: number,
): RosterSpotEffect {
  const capacity = rosterCapacity(shape);
  const headroom = Math.max(0, capacity - baselineSize);
  const mustCut = Math.max(0, netBodies - headroom);
  const freed = Math.max(0, -netBodies);

  let current = [...roster];
  let strengthDelta = 0;
  let assetDelta = 0;
  const cuts: SpotMove[] = [];

  for (let i = 0; i < mustCut && current.length > 0; i++) {
    const base = teamStrength(toLineup(current), shape.starters).total;
    let best: { index: number; loss: number; player: ValuedPlayer } | null = null;
    for (let j = 0; j < current.length; j++) {
      const without = current.filter((_, k) => k !== j);
      const loss = base - teamStrength(toLineup(without), shape.starters).total;
      if (
        !best ||
        loss < best.loss - 1e-9 ||
        (Math.abs(loss - best.loss) <= 1e-9 &&
          current[j].assetValue < best.player.assetValue)
      ) {
        best = { index: j, loss, player: current[j] };
      }
    }
    if (!best) break;
    cuts.push({
      player: best.player,
      strengthDelta: -best.loss,
      assetDelta: -best.player.assetValue,
    });
    strengthDelta -= best.loss;
    assetDelta -= best.player.assetValue;
    current = current.filter((_, k) => k !== best!.index);
  }

  const adds: SpotMove[] = [];
  if (freed > 0 && freeAgents.length > 0) {
    const pool = bestFreeAgents(freeAgents);
    const taken = new Set<string>();
    for (let i = 0; i < freed; i++) {
      const base = teamStrength(toLineup(current), shape.starters).total;
      let best: { gain: number; player: ValuedPlayer } | null = null;
      for (const candidate of pool) {
        if (taken.has(candidate.id)) continue;
        const gain =
          teamStrength(toLineup([...current, candidate]), shape.starters).total - base;
        if (
          !best ||
          gain > best.gain + 1e-9 ||
          (Math.abs(gain - best.gain) <= 1e-9 && candidate.rating > best.player.rating)
        ) {
          best = { gain, player: candidate };
        }
      }
      if (!best) break;
      taken.add(best.player.id);
      adds.push({
        player: best.player,
        strengthDelta: best.gain,
        assetDelta: best.player.assetValue,
      });
      strengthDelta += best.gain;
      assetDelta += best.player.assetValue;
      current = [...current, best.player];
    }
  }

  const optionValue = freed * Math.max(0, optionValuePerSpot);

  return {
    capacity,
    before: baselineSize,
    after: roster.length,
    freed,
    cuts,
    adds,
    optionValue,
    strengthDelta: strengthDelta + optionValue,
    assetDelta: assetDelta + optionValue,
  };
}

/** The top few unrostered players at each position, by this season's value. */
export function bestFreeAgents(freeAgents: ValuedPlayer[]): ValuedPlayer[] {
  const byPosition = new Map<string, ValuedPlayer[]>();
  for (const player of freeAgents) {
    const list = byPosition.get(player.position);
    if (list) list.push(player);
    else byPosition.set(player.position, [player]);
  }
  const out: ValuedPlayer[] = [];
  for (const [, list] of byPosition) {
    list.sort((a, b) => b.redraft - a.redraft || b.rating - a.rating);
    out.push(...list.slice(0, FREE_AGENT_DEPTH));
  }
  return out;
}
