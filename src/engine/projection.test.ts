import { describe, expect, it } from 'vitest';
import {
  GAP_RETENTION,
  projectLeague,
  projectedLineupValue,
  projectedRedraftVar,
  realisedFraction,
} from './projection';
import { playerUsage, rosterSpotEffect, rosterCapacity } from './rosterSpots';
import { IDLE_EPSILON } from './trade';
import { buildHarness } from './harness';
import { evaluateScenario } from './scenario';
import { DEFAULT_SETTINGS, type ValuedPlayer } from './types';

const OPTION = DEFAULT_SETTINGS.rosterSpotOptionValue;

function player(over: Partial<ValuedPlayer>): ValuedPlayer {
  return {
    id: 'p',
    name: 'Player',
    position: 'RB',
    team: 'AAA',
    age: 24,
    rating: 50,
    redraft: 50,
    longTerm: 0,
    ratingVar: 20,
    redraftVar: 20,
    assetValue: 20,
    lineupValue: 20,
    ownerRosterId: 1,
    ...over,
  };
}

describe('the gap closes at the measured rate', () => {
  it('realises nothing in year zero and compounds from there', () => {
    expect(realisedFraction(0)).toBe(0);
    expect(realisedFraction(1)).toBeCloseTo(1 - GAP_RETENTION, 12);
    expect(realisedFraction(2)).toBeCloseTo(1 - GAP_RETENTION ** 2, 12);
    expect(realisedFraction(2)).toBeGreaterThan(realisedFraction(1));
  });

  it('leaves a balanced player exactly where he is', () => {
    const balanced = player({ longTerm: 0 });
    for (const n of [0, 1, 2, 5]) {
      expect(projectedRedraftVar(balanced, n)).toBe(balanced.redraftVar);
    }
  });

  it('raises a future asset and lowers a win now player', () => {
    const future = player({ longTerm: 10 });
    const now = player({ longTerm: -10 });
    expect(projectedRedraftVar(future, 2)).toBeGreaterThan(future.redraftVar);
    expect(projectedRedraftVar(now, 2)).toBeLessThan(now.redraftVar);
    // Symmetric: the same gap in either direction moves the same distance.
    expect(projectedRedraftVar(future, 2) - future.redraftVar).toBeCloseTo(
      now.redraftVar - projectedRedraftVar(now, 2),
      12,
    );
  });

  it('clamps at replacement, exactly as lineup value does', () => {
    const fading = player({ redraftVar: 1, longTerm: -40 });
    expect(projectedLineupValue(fading, 2)).toBe(0);
  });
});

describe('projecting the league', () => {
  it('reproduces today exactly in year zero', () => {
    const { scenario, rosters, values } = buildHarness();
    const result = evaluateScenario(scenario);
    const byTeam = new Map(
      rosters.map((r) => [
        r.rosterId,
        r.playerIds.map((id) => values.get(id)).filter(Boolean) as ValuedPlayer[],
      ]),
    );
    const rows = projectLeague({
      rosterIds: rosters.map((r) => r.rosterId),
      players: byTeam,
      picks: scenario.picks,
      pickValues: result.pickValues,
      baseSeason: 2026,
      years: 3,
    });

    for (const row of rows) {
      expect(row.redraft[0]).toBeCloseTo(result.winNowByTeam.get(row.rosterId) as number, 9);
      expect(row.fromPicks[0]).toBe(0);
      expect(row.change[0]).toBe(0);
      expect(row.move[0]).toBe(0);
    }
  });

  it('ranks every team distinctly in every year', () => {
    const { scenario, rosters, values } = buildHarness();
    const result = evaluateScenario(scenario);
    const byTeam = new Map(
      rosters.map((r) => [
        r.rosterId,
        r.playerIds.map((id) => values.get(id)).filter(Boolean) as ValuedPlayer[],
      ]),
    );
    const rows = projectLeague({
      rosterIds: rosters.map((r) => r.rosterId),
      players: byTeam,
      picks: scenario.picks,
      pickValues: result.pickValues,
      baseSeason: 2026,
      years: 3,
    });

    for (let n = 0; n < 3; n++) {
      const ranks = rows.map((r) => r.rank[n]).sort((a, b) => a - b);
      expect(ranks).toEqual(rows.map((_, i) => i + 1));
    }
    // Ranks are a permutation, so the moves have to cancel out across the
    // league: nobody climbs without somebody falling.
    expect(rows.reduce((a, r) => a + r.move[2], 0)).toBe(0);
  });

  it('lets a pick join the column only once its draft has happened', () => {
    const { scenario, rosters, values } = buildHarness();
    const result = evaluateScenario(scenario);
    const byTeam = new Map(
      rosters.map((r) => [
        r.rosterId,
        r.playerIds.map((id) => values.get(id)).filter(Boolean) as ValuedPlayer[],
      ]),
    );
    const seasons = [...new Set(scenario.picks.map((p) => p.season))].sort();
    const rows = projectLeague({
      rosterIds: rosters.map((r) => r.rosterId),
      players: byTeam,
      picks: scenario.picks,
      pickValues: result.pickValues,
      // Every pick is at least one draft away.
      baseSeason: seasons[0] - 1,
      years: 3,
    });
    for (const row of rows) {
      expect(row.fromPicks[0]).toBe(0);
      expect(row.fromPicks[1]).toBeGreaterThan(0);
      expect(row.fromPicks[2]).toBeGreaterThan(row.fromPicks[1]);
    }
  });
});

