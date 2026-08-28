import type { LeagueShape, SlotKind, TeamRoster } from '../engine/types';
import type { WeekSchedule } from '../engine/schedule';
import { completedFromSleeper, roundRobin, scheduleFromSleeper } from '../engine/schedule';
import type { TeamStanding } from '../engine/season';
import type { MatchCandidate } from './names';
import {
  getLeague,
  getLeagueUsers,
  getRosters,
  getSchedule,
  getTradedPicks,
  isValuedPosition,
  toSlotKind,
  type SleeperLeagueSummary,
  type SleeperPlayer,
  type SleeperTradedPick,
} from './sleeper';

/**
 * Everything one synced league contributes to the model, in engine vocabulary.
 * The user connects a league and enters nothing else.
 */
export interface LeagueSnapshot {
  leagueId: string;
  name: string;
  season: number;
  status: string;
  shape: LeagueShape;
  rosters: TeamRoster[];
  teamNames: Map<number, string>;
  ownerToRoster: Map<string, number>;
  tradedPicks: SleeperTradedPick[];
  remainingSchedule: WeekSchedule[];
  completedWeeks: number;
  standings: TeamStanding[];
  playoffTeams: number;
  playoffWeekStart: number;
  regularSeasonWeeks: number;
  leagueAverageMatch: boolean;
  consolationBracket: boolean;
  draftRounds: number;
  /** Slots the value model does not cover, surfaced rather than hidden. */
  unsupportedSlots: string[];
  /** Formats the model does not fully represent, surfaced as warnings. */
  warnings: string[];
  rosteredPlayerIds: Set<string>;
  scheduleSource: 'sleeper' | 'generated';
  syncedAt: Date;
}

function countSlots(positions: string[]): {
  starters: SlotKind[];
  bench: number;
  ir: number;
  taxi: number;
  unsupported: string[];
} {
  const starters: SlotKind[] = [];
  const unsupported: string[] = [];
  let bench = 0;
  let ir = 0;
  let taxi = 0;

  for (const raw of positions) {
    const kind = toSlotKind(raw);
    if (kind === 'BN') bench += 1;
    else if (kind === 'IR') ir += 1;
    else if (kind === 'TAXI') taxi += 1;
    else {
      starters.push(kind);
      if (kind === 'UNSUPPORTED') unsupported.push(raw);
    }
  }
  return { starters, bench, ir, taxi, unsupported };
}

export function toLeagueShape(league: SleeperLeagueSummary): {
  shape: LeagueShape;
  unsupported: string[];
} {
  const { starters, bench, ir, taxi, unsupported } = countSlots(league.roster_positions ?? []);
  const qbSlots = starters.filter((s) => s === 'QB').length;
  const superflex = starters.includes('SUPER_FLEX') || qbSlots > 1;

  return {
    shape: {
      teams: league.total_rosters,
      starters,
      benchSlots: bench,
      irSlots: ir,
      taxiSlots: taxi || (league.settings?.taxi_slots ?? 0),
      superflex,
      tightEndPremium: league.scoring_settings?.bonus_rec_te ?? 0,
    },
    unsupported,
  };
}

function formatWarnings(
  league: SleeperLeagueSummary,
  unsupported: string[],
  rosteredCount: number,
): string[] {
  const warnings: string[] = [];
  const s = league.settings ?? {};

  // A pre-draft league has empty rosters, which makes every team identical and
  // the finish matrix uniform. That is arithmetically correct and completely
  // uninformative, so say so rather than letting it look like a result.
  const expected = league.total_rosters * (league.roster_positions?.length ?? 0);
  if (rosteredCount < expected * 0.25) {
    warnings.push(
      `Only ${rosteredCount} players are rostered across the league, so lineup strength is ` +
        'near zero for everyone and the finish matrix comes out uniform. Values and replacement ' +
        'level are still meaningful; the simulation will not be until the draft happens.',
    );
  }
  if (s.best_ball === 1) {
    warnings.push(
      'Best ball league: lineups are set automatically after the fact, so the optimizer already ' +
        'matches how this league scores. Bench depth is worth more here than the model assumes.',
    );
  }
  if (s.type === 1) {
    warnings.push('Keeper league: keeper costs are not modelled.');
  }
  if (s.league_average_match === 1) {
    warnings.push('Median match is on. The simulation plays it each week.');
  }
  if (unsupported.length > 0) {
    warnings.push(
      `Starting slots the value model does not cover (${[...new Set(unsupported)].join(', ')}) are ` +
        'excluded from valuation. Players in them still occupy roster spots.',
    );
  }
  return warnings;
}

