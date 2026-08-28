import { useMemo } from 'react';
import { useStore } from '../state/store';

/**
 * Resolving a roster id to a team name needs both the league snapshot and the
 * roster list, so it cannot be a plain selector: returning a fresh closure from
 * `useStore` gives the store a new snapshot on every render and React spins.
 * Selecting the two stable inputs and memoising the lookup fixes that.
 */
export function useTeamName(): (rosterId: number) => string {
  const teamNames = useStore((s) => s.league?.teamNames);
  const rosters = useStore((s) => s.rosters);

  return useMemo(
    () => (rosterId: number) =>
      teamNames?.get(rosterId) ??
      rosters.find((r) => r.rosterId === rosterId)?.teamName ??
      `Roster ${rosterId}`,
    [teamNames, rosters],
  );
}