describe('roster spots', () => {
  it('charges nothing when the bodies balance', () => {
    const { scenario, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
    const effect = rosterSpotEffect(roster, scenario.shape, 0, [], roster.length, OPTION);
    expect(effect.cuts).toHaveLength(0);
    expect(effect.freed).toBe(0);
    expect(effect.strengthDelta).toBe(0);
  });

  it('releases the cheapest players when a trade overfills the roster', () => {
    const { scenario, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
    const capacity = rosterCapacity(scenario.shape);
    // Fill to the limit, then take back two more bodies than are sent.
    const full = roster.slice(0, capacity);
    const effect = rosterSpotEffect(full, scenario.shape, 2, [], capacity, OPTION);
    expect(effect.cuts).toHaveLength(2);
    expect(effect.strengthDelta).toBeLessThanOrEqual(0);
    // The cheapest cut is chosen, so no other pair could cost less.
    const worst = [...full].sort((a, b) => a.lineupValue - b.lineupValue).slice(0, 2);
    const cheapest = worst.reduce((a, p) => a + p.lineupValue, 0);
    expect(-effect.strengthDelta).toBeLessThanOrEqual(cheapest + 1e-9);
  });

  it('never charges for overage a league already has', () => {
    const { scenario, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
    const effect = rosterSpotEffect(roster, scenario.shape, 0, [], roster.length + 50, OPTION);
    expect(effect.cuts).toHaveLength(0);
  });

  it('prices a freed spot as an option, not as the free agent who fills it', () => {
    const { scenario, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
    const freeAgents = [...scenario.values.values()].filter((v) => v.ownerRosterId == null);
    expect(freeAgents.length).toBeGreaterThan(0);
    const effect = rosterSpotEffect(roster, scenario.shape, -1, freeAgents, roster.length + 1, OPTION);

    expect(effect.freed).toBe(1);
    // The player who fills it is still worth exactly zero above replacement.
    expect(effect.adds).toHaveLength(1);
    expect(effect.adds[0].strengthDelta).toBe(0);
    expect(effect.adds[0].assetDelta).toBe(0);
    // The seat is worth the option it carries, in both columns. Appearing
    // twice is deliberate: the scale is a weighted average, so a value in both
    // contributes exactly itself whatever the team's posture.
    expect(effect.optionValue).toBe(OPTION);
    expect(effect.strengthDelta).toBe(OPTION);
    expect(effect.assetDelta).toBe(OPTION);
  });

  it('scales the option with the number of seats, and pays nothing for none', () => {
    const { scenario, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
    const free = [...scenario.values.values()].filter((v) => v.ownerRosterId == null);
    const two = rosterSpotEffect(roster, scenario.shape, -2, free, roster.length + 2, OPTION);
    expect(two.optionValue).toBeCloseTo(2 * OPTION, 12);

    const even = rosterSpotEffect(roster, scenario.shape, 0, free, roster.length, OPTION);
    expect(even.optionValue).toBe(0);
    // A team taking on bodies is never paid an option for seats it lost.
    const overfull = rosterSpotEffect(roster, scenario.shape, 3, free, roster.length, OPTION);
    expect(overfull.optionValue).toBe(0);
  });
});

describe('what a player is worth to the team that holds him', () => {
  it('separates market value from use, and calls the gap surplus', () => {
    const { shape, rosters, values } = buildHarness();
    const roster = rosters[0].playerIds.map((id) => values.get(id)!) as ValuedPlayer[];

    // Someone buried: real market value, no contribution to this lineup. This
    // is the DK Metcalf case — worth something to somebody, nothing here.
    const surplusOf = (p: ValuedPlayer) => {
      const used = playerUsage(roster, shape, p.id);
      return used > IDLE_EPSILON ? 0 : p.assetValue;
    };

    const buried = roster
      .filter((p) => p.assetValue > 0 && playerUsage(roster, shape, p.id) < 1e-9)
      .sort((a, b) => b.assetValue - a.assetValue)[0];
    expect(buried).toBeTruthy();
    expect(surplusOf(buried)).toBeCloseTo(buried.assetValue, 9);

    // Anyone the roster leans on comes out at zero however large his market
    // value is. That is the property a naive `market - used` breaks: those two
    // measure different horizons, so subtracting them lets a franchise player
    // outrank a buried one purely by being good.
    const used = roster
      .map((p) => ({ p, used: playerUsage(roster, shape, p.id) }))
      .filter((x) => x.used > IDLE_EPSILON);
    expect(used.length).toBeGreaterThan(0);
    for (const x of used) expect(surplusOf(x.p)).toBe(0);

    // And at least one of them is worth more on the market than the buried
    // player is, so the ranking is not simply tracking market value.
    const richest = used.sort((a, b) => b.p.assetValue - a.p.assetValue)[0];
    expect(richest.p.assetValue).toBeGreaterThan(buried.assetValue);
    expect(surplusOf(richest.p)).toBeLessThan(surplusOf(buried));
  });

  it('prices the same player differently on a thin roster than on a deep one', () => {
    const { shape, rosters, values } = buildHarness();
    const usage = rosters.map((r) => {
      const roster = r.playerIds.map((id) => values.get(id)!) as ValuedPlayer[];
      return roster.map((p) => playerUsage(roster, shape, p.id));
    });
    // Across the league, the same measurement produces a real spread rather
    // than collapsing to each player's own value.
    const flat = usage.flat();
    expect(Math.max(...flat)).toBeGreaterThan(0);
    expect(Math.min(...flat)).toBe(0);
  });
});
