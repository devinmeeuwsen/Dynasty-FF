import type { DraftPick, FinishMatrix, TeamRoster, ValuedPlayer } from './types';
import { pickKey } from './picks';
import { evaluateScenario, type Scenario, type ScenarioInput } from './scenario';
import { bestFreeAgents, rosterSpotEffect, type RosterSpotEffect } from './rosterSpots';

/**
 * The trade calculator.
 *
 * It shows three changes per side and never declares a winner. A trade that is
 * win now positive and long term negative is exactly right for a contender and
 * exactly wrong for a rebuilder; a "you won this trade" verdict would destroy
 * the premise of the product. What it does do is surface asymmetry, break
 * draft capital out pick by pick, and evaluate the deal from the other team's
 * side too.
 */

export interface TradeSide {
  rosterId: number;
  /** Player ids leaving this roster. */
  players: string[];
  /** Pick keys leaving this roster. */
  picks: string[];
}

export interface TradeProposal {
  a: TradeSide;
  b: TradeSide;
}

export interface PickCapitalChange {
  key: string;
  pick: DraftPick;
  originalRosterId: number;
  before: number;
  after: number;
  delta: number;
  /** True when the pick changed hands in this trade. */
  moved: boolean;
  /** True when this side still holds the pick after the trade. */
  heldAfter: boolean;
}

export interface TradeSideResult {
  rosterId: number;
  /**
   * Change in this season's team strength, in value units: starting lineup
   * plus the backup line. The championship number below is what this buys;
   * this is the thing itself, and it is on the same scale as long term value,
   * which is what makes the two comparable on one scale.
   */
  strengthDelta: number;
  /** Cuts forced by the roster limit, and free agents the freed spots hold. */
  rosterSpots: RosterSpotEffect;
  /** Change in expected payout, read from the finish matrix. */
  payoutDelta: number;
  /** Under winner take all this is exactly the change in championship odds. */
  championshipDelta: number;
  longTermDelta: number;
  draftCapitalDelta: number;
  /** Composition matters: a near zero total can hide two large offsetting moves. */
  pickBreakdown: PickCapitalChange[];
  playersIn: ValuedPlayer[];
  playersOut: ValuedPlayer[];
  picksIn: DraftPick[];
  picksOut: DraftPick[];
  expectedFinishBefore: number;
  expectedFinishAfter: number;
}

export interface DeadZoneVerdict {
  triggered: boolean;
  kind: 'dead_zone' | 'justified_push' | 'none';
  rosterId: number;
  message: string;
  championshipDelta: number;
  draftCapitalDelta: number;
  /** Picks that gained because the side passed their original owners. */
  offsettingPicks: PickCapitalChange[];
}

export interface TradeResult {
  before: Scenario;
  after: Scenario;
  sides: [TradeSideResult, TradeSideResult];
  /** after − before, cell by cell, for every team in the league. */
  matrixDelta: FinishMatrix;
  /** Draft capital is redistributed, not created. Large drift means a bug. */
  leagueCapitalBefore: number;
  leagueCapitalAfter: number;
  leagueCapitalDrift: number;
  deadZone: DeadZoneVerdict[];
  /** True when every metric moves the right way for both sides. */
  positiveForBoth: boolean;
}

export function applyTrade(
  rosters: TeamRoster[],
  picks: DraftPick[],
  proposal: TradeProposal,
): { rosters: TeamRoster[]; picks: DraftPick[] } {
  const outgoingA = new Set(proposal.a.players);
  const outgoingB = new Set(proposal.b.players);

  const nextRosters = rosters.map((roster) => {
    if (roster.rosterId === proposal.a.rosterId) {
      return {
        ...roster,
        playerIds: roster.playerIds
          .filter((id) => !outgoingA.has(id))
          .concat(proposal.b.players),
      };
    }
    if (roster.rosterId === proposal.b.rosterId) {
      return {
        ...roster,
        playerIds: roster.playerIds
          .filter((id) => !outgoingB.has(id))
          .concat(proposal.a.players),
      };
    }
    return roster;
  });

  const fromA = new Set(proposal.a.picks);
  const fromB = new Set(proposal.b.picks);
  const nextPicks = picks.map((pick) => {
    const key = pickKey(pick);
    if (fromA.has(key) && pick.ownerRosterId === proposal.a.rosterId) {
      return { ...pick, ownerRosterId: proposal.b.rosterId };
    }
    if (fromB.has(key) && pick.ownerRosterId === proposal.b.rosterId) {
      return { ...pick, ownerRosterId: proposal.a.rosterId };
    }
    return { ...pick };
  });

  return { rosters: nextRosters, picks: nextPicks };
}