export async function loadLeagueSnapshot(leagueId: string): Promise<LeagueSnapshot> {
  const [league, rosters, users, tradedPicks] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getLeagueUsers(leagueId),
    getTradedPicks(leagueId).catch(() => [] as SleeperTradedPick[]),
  ]);

  const { shape, unsupported } = toLeagueShape(league);
  const settings = league.settings ?? {};
  const playoffWeekStart = settings.playoff_week_start || 15;
  const regularSeasonWeeks = Math.max(1, playoffWeekStart - 1);

  const displayName = new Map(users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name]));

  const teamNames = new Map<number, string>();
  const ownerToRoster = new Map<string, number>();
  const rosteredPlayerIds = new Set<string>();

  const teamRosters: TeamRoster[] = rosters.map((r) => {
    const name = r.metadata?.team_name || displayName.get(r.owner_id ?? '') || `Roster ${r.roster_id}`;
    teamNames.set(r.roster_id, name);
    if (r.owner_id) ownerToRoster.set(r.owner_id, r.roster_id);
    for (const co of r.co_owners ?? []) ownerToRoster.set(co, r.roster_id);
    for (const id of r.players ?? []) rosteredPlayerIds.add(id);
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      teamName: name,
      playerIds: [...(r.players ?? [])],
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    };
  });

  const rosterIds = teamRosters.map((r) => r.rosterId);

  // The schedule only exists once Sleeper has generated it. In the offseason,
  // or when the fetch fails, fall back to a generated round robin rather than
  // refusing to simulate.
  let remainingSchedule: WeekSchedule[] = [];
  let completedWeeks = 0;
  let scheduleSource: LeagueSnapshot['scheduleSource'] = 'generated';

  // Sleeper only publishes a schedule once the season is set up. Asking for
  // fourteen empty weeks during the offseason is fourteen wasted requests.
  const seasonStarted = !['pre_draft', 'drafting'].includes(league.status);

  try {
    const weeks = seasonStarted ? await getSchedule(leagueId, regularSeasonWeeks) : [];
    const full = scheduleFromSleeper(weeks);
    const completed = completedFromSleeper(weeks);
    completedWeeks = completed.length;
    const played = new Set(completed.map((c) => c.week));
    const upcoming = full.filter((w) => !played.has(w.week) && w.matchups.length > 0);
    if (upcoming.length > 0) {
      remainingSchedule = upcoming;
      scheduleSource = 'sleeper';
    }
  } catch {
    /* fall through to the generated schedule */
  }

  if (remainingSchedule.length === 0) {
    remainingSchedule = roundRobin(rosterIds, Math.max(1, regularSeasonWeeks - completedWeeks));
    scheduleSource = 'generated';
  }

  return {
    leagueId,
    name: league.name,
    season: Number(league.season),
    status: league.status,
    shape,
    rosters: teamRosters,
    teamNames,
    ownerToRoster,
    tradedPicks,
    remainingSchedule,
    completedWeeks,
    standings: teamRosters.map((r) => ({
      rosterId: r.rosterId,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
    })),
    playoffTeams: settings.playoff_teams || 6,
    playoffWeekStart,
    regularSeasonWeeks,
    leagueAverageMatch: settings.league_average_match === 1,
    consolationBracket: !!(league as { loser_bracket_id?: string }).loser_bracket_id,
    draftRounds: settings.draft_rounds || 4,
    unsupportedSlots: [...new Set(unsupported)],
    warnings: formatWarnings(league, unsupported, rosteredPlayerIds.size),
    rosteredPlayerIds,
    scheduleSource,
    syncedAt: new Date(),
  };
}

/** The candidate pool the name matcher works against. */
export function playerPool(players: Record<string, SleeperPlayer>): MatchCandidate[] {
  const pool: (MatchCandidate & { age: number | null })[] = [];
  for (const p of Object.values(players)) {
    if (!isValuedPosition(p.position)) continue;
    const name = p.full_name?.trim();
    if (!name) continue;
    pool.push({
      id: p.player_id,
      name,
      position: p.position,
      team: p.team ?? null,
      age: p.age ?? (p.years_exp != null ? 22 + p.years_exp : null),
    });
  }
  return pool;
}
