import { describe, expect, it } from 'vitest';
import { STARTER_MISS_RATE, backupSlots, benchDepth, teamStrength } from './depth';
import { optimizeLineup, type LineupPlayer } from './lineup';
import { STANDARD_STARTERS, SUPERFLEX_STARTERS } from './fixtures';
import { buildHarness } from './harness';
import { evaluateScenario } from './scenario';
import type { SlotKind } from './types';

const p = (id: string, position: LineupPlayer['position'], value: number): LineupPlayer => ({
  id,
  position,
  value,
});

/** QB / RB / RB / WR / WR / WR / TE / FLEX. */
const STANDARD = STANDARD_STARTERS;

describe('backup slots', () => {
  it('collapses duplicated starting slots to one backup each', () => {
    expect(backupSlots(STANDARD)).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX']);
  });

  it('keeps a superflex distinct from the flex it is wider than', () => {
    const slots = backupSlots(SUPERFLEX_STARTERS);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).toContain('SUPER_FLEX');
  });

  it('ignores bench, injured reserve and unsupported slots', () => {
    const starters: SlotKind[] = ['QB', 'BN', 'IR', 'TAXI', 'UNSUPPORTED', 'QB'];
    expect(backupSlots(starters)).toEqual(['QB']);
  });
});

describe('bench depth', () => {
  const roster: LineupPlayer[] = [
    p('qb1', 'QB', 20),
    p('qb2', 'QB', 8),
    p('qb3', 'QB', 7),
    p('rb1', 'RB', 18),
    p('rb2', 'RB', 16),
    p('rb3', 'RB', 12),
    p('rb4', 'RB', 11),
    p('rb5', 'RB', 5),
    p('wr1', 'WR', 17),
    p('wr2', 'WR', 15),
    p('wr3', 'WR', 14),
    p('wr4', 'WR', 9),
    p('te1', 'TE', 10),
    p('te2', 'TE', 6),
  ];

  it('counts at most one backup per slot class, and never one twice', () => {
    const depth = benchDepth(roster, STANDARD);
    expect(depth.entries.length).toBeLessThanOrEqual(backupSlots(STANDARD).length);
    expect(new Set(depth.entries.map((e) => e.slot)).size).toBe(depth.entries.length);
    expect(new Set(depth.entries.map((e) => e.playerId)).size).toBe(depth.entries.length);
  });

  it('never counts a starter twice', () => {
    const lineup = optimizeLineup(roster, STANDARD);
    const starters = new Set(lineup.starterIds);
    for (const entry of benchDepth(roster, STANDARD).entries) {
      expect(starters.has(entry.playerId)).toBe(false);
    }
  });

  it('is worth the miss rate times the best backup assignment', () => {
    const depth = benchDepth(roster, STANDARD);
    const sum = depth.entries.reduce((a, e) => a + e.value, 0);
    expect(depth.total).toBeCloseTo(STARTER_MISS_RATE * sum, 10);
  });

  it('gives the player behind the backup exactly nothing', () => {
    // qb2 covers the one quarterback slot. A quarterback cannot fill the flex
    // in this lineup, so qb3 backs up nothing and is worth exactly zero — the
    // user-visible form of the q^2 cutoff.
    const withoutThird = roster.filter((x) => x.id !== 'qb3');
    expect(teamStrength(roster, STANDARD).total).toBeCloseTo(
      teamStrength(withoutThird, STANDARD).total,
      10,
    );
    expect(benchDepth(roster, STANDARD).surplusIds).toContain('qb3');

    // The backups themselves are worth something. rb4 covers the running back
    // slots and rb5 covers the flex, which is exactly the shape the model
    // claims: one body per class, nothing behind it.
    for (const id of ['rb4', 'rb5']) {
      expect(teamStrength(roster, STANDARD).total).toBeGreaterThan(
        teamStrength(roster.filter((x) => x.id !== id), STANDARD).total,
      );
    }
    // And the sixth running back, behind both of them, is worth nothing.
    const deeper = [...roster, p('rb6', 'RB', 4)];
    expect(teamStrength(deeper, STANDARD).total).toBeCloseTo(
      teamStrength(roster, STANDARD).total,
      10,
    );
  });

  it('prices a backup below the same player as a starter, by the miss rate', () => {
    const thin = roster.filter((x) => !x.id.startsWith('qb'));
    const asStarter =
      teamStrength([...thin, p('x', 'QB', 20)], STANDARD).total -
      teamStrength(thin, STANDARD).total;
    const deep = [...thin, p('starter', 'QB', 25)];
    const asBackup =
      teamStrength([...deep, p('x', 'QB', 20)], STANDARD).total -
      teamStrength(deep, STANDARD).total;
    expect(asBackup).toBeCloseTo(STARTER_MISS_RATE * asStarter, 10);
  });

  it('leaves a replacement level free agent worth nothing on either line', () => {
    const wire = p('wire', 'WR', 0);
    expect(teamStrength([...roster, wire], STANDARD).total).toBeCloseTo(
      teamStrength(roster, STANDARD).total,
      10,
    );
  });
});

describe('depth in the season simulation', () => {
  it('separates two teams whose starting lineups are identical', () => {
    const { scenario } = buildHarness();
    const result = evaluateScenario(scenario);
    const withDepth = [...scenario.rosters].filter(
      (r) => (result.depthByTeam.get(r.rosterId)?.total ?? 0) > 0,
    );
    expect(withDepth.length).toBeGreaterThan(0);
    for (const roster of scenario.rosters) {
      const total = result.strengths.get(roster.rosterId) as number;
      const starting = result.startingStrength.get(roster.rosterId) as number;
      const depth = result.depthByTeam.get(roster.rosterId)?.total ?? 0;
      expect(total).toBeCloseTo(starting + depth, 9);
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  });

  it('moves championship odds when a team loses a backup rather than a starter', () => {
    const { scenario } = buildHarness();
    const base = evaluateScenario(scenario);

    // A player who is nobody's starter but somebody's first backup. Before
    // depth was modelled, losing him moved the matrix by exactly zero.
    const target = scenario.rosters[0];
    const starting = new Set(base.starters.get(target.rosterId) ?? []);
    const backup = base.depthByTeam.get(target.rosterId)?.entries.find(
      (e) => e.value > 0 && !starting.has(e.playerId),
    );
    expect(backup).toBeTruthy();

    const rosters = scenario.rosters.map((r) =>
      r.rosterId === target.rosterId
        ? { ...r, playerIds: r.playerIds.filter((id) => id !== backup!.playerId) }
        : r,
    );
    const after = evaluateScenario({ ...scenario, rosters });

    expect(after.strengths.get(target.rosterId) as number).toBeLessThan(
      base.strengths.get(target.rosterId) as number,
    );
    // The starting lineup is untouched, so the whole loss is depth.
    expect(after.startingStrength.get(target.rosterId) as number).toBeCloseTo(
      base.startingStrength.get(target.rosterId) as number,
      9,
    );
    expect(after.championship.get(target.rosterId) as number).toBeLessThan(
      base.championship.get(target.rosterId) as number,
    );
  });
});
