import { useMemo } from 'react';
import { useStore } from '../state/store';
import { projectLeague, type TeamProjection } from '../engine/projection';
import type { ValuedPlayer } from '../engine/types';

/** This season plus the two after it. */
export const PROJECTION_YEARS = 3;

/**
 * Memoised for the same reason `usePosture` is: this builds fresh arrays on
 * every call, and a zustand selector that returns a new object on every render
 * spins React until it throws.
 */
export function useProjection(): { rows: TeamProjection[]; baseSeason: number } | null {
  const rosters = useStore((s) => s.rosters);
  const values = useStore((s) => s.values);
  const picks = useStore((s) => s.picks);
  const scenario = useStore((s) => s.scenario);
  const league = useStore((s) => s.league);

  return useMemo(() => {
    if (!scenario || rosters.length === 0 || !league) return null;
    const players = new Map<number, ValuedPlayer[]>();
    for (const roster of rosters) {
      players.set(
        roster.rosterId,
        roster.playerIds.map((id) => values.get(id)).filter(Boolean) as ValuedPlayer[],
      );
    }
    return {
      baseSeason: league.season,
      rows: projectLeague({
        rosterIds: rosters.map((r) => r.rosterId),
        players,
        picks,
        pickValues: scenario.pickValues,
        baseSeason: league.season,
        years: PROJECTION_YEARS,
      }),
    };
  }, [rosters, values, picks, scenario, league]);
}
