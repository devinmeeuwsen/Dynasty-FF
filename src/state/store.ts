import { create } from 'zustand';
import type {
  DraftPick,
  EngineSettings,
  LeagueShape,
  TeamRoster,
  ValuedPlayer,
} from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import { makeCurve } from '../engine/rank';
import { runPipeline, type PipelineResult } from '../engine/values';
import { buildPickOwnership, auditOwnership, type OwnershipAudit } from '../engine/picks';
import type { Scenario } from '../engine/scenario';
import { assessPosture, type PostureResult } from '../engine/posture';
import type { TradeProposal, TradeResult } from '../engine/trade';
import { roundRobin } from '../engine/schedule';
import type { WeekSchedule } from '../engine/schedule';
import type { TeamStanding } from '../engine/season';

import { assemblePlayers, type AssembleResult } from '../data/assemble';
import {
  bundledPickBoard,
  bundledPlayerPool,
  bundledRankingSet,
  bundledSource,
} from '../data/rankings/bundled';
import { remoteSource } from '../data/rankings/remote';
import type { RankingSet, RankingSource } from '../data/rankings/types';
import { rankingFormatFor } from '../data/rankings/types';
import {
  loadLeagueSnapshot,
  pickSeasons,
  playerPool,
  type LeagueSnapshot,
} from '../data/league';
import {
  getLeagues,
  getNflState,
  getPlayers,
  getUser,
  playersSource,
  refreshPlayers,
} from '../data/sleeper';
import type { SleeperLeagueSummary, SleeperUser } from '../data/sleeper';
import type { MatchCandidate } from '../data/names';
import { runSimulation, runTrade } from './simClient';
import { loadPersisted, persist, type Persisted } from './persist';

export type Mode = 'synced' | 'simulated';
export type Screen =
  | 'connect'
  | 'players'
  | 'matrix'
  | 'trade'
  | 'capital'
  | 'roster'
  | 'settings';

export interface ManualLeague {
  teams: number;
  starters: string[];
  benchSlots: number;
  superflex: boolean;
}

interface State {
  screen: Screen;
  mode: Mode;

  // Connection
  username: string;
  user: SleeperUser | null;
  season: string;
  leagues: SleeperLeagueSummary[];
  league: LeagueSnapshot | null;
  userRosterId: number | null;
  connecting: boolean;
  connectError: string | null;
  playersAsOf: { live: boolean; asOf: string } | null;
  refreshingPlayers: boolean;

  // Ranking layer
  rankingSet: RankingSet;
  rankingSources: RankingSource[];
  nameOverrides: Map<string, string>;
  assembled: AssembleResult | null;

  // Values
  pool: MatchCandidate[];
  pipeline: PipelineResult | null;
  values: Map<string, ValuedPlayer>;

  // League model
  shape: LeagueShape;
  rosters: TeamRoster[];
  picks: DraftPick[];
  pickAudit: OwnershipAudit | null;
  schedule: WeekSchedule[];
  standings: TeamStanding[];

  // Simulation
  settings: EngineSettings;
  scenario: Scenario | null;
  simulating: boolean;
  simError: string | null;
  simElapsedMs: number | null;
  /**
   * Set only when the user drags the slider. While null the timeline is read
   * off the simulation, so a league that changes shape re-places the team
   * instead of leaving it on a stale setting nobody revisited.
   */
  contentionOverride: number | null;

  // Trade
  proposal: TradeProposal | null;
  tradeResult: TradeResult | null;
  tradeRunning: boolean;
}

interface Actions {
  go(screen: Screen): void;
  setUsername(username: string): void;
  lookupUser(): Promise<void>;
  selectLeague(leagueId: string): Promise<void>;
  refreshLeague(): Promise<void>;
  refreshPlayerData(): Promise<void>;
  startSimulatedMode(config: ManualLeague): void;
  setSettings(patch: Partial<EngineSettings>): void;
  setContention(weight: number): void;
  /** Hand the timeline back to the simulation after a manual override. */
  clearContentionOverride(): void;
  setRankingSet(set: RankingSet): void;
  addNameOverride(normalisedName: string, playerId: string): void;
  setProposal(proposal: TradeProposal | null): void;
  evaluateProposal(): Promise<void>;
  recompute(): void;
  runBaseline(): Promise<void>;
  hydrateFromUrl(): void;
  reset(): void;
}

