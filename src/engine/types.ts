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
   * The player's Rating: KeepTradeCut's dynasty value on a 0-100 scale.
   *
   * This is THE number. The dynasty market already prices a player's whole
   * future, this season included, so it needs no blending with anything.
   */
  rating: number;
  /**
   * Redraft value: FantasyPros expert consensus order, priced on the same
   * 0-100 ladder as the rating. What he is worth for this season alone.
   */
  redraft: number;
  /**
   * Long term value: rating minus redraft, SIGNED.
   *
   * Negative means the market pays him more for this season than for his
   * career — an ageing quarterback. Positive means he is a better asset than
   * he is a starter — a rookie. Near zero means both, which is the balanced
   * band. Because both inputs are read off the same ladder, a player who
   * stands equally high on each lands at exactly zero.
   */
  longTerm: number;
  /** Rating minus this position's dynasty replacement level, signed. */
  ratingVar: number;
  /** Redraft value minus this position's redraft replacement level, signed. */
  redraftVar: number;
  /**
   * max(0, ratingVar). What long term asset arithmetic consumes — roster
   * strength, trade totals, contention posture.
   */
  assetValue: number;
  /**
   * max(0, redraftVar). What the season simulation consumes: a player who
   * cannot crack a lineup contributes nothing to what a team scores.
   */
  lineupValue: number;
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
  /**
   * What one open roster spot is worth, in value above replacement.
   *
   * Not the value of the free agent who fills it — that is zero by
   * construction, because replacement level IS the best free agent. This is
   * the value of the OPTION the spot carries: sign a wire player, keep him if
   * he climbs, drop him for nothing and draw again if he does not. The
   * expectation of a draw is zero; the option is worth its volatility, which
   * is never negative.
   *
   * The default is an estimate, not a measurement, and it is here in settings
   * for exactly that reason. Twelve teams times roughly three speculative
   * spots is thirty-six spots chasing maybe three to five players a season who
   * go from unrostered to genuinely startable at around thirty points of value
   * — call it three. That lands a speculative spot next to a mediocre first
   * backup, which is the right order of magnitude for how managers treat them.
   */
  rosterSpotOptionValue: number;
  /**
   * How many seasons a player's value to his own roster is measured over.
   *
   * One season was too short and read every young player as useless: a rookie
   * behind two starters contributes nothing this year and everything two years
   * from now, and a single-season window cannot tell him apart from a
   * thirty-year-old in the same seat. Three is the practical planning horizon
   * in dynasty — far enough to see a breakout arrive, near enough that the
   * projection is still worth something.
   */
  usageHorizonYears: number;
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
  rosterSpotOptionValue: 3,
  usageHorizonYears: 3,
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