function expectedFinish(matrix: FinishMatrix, rosterId: number): number {
  const i = matrix.rosterIds.indexOf(rosterId);
  if (i < 0) return 0;
  return matrix.rows[i].reduce((acc, p, j) => acc + p * (j + 1), 0);
}

function sideResult(
  side: TradeSide,
  other: TradeSide,
  base: ScenarioInput,
  afterRosters: TeamRoster[],
  afterPicks: DraftPick[],
  before: Scenario,
  after: Scenario,
  freeAgents: ValuedPlayer[],
): TradeSideResult {
  const value = (id: string) => base.values.get(id);
  const playersOut = side.players.map(value).filter(Boolean) as ValuedPlayer[];
  const playersIn = other.players.map(value).filter(Boolean) as ValuedPlayer[];

  const longTermDelta =
    playersIn.reduce((a, p) => a + p.assetValue, 0) -
    playersOut.reduce((a, p) => a + p.assetValue, 0);

  const beforeByKey = new Map(base.picks.map((p) => [pickKey(p), p]));
  const movedKeys = new Set([...side.picks, ...other.picks]);

  const pickBreakdown: PickCapitalChange[] = [];
  for (const pick of afterPicks) {
    const key = pickKey(pick);
    const original = beforeByKey.get(key);
    if (!original) continue;
    const heldBefore = original.ownerRosterId === side.rosterId;
    const heldAfter = pick.ownerRosterId === side.rosterId;
    if (!heldBefore && !heldAfter) continue;

    const beforeValue = heldBefore ? (before.pickValues.get(key)?.value ?? 0) : 0;
    const afterValue = heldAfter ? (after.pickValues.get(key)?.value ?? 0) : 0;
    pickBreakdown.push({
      key,
      pick,
      originalRosterId: pick.originalRosterId,
      before: beforeValue,
      after: afterValue,
      delta: afterValue - beforeValue,
      moved: movedKeys.has(key),
      heldAfter,
    });
  }
  pickBreakdown.sort((x, y) => y.delta - x.delta);

  const draftCapitalDelta =
    (after.capitalByTeam.get(side.rosterId) ?? 0) -
    (before.capitalByTeam.get(side.rosterId) ?? 0);

  const picksOut = side.picks
    .map((k) => beforeByKey.get(k))
    .filter(Boolean) as DraftPick[];
  const picksIn = other.picks.map((k) => beforeByKey.get(k)).filter(Boolean) as DraftPick[];

  const baselineSize =
    base.rosters.find((r) => r.rosterId === side.rosterId)?.playerIds.length ?? 0;
  const afterRoster = (
    afterRosters.find((r) => r.rosterId === side.rosterId)?.playerIds ?? []
  )
    .map(value)
    .filter(Boolean) as ValuedPlayer[];
  const rosterSpots = rosterSpotEffect(
    afterRoster,
    base.shape,
    playersIn.length - playersOut.length,
    freeAgents,
    baselineSize,
  );

  return {
    rosterId: side.rosterId,
    strengthDelta:
      (after.strengths.get(side.rosterId) ?? 0) -
      (before.strengths.get(side.rosterId) ?? 0),
    rosterSpots,
    payoutDelta:
      (after.payouts.get(side.rosterId) ?? 0) - (before.payouts.get(side.rosterId) ?? 0),
    championshipDelta:
      (after.championship.get(side.rosterId) ?? 0) -
      (before.championship.get(side.rosterId) ?? 0),
    longTermDelta,
    draftCapitalDelta,
    pickBreakdown,
    playersIn,
    playersOut,
    picksIn,
    picksOut,
    expectedFinishBefore: expectedFinish(before.result.finish, side.rosterId),
    expectedFinishAfter: expectedFinish(after.result.finish, side.rosterId),
  };
}

/**
 * The dead zone, corrected for coupling.
 *
 * Moving from a projected tenth place finish to a projected sixth buys almost
 * no championship equity while pushing the team's own picks later. But it is
 * not always bad: if the team owns picks originating with the teams it passes,
 * those picks gain, and the gain can offset or exceed the loss. The simulation
 * tells us which case we are in, so the warning is reported on the actual net
 * rather than on the shape of the trade.
 */
