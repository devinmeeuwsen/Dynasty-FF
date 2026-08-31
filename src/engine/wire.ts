import type { LeagueShape, Position, ValuedPlayer } from './types';
import { POSITIONS } from './types';
import { rosterCapacity } from './rosterSpots';

/**
 * How rich the waiver wire actually is.
 *
 * Replacement level is DEFINED as the best unrostered player at each position,
 * which pins his value above replacement at exactly zero. That definition is
 * what makes every other number in the app mean something, and it is worth
 * keeping — but it is a definition, not a finding, and it quietly implies
 * something that is often false: that the wire is picked clean.
 *
 * It usually is not. Ten teams at twenty-three spots roster 230 players, and
 * managers do not fill those 230 seats with the 230 best players. They hold
 * injured starters, prospects two years away, and names they are attached to.
 * So players who would rank inside the top 230 sit free, and the pool a roster
 * spot draws from is better than "replacement level" makes it sound.
 *
 * This module measures that slack rather than assuming either way. It changes
 * no value in the model; it tells a manager how much room their own league is
 * leaving on the table, which is the evidence for how high to set the value of
 * an open roster spot.
 */

export interface BelowWire {
  player: ValuedPlayer;
  rosterId: number;
  /** How far below the best free agent at his position he sits, in rating. */
  deficit: number;
}

export interface PositionDepth {
  position: Position;
  best: ValuedPlayer | null;
  /** The fifth best free agent, if there is one. */
  fifth: ValuedPlayer | null;
  /**
   * Rating lost between the best free agent and the fifth. A shallow drop
   * means several usable bodies are available rather than one, which is what
   * makes a second and third open seat worth holding.
   */
  dropOff: number;
}

export interface WireDepth {
  /** Roster slots the league has in total: teams times capacity. */
  slots: number;
  rostered: number;
  free: number;
  /**
   * Unrostered players who would rank inside the top `slots` by rating. Every
   * one of them is a player some team is passing over for somebody worse.
   */
  insideTopSlots: ValuedPlayer[];
  /** Rostered players a free agent at their own position already beats. */
  belowWire: BelowWire[];
  byPosition: PositionDepth[];
}

export function wireDepth(
  players: readonly ValuedPlayer[],
  shape: LeagueShape,
  teams: number,
): WireDepth {
  const slots = Math.max(1, teams) * rosterCapacity(shape);
  const rostered = players.filter((p) => p.ownerRosterId != null);
  const free = players.filter((p) => p.ownerRosterId == null);

  // Ranked on the dynasty rating, the one number that covers every player in
  // the pool whether or not anybody has claimed him.
  const topSlots = new Set(
    [...players]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, slots)
      .map((p) => p.id),
  );
  const insideTopSlots = free
    .filter((p) => topSlots.has(p.id))
    .sort((a, b) => b.rating - a.rating);

  const freeByPosition = new Map<Position, ValuedPlayer[]>();
  for (const pos of POSITIONS) {
    freeByPosition.set(
      pos,
      free.filter((p) => p.position === pos).sort((a, b) => b.rating - a.rating),
    );
  }

  const belowWire: BelowWire[] = [];
  for (const p of rostered) {
    const best = freeByPosition.get(p.position)?.[0];
    if (!best || best.rating <= p.rating) continue;
    belowWire.push({
      player: p,
      rosterId: p.ownerRosterId as number,
      deficit: best.rating - p.rating,
    });
  }
  belowWire.sort((a, b) => b.deficit - a.deficit);

  const byPosition: PositionDepth[] = POSITIONS.map((position) => {
    const list = freeByPosition.get(position) ?? [];
    const best = list[0] ?? null;
    const fifth = list[4] ?? null;
    return {
      position,
      best,
      fifth,
      dropOff: best && fifth ? best.rating - fifth.rating : 0,
    };
  });

  return {
    slots,
    rostered: rostered.length,
    free: free.length,
    insideTopSlots,
    belowWire,
    byPosition,
  };
}
