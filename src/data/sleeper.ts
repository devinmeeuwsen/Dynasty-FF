import type { Position, SlotKind } from '../engine/types';
import { cacheAge, cacheGet, cacheSet } from './cache';
import { bundledPlayers, bundledPlayersAsOf } from './playerPool';

/**
 * Sleeper integration.
 *
 * Sleeper publishes a free, read-only public feed that needs no
 * authentication, so this is the primary path into the application. Every
 * shape below was checked against live responses rather than assumed.
 */

const BASE = 'https://api.sleeper.app/v1';

/** Sleeper asks that the player file be fetched no more than once per day. */
export const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;
const LEAGUE_TTL_MS = 5 * 60 * 1000;
const PLAYERS_CACHE_KEY = 'sleeper:players:nfl';

export class SleeperError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SleeperError';
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`);
  } catch {
    throw new SleeperError('Could not reach Sleeper. The app still works in simulated mode.');
  }
  if (response.status === 404) throw new SleeperError('Not found on Sleeper.', 404);
  if (!response.ok) {
    throw new SleeperError(`Sleeper returned ${response.status}.`, response.status);
  }
  return (await response.json()) as T;
}

// --- Response shapes -------------------------------------------------------

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar: string | null;
}

export interface SleeperLeagueSummary {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  total_rosters: number;
  status: string;
  avatar: string | null;
  previous_league_id: string | null;
  settings: Record<string, number>;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
  metadata: Record<string, string> | null;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata: Record<string, string> | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperMatchupEntry {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters: string[] | null;
  players: string[] | null;
}

export interface SleeperNflState {
  week: number;
  season: string;
  season_type: string;
  display_week: number;
  league_season: string;
  previous_season: string;
}

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[] | null;
  team?: string | null;
  age?: number | null;
  years_exp?: number | null;
  active?: boolean;
  status?: string | null;
  injury_status?: string | null;
  search_rank?: number | null;
  number?: number | null;
}

// --- Endpoints -------------------------------------------------------------

export const getNflState = () => get<SleeperNflState>('/state/nfl');

export async function getUser(username: string): Promise<SleeperUser> {
  const trimmed = username.trim();
  if (!trimmed) throw new SleeperError('Enter a Sleeper username.');
  try {
    const user = await get<SleeperUser | null>(`/user/${encodeURIComponent(trimmed)}`);
    if (!user) throw new SleeperError(`No Sleeper user called “${trimmed}”.`, 404);
    return user;
  } catch (error) {
    if (error instanceof SleeperError && error.status === 404) {
      throw new SleeperError(`No Sleeper user called “${trimmed}”.`, 404);
    }
    throw error;
  }
}

export const getLeagues = (userId: string, season: string) =>
  get<SleeperLeagueSummary[]>(`/user/${userId}/leagues/nfl/${season}`);

export const getLeague = (leagueId: string) =>
  get<SleeperLeagueSummary>(`/league/${leagueId}`);

export const getRosters = (leagueId: string) =>
  get<SleeperRoster[]>(`/league/${leagueId}/rosters`);

export const getLeagueUsers = (leagueId: string) =>
  get<SleeperLeagueUser[]>(`/league/${leagueId}/users`);

export const getTradedPicks = (leagueId: string) =>
  get<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`);

export const getMatchups = (leagueId: string, week: number) =>
  get<SleeperMatchupEntry[]>(`/league/${leagueId}/matchups/${week}`);

/**
 * The player file.
 *
 * Never fetched on page load. A trimmed pool ships with the build, so the first
 * visit costs no network and no wait; a previously cached live pull takes
 * precedence over it, and `refreshPlayers` pulls live on demand.
 */
export async function getPlayers(): Promise<Record<string, SleeperPlayer>> {
  const cached = await cacheGet<Record<string, SleeperPlayer>>(PLAYERS_CACHE_KEY);
  if (cached) return cached;
  return bundledPlayers();
}

