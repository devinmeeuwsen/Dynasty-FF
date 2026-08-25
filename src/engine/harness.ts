/**
 * Shared test harness: builds a complete, self consistent league from the
 * synthetic universe so each validation test can state its assertion without
 * re-wiring the whole pipeline.
 */
import type { DraftPick, EngineSettings, LeagueShape, TeamRoster, ValuedPlayer } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  makeUniverse,
  makeShape,
  makeRosters,
  ownershipOf,
  type DraftMode,
  type ShapeOptions,
  type UniverseOptions,
} from './fixtures';
import { runPipeline, type PipelineResult } from './values';
import { makeCurve } from './rank';
import { roundRobin } from './schedule';
import { buildPickOwnership, type TradedPickRecord } from './picks';
import type { ScenarioInput } from './scenario';

export interface HarnessOptions {
  universe?: UniverseOptions;
  shape?: ShapeOptions;
  spotsPerTeam?: number;
  draftMode?: DraftMode;
  tierAlpha?: number;
  settings?: Partial<EngineSettings>;
  traded?: TradedPickRecord[];
  seasons?: number[];
  rounds?: number;
  playoffTeams?: number;
  weeks?: number;
}

export interface Harness {
  shape: LeagueShape;
  rosters: TeamRoster[];
  pipeline: PipelineResult;
  values: Map<string, ValuedPlayer>;
  picks: DraftPick[];
  settings: EngineSettings;
  scenario: ScenarioInput;
}

export function buildHarness(options: HarnessOptions = {}): Harness {
  const settings: EngineSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  const shape = makeShape(options.shape);
  const players = makeUniverse(options.universe);
  const rosters = makeRosters(
    players,
    shape,
    options.spotsPerTeam ?? 15,
    options.draftMode ?? 'linear',
    options.tierAlpha ?? 0.3,
  );
  const ownership = ownershipOf(rosters);
  const pipeline = runPipeline({
    players,
    shape,
    settings: { lambda: settings.lambda, curve: settings.curve },
    ownership,
  });
  const values = new Map(pipeline.players.map((p) => [p.id, p]));

  const rosterIds = rosters.map((r) => r.rosterId);
  const seasons = options.seasons ?? [2027, 2028];
  const rounds = options.rounds ?? 4;
  const picks = buildPickOwnership(rosterIds, seasons, rounds, options.traded ?? []);

  const scenario: ScenarioInput = {
    shape,
    rosters,
    values,
    picks,
    settings,
    longTermCurve: makeCurve({ lambda: settings.lambda, kind: settings.curve }),
    longTermReplacement: pipeline.longTerm.replacement.levels,
    nextDraftSeason: seasons[0],
    season: {
      remainingSchedule: roundRobin(rosterIds, options.weeks ?? 14),
      standings: rosters.map((r) => ({
        rosterId: r.rosterId,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
      })),
      playoffTeams: options.playoffTeams ?? 6,
      leagueAverageMatch: false,
      consolationBracket: true,
    },
  };

  return { shape, rosters, pipeline, values, picks, settings, scenario };
}

/** Move a set of players onto one roster, taking them off wherever they were. */
export function transferPlayers(
  rosters: TeamRoster[],
  toRosterId: number,
  playerIds: string[],
): TeamRoster[] {
  const moving = new Set(playerIds);
  return rosters.map((r) => {
    const kept = r.playerIds.filter((id) => !moving.has(id));
    if (r.rosterId === toRosterId) return { ...r, playerIds: [...kept, ...playerIds] };
    return { ...r, playerIds: kept };
  });
}
