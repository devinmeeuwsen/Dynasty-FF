import type { LeagueShape, ValuedPlayer } from './types';
import { teamStrength } from './depth';
import type { LineupPlayer } from './lineup';

/**
 * What a roster spot is worth.
 *
 * The intuition behind the question is that a two for one frees a seat, and a
 * free seat can hold a free agent. The arithmetic says something sharper. Every
 * value in this application is measured above replacement, and replacement
 * level IS the best free agent at that position — so the player you sign into
 * the empty seat is worth exactly zero by construction. An open roster spot is
 * not an asset.
 *
 * The cost of NOT having one is very real, and it is the half that was
 * missing. A team at its roster limit that receives more players than it sends
 * has to release somebody, and that somebody is a player it chose to roster
 * over the wire. So the two for one asymmetry is priced here — it is just
 * booked against the side consolidating, as a cut, rather than credited to the
 * side that ends up with the empty seat.
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
  /** Best free agents the freed spots can hold. Worth zero, and shown anyway. */
  adds: SpotMove[];
  /** Net change in this season's strength from the cuts and adds together. */
  strengthDelta: number;
  /** Net change in long term value from the same. */
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

  return {
    capacity,
    before: baselineSize,
    after: roster.length,
    freed,
    cuts,
    adds,
    strengthDelta,
    assetDelta,
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
