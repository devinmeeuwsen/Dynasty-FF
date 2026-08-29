import type {
  DraftPick,
  EngineSettings,
  LeagueShape,
  TeamRoster,
  ValuedPlayer,
} from './types';
import type { RankToValue } from './rank';
import type { PickBoard } from './pickValues';
import type { ReplacementLevels } from './types';
import { optimizeLineup, startingSlots, type LineupPlayer } from './lineup';
import {
  simulateSeason,
  payoutByTeam,
  championshipOdds,
  type SeasonInput,
  type SeasonResult,
} from './season';
import {
  draftCapital,
  valueAllPicks,
  type PickValuation,
  type PickValuationContext,
} from './picks';

/**
 * A scenario is the whole league evaluated end to end: lineups, the season
 * simulation, the finish and draft slot matrices, and every pick in the league
 * valued off the new matrix. Trades are evaluated by building a second
 * scenario on modified rosters and diffing the two — never by adjusting the
 * first analytically. The concentration effect the model exists to capture
 * only falls out of a re-run.
 */

export interface ScenarioInput {
  shape: LeagueShape;
  rosters: TeamRoster[];
  values: ReadonlyMap<string, ValuedPlayer>;
  picks: DraftPick[];
  settings: EngineSettings;
  longTermCurve: RankToValue;
  /** Published rookie pick values. Absent in fixtures, which use the curve. */
  pickBoard?: PickBoard;
  longTermReplacement: ReplacementLevels;
  nextDraftSeason: number;
  season: Omit<
    SeasonInput,
    | 'rosterIds'
    | 'strengths'
    | 'seasons'
    | 'weeklySigma'
    | 'replacementPointsPerStarter'
    | 'starterCount'
    | 'leagueMeanPoints'
    | 'seed'
    | 'draftOrderRule'
  >;
}

export interface Scenario {
  result: SeasonResult;
  payouts: Map<number, number>;
  championship: Map<number, number>;
  strengths: Map<number, number>;
  starters: Map<number, string[]>;
  longTermByTeam: Map<number, number>;
  winNowByTeam: Map<number, number>;
  pickValues: Map<string, PickValuation>;
  capitalByTeam: Map<number, number>;
}

function lineupPlayers(
  roster: TeamRoster,
  values: ReadonlyMap<string, ValuedPlayer>,
): LineupPlayer[] {
  const out: LineupPlayer[] = [];
  for (const id of roster.playerIds) {
    const v = values.get(id);
    if (!v) continue;
    out.push({ id, position: v.position, value: v.lineupValue });
  }
  return out;
}

export function evaluateScenario(input: ScenarioInput): Scenario {
  const rosterIds = input.rosters.map((r) => r.rosterId);
  const strengths = new Map<number, number>();
  const starters = new Map<number, string[]>();
  const longTermByTeam = new Map<number, number>();
  const winNowByTeam = new Map<number, number>();

  for (const roster of input.rosters) {
    const players = lineupPlayers(roster, input.values);
    const lineup = optimizeLineup(players, input.shape.starters);
    strengths.set(roster.rosterId, lineup.total);
    starters.set(roster.rosterId, lineup.starterIds);

    let lt = 0;
    let wn = 0;
    for (const id of roster.playerIds) {
      const v = input.values.get(id);
      if (!v) continue;
      lt += v.assetValue;
      wn += v.lineupValue;
    }
    longTermByTeam.set(roster.rosterId, lt);
    winNowByTeam.set(roster.rosterId, wn);
  }

  const result = simulateSeason({
    ...input.season,
    rosterIds,
    strengths,
    draftOrderRule: input.settings.draftOrderRule,
    seasons: input.settings.simSeasons,
    weeklySigma: input.settings.weeklySigma,
    replacementPointsPerStarter: input.settings.replacementPointsPerStarter,
    starterCount: startingSlots(input.shape.starters).length,
    leagueMeanPoints: input.settings.leagueMeanPoints,
    seed: input.settings.seed,
  });

  const ctx: PickValuationContext = {
    draftSlots: result.draftSlots,
    teams: rosterIds.length,
    curve: input.longTermCurve,
    pickBoard: input.pickBoard,
    longTermReplacement: input.longTermReplacement,
    settings: input.settings,
    nextDraftSeason: input.nextDraftSeason,
  };
  const pickValues = valueAllPicks(input.picks, ctx);

  const capitalByTeam = new Map<number, number>();
  for (const id of rosterIds) {
    capitalByTeam.set(id, draftCapital(input.picks, pickValues, id));
  }

  return {
    result,
    payouts: payoutByTeam(result.finish, input.settings.payoutWeights),
    championship: championshipOdds(result.finish),
    strengths,
    starters,
    longTermByTeam,
    winNowByTeam,
    pickValues,
    capitalByTeam,
  };
}

/** The roster efficiency view: marginal value of every player a team owns. */
export interface RosterEfficiencyEntry {
  player: ValuedPlayer;
  /** How much the optimal starting total drops if this player is removed. */
  marginalWinNow: number;
  starting: boolean;
}

export function rosterEfficiency(
  roster: TeamRoster,
  values: ReadonlyMap<string, ValuedPlayer>,
  shape: LeagueShape,
): RosterEfficiencyEntry[] {
  const players = lineupPlayers(roster, values);
  const lineup = optimizeLineup(players, shape.starters);
  const base = lineup.total;
  const startingSet = new Set(lineup.starterIds);

  return players
    .map((p) => {
      const without = optimizeLineup(
        players.filter((x) => x.id !== p.id),
        shape.starters,
      ).total;
      const value = values.get(p.id) as ValuedPlayer;
      return {
        player: value,
        marginalWinNow: base - without,
        starting: startingSet.has(p.id),
      };
    })
    .sort((a, b) => b.marginalWinNow - a.marginalWinNow || b.player.assetValue - a.player.assetValue);
}
