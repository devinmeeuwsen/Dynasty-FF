import type { Position, SlotKind } from './types';
import { SLOT_ELIGIBILITY } from './types';

/**
 * Lineup optimizer.
 *
 * Given a roster and a lineup configuration, assign players to maximize total
 * win now value. Because a player contributes the same value in any slot he is
 * eligible for, the feasible starting sets form a transversal matroid, so the
 * greedy algorithm — take players in descending value, keep one whenever the
 * kept set still admits a perfect matching into slots — is provably optimal.
 * Tests verify it against brute force on randomized rosters anyway.
 */

export interface LineupPlayer {
  id: string;
  position: Position;
  value: number;
}

export interface LineupResult {
  total: number;
  /** slotIndex → player id. */
  assignment: (string | null)[];
  starterIds: string[];
  benchIds: string[];
}

/** Starting slots only, in order, with bench/IR/taxi and unsupported removed. */
export function startingSlots(starters: SlotKind[]): SlotKind[] {
  return starters.filter((s) => (SLOT_ELIGIBILITY[s]?.length ?? 0) > 0);
}

export function optimizeLineup(
  players: LineupPlayer[],
  starters: SlotKind[],
): LineupResult {
  const slots = startingSlots(starters);
  const slotEligible = slots.map((s) => SLOT_ELIGIBILITY[s]);

  const sorted = [...players].sort(
    (a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // slotOwner[s] = index into `kept` of the player currently matched to slot s.
  const slotOwner: number[] = new Array(slots.length).fill(-1);
  const kept: LineupPlayer[] = [];
  const keptSlotOf: number[] = [];

  const tryAssign = (keptIndex: number, seen: boolean[]): boolean => {
    const pos = kept[keptIndex].position;
    for (let s = 0; s < slots.length; s++) {
      if (seen[s]) continue;
      if (!slotEligible[s].includes(pos)) continue;
      seen[s] = true;
      const current = slotOwner[s];
      if (current === -1 || tryAssign(current, seen)) {
        slotOwner[s] = keptIndex;
        keptSlotOf[keptIndex] = s;
        return true;
      }
    }
    return false;
  };

  let filled = 0;
  for (const player of sorted) {
    if (filled === slots.length) break;
    kept.push(player);
    keptSlotOf.push(-1);
    const index = kept.length - 1;
    if (tryAssign(index, new Array(slots.length).fill(false))) {
      filled++;
    } else {
      kept.pop();
      keptSlotOf.pop();
    }
  }

  const assignment: (string | null)[] = new Array(slots.length).fill(null);
  let total = 0;
  const starterIds: string[] = [];
  for (let s = 0; s < slots.length; s++) {
    const owner = slotOwner[s];
    if (owner === -1) continue;
    assignment[s] = kept[owner].id;
    starterIds.push(kept[owner].id);
    total += kept[owner].value;
  }

  const startingSet = new Set(starterIds);
  const benchIds = players.filter((p) => !startingSet.has(p.id)).map((p) => p.id);

  return { total, assignment, starterIds, benchIds };
}

/** Optimal starting total only. Used inside hot loops. */
export function lineupStrength(players: LineupPlayer[], starters: SlotKind[]): number {
  return optimizeLineup(players, starters).total;
}

/**
 * The marginal value of one player to one roster: what the optimal starting
 * total loses if he is removed. A player who cannot crack the starting lineup
 * has a marginal value of exactly zero for that roster. That is correct.
 */
export function marginalValue(
  players: LineupPlayer[],
  starters: SlotKind[],
  playerId: string,
): number {
  const withHim = lineupStrength(players, starters);
  const withoutHim = lineupStrength(
    players.filter((p) => p.id !== playerId),
    starters,
  );
  return withHim - withoutHim;
}

/** The marginal value of adding a player to a roster he is not currently on. */
export function acquisitionValue(
  players: LineupPlayer[],
  starters: SlotKind[],
  incoming: LineupPlayer,
): number {
  const before = lineupStrength(players, starters);
  const after = lineupStrength([...players, incoming], starters);
  return after - before;
}

/** Reference implementation used only by tests. Exponential, so keep it small. */
export function bruteForceLineup(
  players: LineupPlayer[],
  starters: SlotKind[],
): number {
  const slots = startingSlots(starters);
  const eligible = slots.map((s) => SLOT_ELIGIBILITY[s]);
  const used = new Array(players.length).fill(false);

  const search = (slotIndex: number): number => {
    if (slotIndex === slots.length) return 0;
    // Leaving a slot empty is always allowed and never helps, but include it so
    // rosters shorter than the lineup still resolve.
    let best = search(slotIndex + 1);
    for (let i = 0; i < players.length; i++) {
      if (used[i]) continue;
      if (!eligible[slotIndex].includes(players[i].position)) continue;
      used[i] = true;
      const candidate = players[i].value + search(slotIndex + 1);
      if (candidate > best) best = candidate;
      used[i] = false;
    }
    return best;
  };

  return search(0);
}
