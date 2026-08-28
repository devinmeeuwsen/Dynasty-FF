import { useMemo } from 'react';
import { useStore } from '../state/store';
import { assessPosture, type PostureResult } from '../engine/posture';

/**
 * A team's contention posture, derived from the simulation.
 *
 * This cannot be a plain `useStore(selectPosture)`. `assessPosture` builds a
 * fresh object on every call and zustand compares snapshots by reference, so
 * the store would report a change on every render and React would spin until it
 * threw "maximum update depth exceeded" — a blank page the moment a league
 * connected. Selecting the two stable inputs and memoising the derivation is
 * the same shape of fix `useTeamName` needed for the same reason.
 */
export function usePosture(): PostureResult | null {
  const scenario = useStore((s) => s.scenario);
  const userRosterId = useStore((s) => s.userRosterId);

  return useMemo(
    () => (scenario && userRosterId != null ? assessPosture(scenario, userRosterId) : null),
    [scenario, userRosterId],
  );
}
