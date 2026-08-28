/**
 * Core engine types.
 *
 * This module — and every module under `src/engine` — is pure. No UI imports,
 * no network calls, no globals. Every exported function takes inputs and
 * returns outputs with no side effects.
 */

/** The four positions the value model covers. */
export type Position = 'QB' | 'RB' | 'WR' | 'TE';

export const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE'] as const;

/** A lineup slot as Sleeper expresses it, narrowed to what the engine models. */
export type SlotKind =
  | Position
  | 'FLEX' // RB/WR/TE
  | 'SUPER_FLEX' // QB/RB/WR/TE
  | 'REC_FLEX' // WR/TE
  | 'WRRB_FLEX' // WR/RB
  | 'BN'
  | 'IR'
  | 'TAXI'
  | 'UNSUPPORTED'; // K, DEF, IDP — carried but never valued

/** Which positions may fill a given slot. */
export const SLOT_ELIGIBILITY: Record<SlotKind, readonly Position[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  BN: [],
  IR: [],
  TAXI: [],
  UNSUPPORTED: [],
};

/** The shape of a league, everything the value math needs. */
export interface LeagueShape {
  teams: number;
  /** Starting slots, in order, excluding bench/IR/taxi. */
  starters: SlotKind[];
  benchSlots: number;
  irSlots: number;
  taxiSlots: number;
  /** True when any starting slot can be filled by a QB beyond the dedicated QB slots. */
  superflex: boolean;
  tightEndPremium: number;
}

/** A player as the engine sees him: an identity plus a rank in each ranking set. */
export interface EnginePlayer {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  /** Rank in the dynasty overall list, 1-based. Null when unranked. */
  dynastyOverallRank: number | null;
  /** Rank in the redraft overall list, 1-based. Null when unranked. */
  redraftOverallRank: number | null;
  /** Rank within position in the dynasty positional list, 1-based. */
  dynastyPositionRank: number | null;
  /** Rank within position in the redraft positional list, 1-based. */
  redraftPositionRank: number | null;
  /**
   * 0-100 market value from a source that publishes values, not just an order.
   * When present the rank→value curve is bypassed for this player.
   */
  dynastyRating?: number | null;
  redraftRating?: number | null;
}

/** Which of the two independent pipelines a value came from. */
export type Horizon = 'winNow' | 'longTerm';

/** Per-position replacement level, in raw value units. */
export type ReplacementLevels = Record<Position, number>;

export interface ReplacementResult {
  levels: ReplacementLevels;
  /** The player who sets replacement level at each position, when identifiable. */
  players: Partial<Record<Position, string>>;
  mode: 'observed' | 'simulated';
  /** Simulated mode only: how many players at each position the league absorbs. */
  absorbed?: Record<Position, number>;
}

/** A fully valued player: two independent measurements in the same units. */
export interface ValuedPlayer {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  /**
   * The 0-100 rating. This is the standalone worth of the player, on the same
   * scale for everyone: a free agent gets his real number here rather than
   * being flattened to zero, so the board reads like a rating list.
   */
  winNowRating: number;
  longTermRating: number;
  /**
   * Rating minus this position's replacement level, SIGNED. Positive means the
   * player beats the best freely available body at his position; negative means
   * he is worse than what the waiver wire already offers, which is real
   * information and is why this is not clamped.
   */
  winNowVar: number;
  longTermVar: number;
  /** Alias of the rating kept for the raw pre-replacement value. */
  winNowRaw: number;
  /** Alias of the rating kept for the raw pre-replacement value. */
  longTermRaw: number;
  /**
   * max(0, winNowVar). What the engine consumes — lineup optimisation, roster
   * strength, trades and picks all want marginal value, and a player you would
   * never start contributes none. Display reads winNowVar instead.
   */
  winNow: number;
  /** max(0, longTermVar). */
  longTerm: number;
  /** Directional indicator only. Never a value. */
  timelineGap: number;
  /** Roster id of the owning team, or null when on the waiver wire. */
  ownerRosterId: number | null;
}

/** Tunables the user can reach from the advanced settings panel. */
export interface EngineSettings {
  /** Decay constant in the default exponential rank→value curve. */
  lambda: number;
  curve: CurveKind;
  /** Weight on first place, second place, ... Defaults to winner-take-all. */
  payoutWeights: number[];
  /** 1 = full contender, 0 = full rebuild. */
  contentionWeight: number;
  /** Monte Carlo controls. */
  simSeasons: number;
  weeklySigma: number;
  /** What a replacement level starter scores in a week. Sets the intercept. */
  replacementPointsPerStarter: number;
  leagueMeanPoints: number;
  seed: number;
  /** Pick model controls. */
  pickBaseRank: number;
  pickExponent: number;
  futureDiscountPerYear: number;
  futureUncertaintyPerYear: number;
  draftOrderRule: DraftOrderRule;
  /** Championship-probability gain below which the dead zone warning fires. */
  deadZoneThreshold: number;
}

export type CurveKind = 'exponential' | 'power' | 'logistic';

export type DraftOrderRule =
  | 'reverse_final_standings'
  | 'reverse_regular_season'
  | 'consolation_then_playoffs';

export const DEFAULT_SETTINGS: EngineSettings = {
  lambda: 0.021,
  curve: 'exponential',
  payoutWeights: [1],
  contentionWeight: 0.5,
  simSeasons: 8000,
  weeklySigma: 28,
  replacementPointsPerStarter: 9,
  leagueMeanPoints: 112,
  seed: 20260825,
  pickBaseRank: 14,
  pickExponent: 0.62,
  futureDiscountPerYear: 0.9,
  futureUncertaintyPerYear: 0.35,
  draftOrderRule: 'reverse_final_standings',
  deadZoneThreshold: 0.01,
};

/** A team's roster, as the simulation needs it. */
export interface TeamRoster {
  rosterId: number;
  ownerId: string | null;
  teamName: string;
  playerIds: string[];
  /** Regular season record so far, for mid-season leagues. */
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

/** A future draft pick, identified by season, round and ORIGINAL owner. */
export interface DraftPick {
  season: number;
  round: number;
  /** The roster whose finish determines where this pick lands. Load bearing. */
  originalRosterId: number;
  /** Who holds it right now. */
  ownerRosterId: number;
}

/** Rows are teams (by roster id), columns are finish positions 1..N. */
export interface FinishMatrix {
  rosterIds: number[];
  /** rows[i][j] = P(team i finishes in position j+1). */
  rows: number[][];
}