const DEFAULT_STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'];

function defaultShape(): LeagueShape {
  return {
    teams: 12,
    starters: [...DEFAULT_STARTERS] as LeagueShape['starters'],
    benchSlots: 6,
    irSlots: 2,
    taxiSlots: 0,
    superflex: false,
    tightEndPremium: 0,
  };
}

export const useStore = create<State & Actions>((set, get) => ({
  screen: 'connect',
  mode: 'simulated',

  username: '',
  user: null,
  season: String(new Date().getFullYear()),
  leagues: [],
  league: null,
  userRosterId: null,
  connecting: false,
  connectError: null,
  playersAsOf: null,
  refreshingPlayers: false,

  rankingSet: bundledRankingSet(),
  rankingSources: [bundledSource, remoteSource],
  nameOverrides: new Map(),
  assembled: null,

  pool: bundledPlayerPool(),
  pipeline: null,
  values: new Map(),

  shape: defaultShape(),
  rosters: [],
  picks: [],
  pickAudit: null,
  schedule: [],
  standings: [],

  settings: { ...DEFAULT_SETTINGS },
  scenario: null,
  simulating: false,
  simError: null,
  contentionOverride: null,
  simElapsedMs: null,

  proposal: null,
  tradeResult: null,
  tradeRunning: false,

  go: (screen) => set({ screen }),

  setUsername: (username) => set({ username, connectError: null }),

  async lookupUser() {
    const username = get().username.trim();
    if (!username) return;
    set({ connecting: true, connectError: null, leagues: [] });
    try {
      const state = await getNflState().catch(() => null);
      const season = state?.league_season ?? get().season;
      const user = await getUser(username);
      const leagues = await getLeagues(user.user_id, season);
      set({
        user,
        season,
        leagues: leagues.filter((l) => l.sport === 'nfl'),
        connecting: false,
        connectError:
          leagues.length === 0
            ? `No ${season} NFL leagues found for ${user.display_name}.`
            : null,
      });
      persistNow(get());
    } catch (error) {
      set({
        connecting: false,
        connectError: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  },

  async selectLeague(leagueId) {
    set({ connecting: true, connectError: null });
    try {
      const [snapshot, players] = await Promise.all([
        loadLeagueSnapshot(leagueId),
        getPlayers(),
      ]);
      const pool = playerPool(players);
      const userRosterId = get().user
        ? (snapshot.ownerToRoster.get(get().user!.user_id) ?? null)
        : null;

      set({
        league: snapshot,
        mode: 'synced',
        shape: snapshot.shape,
        rosters: snapshot.rosters,
        schedule: snapshot.remainingSchedule,
        standings: snapshot.standings,
        pool,
        userRosterId,
        connecting: false,
        playersAsOf: await playersSource(),
        screen: 'players',
      });
      get().recompute();
      persistNow(get());
      void get().runBaseline();
    } catch (error) {
      set({
        connecting: false,
        connectError:
          error instanceof Error
            ? `${error.message} You can still use simulated mode.`
            : 'Could not load that league.',
      });
    }
  },

  async refreshPlayerData() {
    set({ refreshingPlayers: true });
    try {
      const players = await refreshPlayers();
      set({ pool: playerPool(players), playersAsOf: await playersSource() });
      get().recompute();
      if (get().mode === 'synced') void get().runBaseline();
    } catch (error) {
      set({
        connectError:
          error instanceof Error ? error.message : 'Could not refresh player data.',
      });
    } finally {
      set({ refreshingPlayers: false });
    }
  },

  async refreshLeague() {
    const league = get().league;
    if (!league) return;
    await get().selectLeague(league.leagueId);
  },

  startSimulatedMode(config) {
    const shape: LeagueShape = {
      teams: config.teams,
      starters: config.starters as LeagueShape['starters'],
      benchSlots: config.benchSlots,
      irSlots: 0,
      taxiSlots: 0,
      superflex: config.starters.includes('SUPER_FLEX'),
      tightEndPremium: 0,
    };
    set({
      mode: 'simulated',
      league: null,
      userRosterId: null,
      shape,
      rosters: [],
      picks: [],
      schedule: [],
      standings: [],
      scenario: null,
      pool: bundledPlayerPool(),
      screen: 'players',
    });
    get().recompute();
    persistNow(get());
  },

  setSettings(patch) {
    set({ settings: { ...get().settings, ...patch } });
    const needsRecompute =
      'lambda' in patch || 'curve' in patch;
    if (needsRecompute) get().recompute();
    const needsResim =
      needsRecompute ||
      'simSeasons' in patch ||
      'weeklySigma' in patch ||
      'replacementPointsPerStarter' in patch ||
      'leagueMeanPoints' in patch ||
      'seed' in patch ||
      'draftOrderRule' in patch ||
      'pickBaseRank' in patch ||
      'pickExponent' in patch ||
      'futureDiscountPerYear' in patch ||
      'futureUncertaintyPerYear' in patch;
    if (needsResim && get().mode === 'synced') void get().runBaseline();
    persistNow(get());
  },

  setContention(weight) {
    set({
      contentionOverride: weight,
      settings: { ...get().settings, contentionWeight: weight },
    });
    persistNow(get());
  },

  clearContentionOverride() {
    set({ contentionOverride: null });
    const derived = postureOf(get());
    if (derived) {
      set({ settings: { ...get().settings, contentionWeight: derived.weight } });
    }
    persistNow(get());
  },

  setRankingSet(rankingSet) {
    set({ rankingSet });
    get().recompute();
    if (get().mode === 'synced') void get().runBaseline();
  },

  addNameOverride(normalisedName, playerId) {
    const next = new Map(get().nameOverrides);
    next.set(normalisedName, playerId);
    set({ nameOverrides: next });
    get().recompute();
    persistNow(get());
  },

  setProposal: (proposal) => set({ proposal }),

  /**
   * Every edit to a trade fires one of these, so results can arrive out of
   * order. Only the newest request is allowed to write: an older run finishing
   * late would otherwise repaint the panel with numbers for a trade the user
   * has already changed.
   */
  async evaluateProposal() {
    const state = get();
    if (!state.proposal || !state.scenario) return;
    const seq = ++tradeSeq;
    set({ tradeRunning: true, simError: null });
    try {
      const result = await runTrade(buildRequest(state), state.proposal);
      if (seq !== tradeSeq) return;
      set({ tradeResult: result, tradeRunning: false });
    } catch (error) {
      if (seq !== tradeSeq) return;
      set({
        tradeRunning: false,
        simError: error instanceof Error ? error.message : 'Trade evaluation failed.',
      });
    }
  },

  recompute() {
    const state = get();
    const format = rankingFormatFor(state.shape);
    const assembled = assemblePlayers({
      set: state.rankingSet,
      format,
      pool: state.pool,
      required: state.league?.rosteredPlayerIds,
      overrides: state.nameOverrides,
    });

    const ownership = new Map<string, number>();
    for (const roster of state.rosters) {
      for (const id of roster.playerIds) ownership.set(id, roster.rosterId);
    }

    const pipeline = runPipeline({
      players: assembled.players,
      shape: state.shape,
      settings: { lambda: state.settings.lambda, curve: state.settings.curve },
      ownership: ownership.size > 0 ? ownership : undefined,
    });

    const values = new Map(pipeline.players.map((p) => [p.id, p]));

    let picks: DraftPick[] = [];
    let pickAudit: OwnershipAudit | null = null;
    if (state.league) {
      const seasons = pickSeasons(state.league);
      const rosterIds = state.rosters.map((r) => r.rosterId);
      picks = buildPickOwnership(
        rosterIds,
        seasons,
        state.league.draftRounds,
        state.league.tradedPicks,
      );
      pickAudit = auditOwnership(picks, rosterIds, seasons, state.league.draftRounds);
    }

    set({ assembled, pipeline, values, picks, pickAudit });
  },

  async runBaseline() {
    const state = get();
    if (state.rosters.length === 0 || !state.pipeline) return;
    set({ simulating: true, simError: null });
    try {
      const { scenario, elapsedMs } = await runSimulation(buildRequest(state));
      set({ scenario, simulating: false, simElapsedMs: elapsedMs, tradeResult: null });
      // The timeline follows the simulation unless the user has taken it over.
      const next = get();
      if (next.contentionOverride == null && next.userRosterId != null) {
        const derived = assessPosture(scenario, next.userRosterId);
        if (Math.abs(derived.weight - next.settings.contentionWeight) > 1e-9) {
          set({ settings: { ...next.settings, contentionWeight: derived.weight } });
        }
      }
    } catch (error) {
      set({
        simulating: false,
        simError: error instanceof Error ? error.message : 'Simulation failed.',
      });
    }
  },

  hydrateFromUrl() {
    const persisted = loadPersisted();
    if (!persisted) return;
    set({
      username: persisted.username ?? '',
      settings: { ...DEFAULT_SETTINGS, ...persisted.settings },
      nameOverrides: new Map(Object.entries(persisted.nameOverrides ?? {})),
      contentionOverride: persisted.contentionOverride ?? null,
    });
    if (persisted.leagueId) {
      void get().selectLeague(persisted.leagueId);
    } else {
      get().recompute();
    }
  },

  reset() {
    set({
      screen: 'connect',
      mode: 'simulated',
      league: null,
      leagues: [],
      user: null,
      userRosterId: null,
      rosters: [],
      picks: [],
      scenario: null,
      tradeResult: null,
      proposal: null,
      shape: defaultShape(),
    });
    try {
      localStorage.removeItem('dynasty-ff:state');
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      /* ignore */
    }
    get().recompute();
  },
}));

/** The next two draft classes, at minimum. */

function buildRequest(state: State) {
  const league = state.league;
  return {
    shape: state.shape,
    rosters: state.rosters,
    values: [...state.values.entries()],
    picks: state.picks,
    settings: state.settings,
    longTermReplacement:
      state.pipeline?.longTerm.replacement.levels ?? { QB: 0, RB: 0, WR: 0, TE: 0 },
    nextDraftSeason: league ? pickSeasons(league)[0] : new Date().getFullYear() + 1,
    pickBoard: bundledPickBoard(rankingFormatFor(state.shape)),
    season: {
      remainingSchedule:
        state.schedule.length > 0
          ? state.schedule
          : roundRobin(state.rosters.map((r) => r.rosterId), 14),
      standings: state.standings,
      playoffTeams: league?.playoffTeams ?? 6,
      leagueAverageMatch: league?.leagueAverageMatch ?? false,
      consolationBracket: league?.consolationBracket ?? false,
      playoffWeeksPerRound: league?.playoffWeeksPerRound ?? 1,
    },
  };
}

/** Monotonic id for trade runs, so a stale worker reply is dropped. */
let tradeSeq = 0;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistNow(state: State) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const payload: Persisted = {
      username: state.username,
      leagueId: state.league?.leagueId ?? null,
      settings: state.settings,
      nameOverrides: Object.fromEntries(state.nameOverrides),
      contentionOverride: state.contentionOverride,
    };
    persist(payload);
  }, 250);
}

/** Selector helpers used across views. */
export const selectCurve = (state: State) =>
  makeCurve({ lambda: state.settings.lambda, kind: state.settings.curve });

export const selectUserRoster = (state: State) =>
  state.rosters.find((r) => r.rosterId === state.userRosterId) ?? null;

/**
 * Null until there is both a simulation and a team to place — simulated mode
 * has no user roster, so there is nothing to be a contender relative to.
 *
 * NOT for `useStore(selectPosture)`: this builds a new object each call, and a
 * reference-compared snapshot that changes every render spins React until it
 * throws. Components use `usePosture`, which memoises on the two stable inputs.
 */
export function postureOf(state: State): PostureResult | null {
  if (!state.scenario || state.userRosterId == null) return null;
  return assessPosture(state.scenario, state.userRosterId);
}

export const selectTeamName = (state: State, rosterId: number) =>
  state.league?.teamNames.get(rosterId) ??
  state.rosters.find((r) => r.rosterId === rosterId)?.teamName ??
  `Roster ${rosterId}`;

export { pickSeasons };
