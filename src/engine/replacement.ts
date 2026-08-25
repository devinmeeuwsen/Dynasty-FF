import type {
  LeagueShape,
  Position,
  ReplacementResult,
  ReplacementLevels,
  SlotKind,
} from './types';
import { POSITIONS, SLOT_ELIGIBILITY } from './types';
import type { PositionalCurves } from './curves';

/**
 * Step 3: establish replacement level.
 *
 * Synced mode: the best player at each position not appearing on any roster in
 * the league IS the replacement player. No modelling required — the waiver wire
 * is observed, not inferred.
 *
 * Simulated mode: run the roster absorption model. Dedicated starters first,
 * then flex, then superflex, then bench, each greedily comparing the best
 * remaining player across eligible positions.
 */

/** How many roster spots per team the absorption model can actually fill. */
export function modeledSpotsPerTeam(shape: LeagueShape): number {
  const startable = shape.starters.filter(
    (s) => SLOT_ELIGIBILITY[s] && SLOT_ELIGIBILITY[s].length > 0,
  ).length;
  return startable + shape.benchSlots;
}

interface Cursor {
  /** Index of the next unabsorbed player at each position. */
  next: Record<Position, number>;
}

function valueAt(curves: PositionalCurves, pos: Position, index: number): number {
  const list = curves.byPosition[pos];
  if (index >= list.length) return 0;
  return list[index].value;
}

function idAt(curves: PositionalCurves, pos: Position, index: number): string | undefined {
  const list = curves.byPosition[pos];
  return index < list.length ? list[index].id : undefined;
}

/** Take the highest remaining value across the eligible positions. */
function greedyTake(
  cursor: Cursor,
  curves: PositionalCurves,
  eligible: readonly Position[],
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    let best: Position | null = null;
    let bestValue = -Infinity;
    for (const pos of eligible) {
      const v = valueAt(curves, pos, cursor.next[pos]);
      if (v > bestValue) {
        bestValue = v;
        best = pos;
      }
    }
    if (best == null) return;
    cursor.next[best] += 1;
  }
}

/** Group the starting slots into the four allocation phases. */
export function slotPhases(starters: SlotKind[]): {
  dedicated: Record<Position, number>;
  flexGroups: { eligible: readonly Position[]; count: number }[];
} {
  const dedicated: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const flexCounts = new Map<string, { eligible: readonly Position[]; count: number }>();

  for (const slot of starters) {
    const eligible = SLOT_ELIGIBILITY[slot] ?? [];
    if (eligible.length === 0) continue;
    if (eligible.length === 1) {
      dedicated[eligible[0]] += 1;
      continue;
    }
    const key = eligible.join('/');
    const entry = flexCounts.get(key);
    if (entry) entry.count += 1;
    else flexCounts.set(key, { eligible, count: 1 });
  }

  // Narrower flexes resolve before wider ones; superflex (widest) goes last, as
  // the spec's phase ordering requires.
  const flexGroups = [...flexCounts.values()].sort(
    (a, b) => a.eligible.length - b.eligible.length,
  );
  return { dedicated, flexGroups };
}

export function simulatedReplacement(
  shape: LeagueShape,
  curves: PositionalCurves,
): ReplacementResult {
  const cursor: Cursor = { next: { QB: 0, RB: 0, WR: 0, TE: 0 } };
  const { dedicated, flexGroups } = slotPhases(shape.starters);

  // Phase 1: dedicated starters.
  for (const pos of POSITIONS) {
    cursor.next[pos] += shape.teams * dedicated[pos];
  }
  // Phases 2 and 3: flex, then superflex.
  for (const group of flexGroups) {
    greedyTake(cursor, curves, group.eligible, shape.teams * group.count);
  }
  // Phase 4: bench, greedy across all four positions.
  greedyTake(cursor, curves, POSITIONS, shape.teams * shape.benchSlots);

  const levels = {} as ReplacementLevels;
  const players: Partial<Record<Position, string>> = {};
  const absorbed = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    absorbed[pos] = cursor.next[pos];
    levels[pos] = valueAt(curves, pos, cursor.next[pos]);
    const id = idAt(curves, pos, cursor.next[pos]);
    if (id) players[pos] = id;
  }

  return { levels, players, mode: 'simulated', absorbed };
}

export function observedReplacement(
  curves: PositionalCurves,
  rosteredPlayerIds: ReadonlySet<string>,
): ReplacementResult {
  const levels = {} as ReplacementLevels;
  const players: Partial<Record<Position, string>> = {};

  for (const pos of POSITIONS) {
    const list = curves.byPosition[pos];
    const free = list.find((entry) => !rosteredPlayerIds.has(entry.id));
    levels[pos] = free ? free.value : 0;
    if (free) players[pos] = free.id;
  }

  return { levels, players, mode: 'observed' };
}

export interface ReplacementComparison {
  position: Position;
  observed: number;
  simulated: number;
  /** Positive when the league rosters shallower than its settings imply. */
  delta: number;
  observedPlayerId?: string;
  simulatedPlayerId?: string;
}

/**
 * Divergence between the two modes is informative: it says the league is
 * rostering unusually deep or unusually shallow relative to its settings. That
 * is real, actionable information about that specific league, so it is
 * reported rather than hidden.
 */
export function compareReplacement(
  observed: ReplacementResult,
  simulated: ReplacementResult,
): ReplacementComparison[] {
  return POSITIONS.map((position) => ({
    position,
    observed: observed.levels[position],
    simulated: simulated.levels[position],
    delta: observed.levels[position] - simulated.levels[position],
    observedPlayerId: observed.players[position],
    simulatedPlayerId: simulated.players[position],
  }));
}
