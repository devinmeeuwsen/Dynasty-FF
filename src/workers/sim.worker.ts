/// <reference lib="webworker" />
import type { DraftPick, EngineSettings, LeagueShape, TeamRoster, ValuedPlayer } from '../engine/types';
import type { WeekSchedule } from '../engine/schedule';
import type { TeamStanding } from '../engine/season';
import { makeCurve } from '../engine/rank';
import { evaluateScenario, type Scenario, type ScenarioInput } from '../engine/scenario';
import { evaluateTrade, type TradeProposal, type TradeResult } from '../engine/trade';
import type { ReplacementLevels } from '../engine/types';

/**
 * The simulation runs here so the interface stays responsive. Several thousand
 * simulated seasons and a full re-valuation of every pick in the league is tens
 * of milliseconds of solid arithmetic; on the main thread it would drop frames
 * every time the contention slider moved.
 */

export interface SimRequestBase {
  id: number;
  shape: LeagueShape;
  rosters: TeamRoster[];
  values: [string, ValuedPlayer][];
  picks: DraftPick[];
  settings: EngineSettings;
  longTermReplacement: ReplacementLevels;
  nextDraftSeason: number;
  season: {
    remainingSchedule: WeekSchedule[];
    standings: TeamStanding[];
    playoffTeams: number;
    leagueAverageMatch: boolean;
    consolationBracket: boolean;
  };
}

export type SimRequest =
  | ({ kind: 'baseline' } & SimRequestBase)
  | ({ kind: 'trade'; proposal: TradeProposal } & SimRequestBase);

export type SimResponse =
  | { id: number; kind: 'baseline'; scenario: Scenario; elapsedMs: number }
  | { id: number; kind: 'trade'; result: TradeResult; elapsedMs: number }
  | { id: number; kind: 'error'; message: string };

function toScenarioInput(request: SimRequestBase): ScenarioInput {
  return {
    shape: request.shape,
    rosters: request.rosters,
    values: new Map(request.values),
    picks: request.picks,
    settings: request.settings,
    longTermCurve: makeCurve({
      lambda: request.settings.lambda,
      kind: request.settings.curve,
    }),
    longTermReplacement: request.longTermReplacement,
    nextDraftSeason: request.nextDraftSeason,
    season: request.season,
  };
}

self.onmessage = (event: MessageEvent<SimRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    const input = toScenarioInput(request);
    if (request.kind === 'baseline') {
      const scenario = evaluateScenario(input);
      const response: SimResponse = {
        id: request.id,
        kind: 'baseline',
        scenario,
        elapsedMs: performance.now() - started,
      };
      self.postMessage(response);
      return;
    }

    // Baseline and scenario run under the same seed, so the difference between
    // the two matrices reflects the roster change and not Monte Carlo noise.
    const result = evaluateTrade(input, request.proposal);
    const response: SimResponse = {
      id: request.id,
      kind: 'trade',
      result,
      elapsedMs: performance.now() - started,
    };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies SimResponse);
  }
};