/**
 * Pull the live player file from Sleeper and cache it for a day. Only ever
 * called from an explicit user action, which keeps us well inside Sleeper's
 * request-once-per-day guidance.
 */
export async function refreshPlayers(): Promise<Record<string, SleeperPlayer>> {
  const players = await get<Record<string, SleeperPlayer>>('/players/nfl');
  const trimmed = trimPlayerFile(players);
  await cacheSet(PLAYERS_CACHE_KEY, trimmed, PLAYERS_TTL_MS);
  return trimmed;
}

/** Where the player data currently in use came from. */
export async function playersSource(): Promise<{ live: boolean; asOf: string }> {
  const at = await cacheAge(PLAYERS_CACHE_KEY, PLAYERS_TTL_MS);
  return at
    ? { live: true, asOf: at.toISOString().slice(0, 10) }
    : { live: false, asOf: bundledPlayersAsOf };
}

export const playersCachedAt = () => cacheAge(PLAYERS_CACHE_KEY, PLAYERS_TTL_MS);

/**
 * The raw file carries dozens of identifiers per player for services this app
 * does not use. Keeping only what is needed cuts the cached payload by roughly
 * ninety percent, which matters because it has to survive in IndexedDB.
 */
function trimPlayerFile(
  players: Record<string, SleeperPlayer>,
): Record<string, SleeperPlayer> {
  const out: Record<string, SleeperPlayer> = {};
  for (const [id, p] of Object.entries(players)) {
    const position = p.position ?? p.fantasy_positions?.[0];
    if (!position) continue;
    if (!VALUED_POSITIONS.has(position) && !CARRIED_POSITIONS.has(position)) continue;
    out[id] = {
      player_id: id,
      full_name: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' '),
      position,
      team: p.team ?? null,
      age: p.age ?? null,
      years_exp: p.years_exp ?? null,
      active: p.active ?? false,
      injury_status: p.injury_status ?? null,
      search_rank: p.search_rank ?? null,
      number: p.number ?? null,
    };
  }
  return out;
}

const VALUED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const CARRIED_POSITIONS = new Set(['K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX']);

export function isValuedPosition(position: string | undefined): position is Position {
  return !!position && VALUED_POSITIONS.has(position);
}

/**
 * Translate Sleeper's roster_positions into the engine's slot vocabulary.
 * Slots the value model does not cover — kickers, defences, individual
 * defensive players — become UNSUPPORTED: they are shown in the interface and
 * excluded from valuation rather than silently mapped onto something else.
 */
export function toSlotKind(raw: string): SlotKind {
  switch (raw) {
    case 'QB':
    case 'RB':
    case 'WR':
    case 'TE':
    case 'FLEX':
    case 'SUPER_FLEX':
    case 'REC_FLEX':
    case 'BN':
    case 'IR':
      return raw;
    case 'WRRB_FLEX':
    case 'WRRB_WRT':
      return 'WRRB_FLEX';
    case 'TAXI':
      return 'TAXI';
    default:
      return 'UNSUPPORTED';
  }
}

/** Fetch every regular season week of matchups, tolerating gaps. */
export async function getSchedule(
  leagueId: string,
  lastRegularWeek: number,
): Promise<{ week: number; entries: SleeperMatchupEntry[] }[]> {
  const key = `sleeper:schedule:${leagueId}:${lastRegularWeek}`;
  const cached = await cacheGet<{ week: number; entries: SleeperMatchupEntry[] }[]>(key);
  if (cached) return cached;

  const weeks = Array.from({ length: Math.max(0, lastRegularWeek) }, (_, i) => i + 1);
  const results = await Promise.all(
    weeks.map(async (week) => {
      try {
        return { week, entries: await getMatchups(leagueId, week) };
      } catch {
        return { week, entries: [] as SleeperMatchupEntry[] };
      }
    }),
  );
  const usable = results.filter((r) => r.entries.length > 0);
  await cacheSet(key, usable, LEAGUE_TTL_MS);
  return usable;
}
