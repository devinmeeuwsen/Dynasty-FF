/** A single head to head pairing inside one week. */
export interface Matchup {
  a: number;
  b: number;
}

export interface WeekSchedule {
  week: number;
  matchups: Matchup[];
  /** Teams with no opponent this week (odd team counts, bye weeks). */
  byes: number[];
}

/**
 * Circle-method round robin. Used only when Sleeper has not published a
 * schedule yet, which is the normal state during the offseason.
 */
export function roundRobin(rosterIds: number[], weeks: number): WeekSchedule[] {
  const ids = [...rosterIds];
  const odd = ids.length % 2 === 1;
  if (odd) ids.push(-1);

  const n = ids.length;
  const half = n / 2;
  const rotating = ids.slice(1);
  const out: WeekSchedule[] = [];

  for (let w = 0; w < weeks; w++) {
    const order = [ids[0], ...rotating];
    const matchups: Matchup[] = [];
    const byes: number[] = [];
    for (let i = 0; i < half; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a === -1) byes.push(b);
      else if (b === -1) byes.push(a);
      else matchups.push({ a, b });
    }
    out.push({ week: w + 1, matchups, byes });
    rotating.unshift(rotating.pop() as number);
  }

  return out;
}

/**
 * Build a schedule from Sleeper's weekly matchup payloads. Sleeper groups the
 * two sides of a game by a shared matchup_id inside each week.
 */
export interface RawMatchupEntry {
  roster_id: number;
  matchup_id: number | null;
  points?: number | null;
}

export function scheduleFromSleeper(
  weeks: { week: number; entries: RawMatchupEntry[] }[],
): WeekSchedule[] {
  return weeks.map(({ week, entries }) => {
    const groups = new Map<number, number[]>();
    const byes: number[] = [];
    for (const entry of entries) {
      if (entry.matchup_id == null) {
        byes.push(entry.roster_id);
        continue;
      }
      const list = groups.get(entry.matchup_id) ?? [];
      list.push(entry.roster_id);
      groups.set(entry.matchup_id, list);
    }
    const matchups: Matchup[] = [];
    for (const list of groups.values()) {
      if (list.length === 2) matchups.push({ a: list[0], b: list[1] });
      else byes.push(...list);
    }
    return { week, matchups, byes };
  });
}

/** Results already in the books, which the simulation must not re-roll. */
export interface CompletedWeek {
  week: number;
  points: Map<number, number>;
}

export function completedFromSleeper(
  weeks: { week: number; entries: RawMatchupEntry[] }[],
): CompletedWeek[] {
  return weeks
    .filter((w) => w.entries.some((e) => (e.points ?? 0) > 0))
    .map((w) => ({
      week: w.week,
      points: new Map(w.entries.map((e) => [e.roster_id, e.points ?? 0])),
    }));
}
