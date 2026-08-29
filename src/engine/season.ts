import type { DraftOrderRule, FinishMatrix } from './types';
import { mulberry32, type Rng } from './rng';
import type { WeekSchedule } from './schedule';
import { makeGamePlayer, rankBracket } from './bracket';

/**
 * Monte Carlo season simulation.
 *
 * The central object in this application is a finish probability matrix. Rows
 * are teams, columns are finish positions. Because every simulated season
 * produces exactly one complete finish order — a permutation of all teams —
 * the tally is doubly stochastic BY CONSTRUCTION. That is a correctness
 * invariant, not something to enforce afterwards. Nothing in this file
 * normalizes rows or columns, and nothing ever should: forcing the matrix
 * would hide exactly the errors the property exists to catch.
 */

export interface TeamStanding {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface SeasonInput {
  rosterIds: number[];
  /**
   * Team strength in win now value units: the optimal starting lineup plus the
   * slice of the bench that actually plays. Built by `teamStrength`.
   */
  strengths: Map<number, number>;
  /** Regular season weeks still to be played. */
  remainingSchedule: WeekSchedule[];
  /** Record already in the books. */
  standings: TeamStanding[];
  playoffTeams: number;
  /** Sleeper's `league_average_match`: an extra weekly win against the median. */
  leagueAverageMatch: boolean;
  consolationBracket: boolean;
  /** Weeks per playoff round, from the league's own settings. Usually 1 or 2. */
  playoffWeeksPerRound?: number;
  draftOrderRule: DraftOrderRule;
  seasons: number;
  weeklySigma: number;
  replacementPointsPerStarter: number;
  leagueMeanPoints: number;
  /** How many starting slots the lineup optimizer actually fills. */
  starterCount: number;
  seed: number;
}

export interface SeasonResult {
  finish: FinishMatrix;
  draftSlots: FinishMatrix;
  regularSeason: FinishMatrix;
  /** Projected weekly scoring mean per team, for display and sanity checks. */
  meanPoints: Map<number, number>;
  seasons: number;
}

/**
 * Weekly scoring variance is the parameter that governs everything, and the
 * mapping from lineup strength to a weekly scoring mean is what gives it
 * something to act on.
 *
 * A team's weekly score is the sum of its starters' scores, and each starter
 * scores what a replacement starter scores plus something proportional to his
 * value above replacement. So team points are AFFINE in lineup strength:
 *
 *   meanPoints(team) = starters * replacementPointsPerStarter + k * strength
 *
 * with k fixed by requiring the league average lineup to score the league
 * average. That derivation matters: an earlier version z-scored lineup
 * strength across the league, which made a team's sensitivity depend on how
 * tightly packed its league happened to be — in a league of near identical
 * rosters, one waiver claim moved a team eight standard deviations. The affine
 * form has no such pathology and is invariant to the value scale lambda
 * produces.
 *
 * `strengths` is a team's starters plus its first line of backups, weighted by
 * how often a starting slot needs covering — see `depth.ts`. So a bench
 * acquisition moves this, but only by a fifth of what the same player would
 * move it as a starter, and a fourth running back moves it not at all.
 */
export function projectMeanPoints(
  rosterIds: number[],
  strengths: Map<number, number>,
  replacementPointsPerStarter: number,
  leagueMeanPoints: number,
  starterCount: number,
): Map<number, number> {
  const values = rosterIds.map((id) => strengths.get(id) ?? 0);
  const meanStrength = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

  // The floor a lineup of pure replacement players would score. Capped below
  // the league mean so k stays positive even under odd settings.
  const base = Math.min(
    starterCount * replacementPointsPerStarter,
    leagueMeanPoints * 0.95,
  );
  const k = meanStrength > 1e-9 ? (leagueMeanPoints - base) / meanStrength : 0;

  const out = new Map<number, number>();
  for (const id of rosterIds) {
    out.set(id, base + k * (strengths.get(id) ?? 0));
  }
  return out;
}

function emptyMatrix(rosterIds: number[]): number[][] {
  return rosterIds.map(() => new Array(rosterIds.length).fill(0));
}

export function simulateSeason(input: SeasonInput): SeasonResult {
  const { rosterIds } = input;
  const n = rosterIds.length;
  const index = new Map(rosterIds.map((id, i) => [id, i]));
  const meanPoints = projectMeanPoints(
    rosterIds,
    input.strengths,
    input.replacementPointsPerStarter,
    input.leagueMeanPoints,
    input.starterCount,
  );

  const baseline = new Map(input.standings.map((s) => [s.rosterId, s]));
  const rng: Rng = mulberry32(input.seed);
  // The regular season generates its own weekly scores inline; only the
  // bracket needs a game player, and only the bracket varies in length.
  const playPlayoff = makeGamePlayer(
    meanPoints,
    input.weeklySigma,
    rng,
    input.playoffWeeksPerRound ?? 1,
  );

  const finishCounts = emptyMatrix(rosterIds);
  const draftCounts = emptyMatrix(rosterIds);
  const regularCounts = emptyMatrix(rosterIds);

  const wins = new Float64Array(n);
  const points = new Float64Array(n);
  const tiebreak = new Float64Array(n);
  const weekScores = new Float64Array(n);

  for (let s = 0; s < input.seasons; s++) {
    for (let i = 0; i < n; i++) {
      const base = baseline.get(rosterIds[i]);
      wins[i] = base ? base.wins + 0.5 * base.ties : 0;
      points[i] = base ? base.pointsFor : 0;
      // A strict total order with no positional bias. Exact ties in the
      // standings would otherwise be resolved by array order, which is the
      // classic way a finish matrix quietly stops being doubly stochastic.
      tiebreak[i] = rng.next();
    }

    for (const week of input.remainingSchedule) {
      for (let i = 0; i < n; i++) {
        weekScores[i] = (meanPoints.get(rosterIds[i]) as number) + input.weeklySigma * rng.normal();
        points[i] += weekScores[i];
      }
      for (const m of week.matchups) {
        const ia = index.get(m.a);
        const ib = index.get(m.b);
        if (ia === undefined || ib === undefined) continue;
        if (weekScores[ia] > weekScores[ib]) wins[ia] += 1;
        else if (weekScores[ib] > weekScores[ia]) wins[ib] += 1;
        else {
          wins[ia] += 0.5;
          wins[ib] += 0.5;
        }
      }
      if (input.leagueAverageMatch) {
        const median = medianOf(weekScores, n);
        for (let i = 0; i < n; i++) {
          if (weekScores[i] > median) wins[i] += 1;
          else if (weekScores[i] < median) wins[i] += 0;
          else wins[i] += 0.5;
        }
      }
    }

    const regularOrder = [...rosterIds].sort((x, y) => {
      const ix = index.get(x) as number;
      const iy = index.get(y) as number;
      if (wins[iy] !== wins[ix]) return wins[iy] - wins[ix];
      if (points[iy] !== points[ix]) return points[iy] - points[ix];
      return tiebreak[iy] - tiebreak[ix];
    });

    const playoffCount = Math.min(input.playoffTeams, n);
    const seeded = regularOrder.slice(0, playoffCount);
    const rest = regularOrder.slice(playoffCount);

    const playoffOrder = rankBracket(seeded, playPlayoff);
    const consolationOrder = input.consolationBracket ? rankBracket(rest, playPlayoff) : rest;
    const finishOrder = [...playoffOrder, ...consolationOrder];

    const draftOrder = toDraftOrder(
      input.draftOrderRule,
      finishOrder,
      regularOrder,
      playoffCount,
    );

    for (let pos = 0; pos < n; pos++) {
      finishCounts[index.get(finishOrder[pos]) as number][pos] += 1;
      regularCounts[index.get(regularOrder[pos]) as number][pos] += 1;
      draftCounts[index.get(draftOrder[pos]) as number][pos] += 1;
    }
  }

  const divide = (counts: number[][]): FinishMatrix => ({
    rosterIds,
    rows: counts.map((row) => row.map((c) => c / input.seasons)),
  });

  return {
    finish: divide(finishCounts),
    draftSlots: divide(draftCounts),
    regularSeason: divide(regularCounts),
    meanPoints,
    seasons: input.seasons,
  };
}

function medianOf(values: Float64Array, n: number): number {
  const copy = Array.from(values.slice(0, n)).sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

/**
 * Final standings and draft order are not always the same ordering. The finish
 * matrix answers championship questions; the draft slot matrix values picks.
 * They are produced separately and never conflated.
 */
export function toDraftOrder(
  rule: DraftOrderRule,
  finishOrder: number[],
  regularOrder: number[],
  playoffCount: number,
): number[] {
  switch (rule) {
    case 'reverse_regular_season':
      return [...regularOrder].reverse();
    case 'consolation_then_playoffs': {
      // Non playoff teams pick first, worst regular season record first.
      const missed = regularOrder.slice(playoffCount).reverse();
      // Playoff teams pick last, champion at the very end.
      const made = [...finishOrder.slice(0, playoffCount)].reverse();
      return [...missed, ...made];
    }
    case 'reverse_final_standings':
    default:
      return [...finishOrder].reverse();
  }
}

/** Weight each finish position by what that position is worth. */
export function expectedPayout(row: number[], payoutWeights: number[]): number {
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += row[i] * (payoutWeights[i] ?? 0);
  return sum;
}

export function payoutByTeam(
  matrix: FinishMatrix,
  payoutWeights: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  matrix.rosterIds.forEach((id, i) => {
    out.set(id, expectedPayout(matrix.rows[i], payoutWeights));
  });
  return out;
}

export function championshipOdds(matrix: FinishMatrix): Map<number, number> {
  const out = new Map<number, number>();
  matrix.rosterIds.forEach((id, i) => out.set(id, matrix.rows[i][0] ?? 0));
  return out;
}

export interface StochasticCheck {
  rowSums: number[];
  columnSums: number[];
  maxRowError: number;
  maxColumnError: number;
  ok: boolean;
}

/**
 * Diagnostic only. If the raw counts do not come out doubly stochastic within
 * sampling error there is a bug to find — most likely in tie handling, in
 * incomplete seasons, or in bracket seeding. This function reports; it never
 * corrects.
 */
export function checkDoublyStochastic(
  matrix: FinishMatrix,
  tolerance = 1e-9,
): StochasticCheck {
  const n = matrix.rosterIds.length;
  const rowSums = matrix.rows.map((row) => row.reduce((a, b) => a + b, 0));
  const columnSums = new Array(n).fill(0);
  for (const row of matrix.rows) {
    for (let j = 0; j < n; j++) columnSums[j] += row[j];
  }
  const maxRowError = Math.max(...rowSums.map((v) => Math.abs(v - 1)));
  const maxColumnError = Math.max(...columnSums.map((v) => Math.abs(v - 1)));
  return {
    rowSums,
    columnSums,
    maxRowError,
    maxColumnError,
    ok: maxRowError <= tolerance && maxColumnError <= tolerance,
  };
}