export function assessDeadZone(
  side: TradeSideResult,
  threshold: number,
): DeadZoneVerdict {
  const offsettingPicks = side.pickBreakdown.filter(
    (p) => p.heldAfter && p.originalRosterId !== side.rosterId && p.delta > 0,
  );

  const negligible = Math.abs(side.payoutDelta) < threshold;
  const capitalLoss = side.draftCapitalDelta < 0;
  const improving = side.expectedFinishAfter < side.expectedFinishBefore - 0.25;

  if (negligible && capitalLoss && improving) {
    return {
      triggered: true,
      kind: 'dead_zone',
      rosterId: side.rosterId,
      message:
        'Dead zone: this trade costs you draft capital and buys you almost no championship equity. ' +
        'Probability mass moves between middle finish positions while the first place column barely changes.',
      championshipDelta: side.championshipDelta,
      draftCapitalDelta: side.draftCapitalDelta,
      offsettingPicks,
    };
  }

  if (side.payoutDelta >= threshold * 3 && capitalLoss) {
    return {
      triggered: true,
      kind: 'justified_push',
      rosterId: side.rosterId,
      message:
        'Justified push: this moves you from fringe contender toward genuine favourite. ' +
        'The championship equity gained is large enough to justify the draft capital lost.',
      championshipDelta: side.championshipDelta,
      draftCapitalDelta: side.draftCapitalDelta,
      offsettingPicks,
    };
  }

  if (negligible && capitalLoss && offsettingPicks.length > 0) {
    return {
      triggered: false,
      kind: 'none',
      rosterId: side.rosterId,
      message:
        'Draft capital moved but the picks you hold from other teams gained, which offsets the loss on your own.',
      championshipDelta: side.championshipDelta,
      draftCapitalDelta: side.draftCapitalDelta,
      offsettingPicks,
    };
  }

  return {
    triggered: false,
    kind: 'none',
    rosterId: side.rosterId,
    message: '',
    championshipDelta: side.championshipDelta,
    draftCapitalDelta: side.draftCapitalDelta,
    offsettingPicks,
  };
}

/**
 * What one side gains, in its own currency.
 *
 * The scale in the interface is built on this, and the reason it takes a
 * weight per side rather than one for the trade is the whole premise: a
 * contender and a rebuilder can both come out ahead of the same deal, because
 * they are not buying the same thing. Weighting each side by ITS OWN posture is
 * what lets both bars be green without either number being fudged.
 *
 * The two components are on one scale already — this season's strength and
 * long term value are both value above replacement — so the blend is a real
 * quantity rather than an index. Roster spots land in both: a forced cut costs
 * strength now and an asset later.
 */
export interface SideGain {
  rosterId: number;
  /** This season: lineup and backups, after any cut the roster limit forces. */
  winNow: number;
  /** Everything after it: players, picks, and assets released to fit. */
  future: number;
  weight: number;
  /** weight * winNow + (1 - weight) * future. */
  gained: number;
}

export function sideGain(side: TradeSideResult, weight: number): SideGain {
  const winNow = side.strengthDelta + side.rosterSpots.strengthDelta;
  const future =
    side.longTermDelta + side.draftCapitalDelta + side.rosterSpots.assetDelta;
  return {
    rosterId: side.rosterId,
    winNow,
    future,
    weight,
    gained: weight * winNow + (1 - weight) * future,
  };
}

export function evaluateTrade(
  base: ScenarioInput,
  proposal: TradeProposal,
  precomputedBefore?: Scenario,
): TradeResult {
  const before = precomputedBefore ?? evaluateScenario(base);
  const applied = applyTrade(base.rosters, base.picks, proposal);
  const after = evaluateScenario({
    ...base,
    rosters: applied.rosters,
    picks: applied.picks,
  });

  const freeAgents = bestFreeAgents(
    [...base.values.values()].filter((v) => v.ownerRosterId == null),
  );
  const sideA = sideResult(
    proposal.a, proposal.b, base, applied.rosters, applied.picks, before, after, freeAgents,
  );
  const sideB = sideResult(
    proposal.b, proposal.a, base, applied.rosters, applied.picks, before, after, freeAgents,
  );

  const matrixDelta: FinishMatrix = {
    rosterIds: after.result.finish.rosterIds,
    rows: after.result.finish.rows.map((row, i) =>
      row.map((v, j) => v - before.result.finish.rows[i][j]),
    ),
  };

  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const leagueCapitalBefore = sum(before.capitalByTeam);
  const leagueCapitalAfter = sum(after.capitalByTeam);

  const positiveForBoth = [sideA, sideB].every(
    (s) => s.payoutDelta > 0 && s.longTermDelta > 0 && s.draftCapitalDelta > 0,
  );

  return {
    before,
    after,
    sides: [sideA, sideB],
    matrixDelta,
    leagueCapitalBefore,
    leagueCapitalAfter,
    leagueCapitalDrift: leagueCapitalAfter - leagueCapitalBefore,
    deadZone: [
      assessDeadZone(sideA, base.settings.deadZoneThreshold),
      assessDeadZone(sideB, base.settings.deadZoneThreshold),
    ],
    positiveForBoth,
  };
}
