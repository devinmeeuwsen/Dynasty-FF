import type { SlotKind } from './types';
import { SLOT_ELIGIBILITY } from './types';
import { optimizeLineup, startingSlots, type LineupPlayer } from './lineup';

/**
 * What the bench is actually worth.
 *
 * A starting lineup total says what a team scores when everyone plays. Nobody
 * plays every week: there are byes, and skill players miss games. When a
 * starter is out, the slot is filled by the best bench player eligible for it
 * rather than by a waiver claim, and the team keeps that player's value above
 * replacement instead of losing all of it.
 *
 * So depth is worth exactly the probability that it gets used:
 *
 *   depth = P(starter unavailable) * (best eligible backup's value)
 *
 * That single expression also settles the question of how far down the bench
 * to count. The SECOND backup at a position only plays when the starter and
 * the first backup are both out, which happens with probability q^2 — about
 * four percent, inside the noise of everything else here. Depth past the first
 * body is not a rounding error being ignored; it is genuinely close to
 * worthless, which is why a fourth running back does nothing for a team and a
 * second quarterback does.
 *
 * One backup per SLOT CLASS, not per position: a league starting two flexes
 * still only needs one flex backup, because the two flex starters are unlikely
 * to be out in the same week for the same reason a position's second backup
 * does not matter.
 */

/**
 * How often a starting slot needs its backup, per week.
 *
 * A bye costs one week in fourteen (0.07). Skill position starters miss
 * something like an eighth of the remaining season to injury (0.13). The two
 * are close enough to independent at this resolution to add.
 */
export const STARTER_MISS_RATE = 0.2;

export interface DepthEntry {
  /** The starting slot this player is the next man up for. */
  slot: SlotKind;
  playerId: string;
  /** The backup's own value above replacement. */
  value: number;
  /** value * STARTER_MISS_RATE. */
  contribution: number;
}

export interface DepthResult {
  total: number;
  entries: DepthEntry[];
  /** Bench players who back up nothing, and are therefore worth nothing. */
  surplusIds: string[];
}

/**
 * One backup slot per distinct eligibility class in the starting lineup.
 *
 * A lineup of QB / RB / RB / WR / WR / TE / FLEX / FLEX yields five: QB, RB,
 * WR, TE and FLEX. Duplicated slots collapse because the second of them is
 * already covered by the first backup.
 */
export function backupSlots(starters: SlotKind[]): SlotKind[] {
  const seen = new Set<string>();
  const out: SlotKind[] = [];
  for (const slot of startingSlots(starters)) {
    const key = SLOT_ELIGIBILITY[slot].join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

/**
 * Assigning backups is the same problem as assigning starters — one player per
 * slot, eligibility by position — so it is the same optimizer, run over the
 * players the starting lineup left behind. That matters: the greedy assignment
 * is provably optimal on a transversal matroid, so a team is never credited
 * for a backup arrangement it could not actually field.
 */
export function benchDepth(
  players: LineupPlayer[],
  starters: SlotKind[],
  starterIds?: readonly string[],
): DepthResult {
  const starting = new Set(
    starterIds ?? optimizeLineup(players, starters).starterIds,
  );
  const bench = players.filter((p) => !starting.has(p.id));
  const slots = backupSlots(starters);
  const assigned = optimizeLineup(bench, slots);

  const entries: DepthEntry[] = [];
  const byId = new Map(bench.map((p) => [p.id, p]));
  assigned.assignment.forEach((playerId, index) => {
    if (!playerId) return;
    const player = byId.get(playerId);
    if (!player) return;
    entries.push({
      slot: slots[index],
      playerId,
      value: player.value,
      contribution: STARTER_MISS_RATE * player.value,
    });
  });
  entries.sort((a, b) => b.contribution - a.contribution);

  return {
    total: STARTER_MISS_RATE * assigned.total,
    entries,
    surplusIds: assigned.benchIds,
  };
}

/**
 * What a team is worth for this season: its starters in full, plus the slice
 * of its bench that will actually play.
 *
 * This is the number the season simulation runs on. Before depth was in it, a
 * team with the league's best bench and a team with an empty one projected
 * identically, and acquiring a backup quarterback moved a championship
 * probability by exactly zero.
 */
export function teamStrength(
  players: LineupPlayer[],
  starters: SlotKind[],
): { total: number; starting: number; depth: DepthResult; starterIds: string[] } {
  const lineup = optimizeLineup(players, starters);
  const depth = benchDepth(players, starters, lineup.starterIds);
  return {
    total: lineup.total + depth.total,
    starting: lineup.total,
    depth,
    starterIds: lineup.starterIds,
  };
}
