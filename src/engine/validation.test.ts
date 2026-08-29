/**
 * The twenty validation tests the build prompt requires, in order, each one
 * named after the property it protects.
 */
import { describe, expect, it } from 'vitest';
import {
  makeUniverse,
  makeShape,
  makeRosters,
  ownershipOf,
  STANDARD_STARTERS,
  SUPERFLEX_STARTERS,
} from './fixtures';
import { runPipeline } from './values';
import { DEFAULT_SETTINGS, POSITIONS, type Position, type SlotKind } from './types';
import { modeledSpotsPerTeam } from './replacement';
import { bruteForceLineup, optimizeLineup, marginalValue, type LineupPlayer } from './lineup';
import { mulberry32 } from './rng';
import { checkDoublyStochastic } from './season';
import { auditOwnership, buildPickOwnership, pickKey } from './picks';
import { evaluateScenario } from './scenario';
import { evaluateTrade, applyTrade } from './trade';
import { assessPosture, classify, recommendedWeight, standing } from './posture';
import { buildHarness, transferPlayers } from './harness';

const CURVE = { lambda: DEFAULT_SETTINGS.lambda, curve: DEFAULT_SETTINGS.curve } as const;

function value(shapeOpts: Parameters<typeof makeShape>[0], universeOpts = {}) {
  const players = makeUniverse(universeOpts);
  return runPipeline({ players, shape: makeShape(shapeOpts), settings: CURVE });
}

function bestAt(result: ReturnType<typeof runPipeline>, position: Position) {
  return result.players
    .filter((p) => p.position === position)
    .sort((a, b) => b.lineupValue - a.lineupValue)[0];
}

// ---------------------------------------------------------------------------

describe('1. one quarterback versus superflex', () => {
  it('produces dramatically different quarterback values when the ranking input matches the format', () => {
    const oneQb = value({ starters: STANDARD_STARTERS });
    const superflex = value({ starters: SUPERFLEX_STARTERS }, { superflexRankings: true });

    const qbOne = bestAt(oneQb, 'QB');
    const qbSf = bestAt(superflex, 'QB');

    expect(qbSf.lineupValue).toBeGreaterThan(qbOne.lineupValue * 1.5);

    const sfOrder = [...superflex.players].sort((a, b) => b.lineupValue - a.lineupValue);
    const qbRankSf = sfOrder.findIndex((p) => p.position === 'QB');
    expect(qbRankSf).toBeLessThan(5); // top handful overall

    const oneOrder = [...oneQb.players].sort((a, b) => b.lineupValue - a.lineupValue);
    const qbRankOne = oneOrder.findIndex((p) => p.position === 'QB');
    expect(qbRankOne).toBeGreaterThan(15);
  });

  it('records that replacement level alone cannot produce the superflex effect', () => {
    // Holding the ranking input fixed and only adding a superflex slot moves
    // quarterback value barely at all. This is a real property of the model and
    // the reason the application selects a format-matched ranking list. See
    // DECISIONS.md.
    const oneQb = value({ starters: STANDARD_STARTERS });
    const sameRanksSf = value({ starters: SUPERFLEX_STARTERS });
    const ratio = bestAt(sameRanksSf, 'QB').lineupValue / bestAt(oneQb, 'QB').lineupValue;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.2);
  });
});

describe('2. shrinking the bench', () => {
  it('raises replacement level at every position and concentrates value at the top', () => {
    const deep = value({ bench: 20 });
    const shallow = value({ bench: 4 });

    for (const pos of POSITIONS) {
      expect(shallow.winNow.replacement.levels[pos]).toBeGreaterThan(
        deep.winNow.replacement.levels[pos],
      );
    }

    const share = (r: ReturnType<typeof runPipeline>) => {
      const total = r.players.reduce((a, p) => a + p.lineupValue, 0);
      const top = [...r.players].sort((a, b) => b.lineupValue - a.lineupValue).slice(0, 24);
      return top.reduce((a, p) => a + p.lineupValue, 0) / total;
    };
    expect(share(shallow)).toBeGreaterThan(share(deep));
  });
});

describe('3. fewer teams', () => {
  it('raises replacement level at every position', () => {
    const sixteen = value({ teams: 16 });
    const eight = value({ teams: 8 });
    for (const pos of POSITIONS) {
      expect(eight.winNow.replacement.levels[pos]).toBeGreaterThan(
        sixteen.winNow.replacement.levels[pos],
      );
    }
  });
});

describe('4. the waiver wire is worth exactly zero', () => {
  it('gives the best unrostered player at every position a value above replacement of exactly zero', () => {
    const shape = makeShape();
    const players = makeUniverse();
    const rosters = makeRosters(players, shape, 15);
    const ownership = ownershipOf(rosters);
    const result = runPipeline({ players, shape, settings: CURVE, ownership });

    for (const pos of POSITIONS) {
      const freeAgents = result.players
        .filter((p) => p.position === pos && p.ownerRosterId === null)
        .sort((a, b) => b.redraft - a.redraft);
      expect(freeAgents[0].lineupValue).toBe(0);
      expect(freeAgents[0].assetValue).toBe(0);
      for (const fa of freeAgents) {
        expect(fa.lineupValue).toBe(0);
        expect(fa.assetValue).toBe(0);
      }
    }
  });

  it('holds in simulated mode too, where the replacement player is the best unabsorbed', () => {
    for (const shapeOpts of [{}, { teams: 8 }, { bench: 3 }, { starters: SUPERFLEX_STARTERS }]) {
      const result = value(shapeOpts);
      for (const pos of POSITIONS) {
        const replacementId = result.winNow.replacement.players[pos] as string;
        const player = result.players.find((p) => p.id === replacementId);
        expect(player?.lineupValue).toBe(0);
      }
    }
  });
});

describe('5. adding a flex spot', () => {
  it('raises value unequally across eligible positions, by exactly the curve drop each one absorbs', () => {
    const withoutFlex: SlotKind[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE'];
    const withFlex: SlotKind[] = [...withoutFlex, 'FLEX'];

    const before = value({ starters: withoutFlex });
    const after = value({ starters: withFlex });

    const gain: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const pos of POSITIONS) {
      gain[pos] =
        before.winNow.replacement.levels[pos] - after.winNow.replacement.levels[pos];
      expect(gain[pos]).toBeGreaterThanOrEqual(0);
    }

    // Tight end sits too low at the margin to attract any of the new slots, so
    // it gains nothing at all. That is the whole point: gains are not uniform.
    expect(gain.TE).toBe(0);
    expect(gain.WR).toBeGreaterThan(0);
    expect(gain.RB).toBeGreaterThan(0);
    expect(Math.abs(gain.WR - gain.RB)).toBeGreaterThan(0.05);

    const largest = POSITIONS.reduce((a, b) => (gain[a] >= gain[b] ? a : b));
    expect(['RB', 'WR', 'TE']).toContain(largest);

    // The mechanism: each position's gain equals the drop in its own curve over
    // exactly the players it newly absorbed — steepness at the margin times
    // slots won, nothing else.
    for (const pos of POSITIONS) {
      const curve = after.winNow.curves.byPosition[pos];
      const from = before.winNow.replacement.absorbed![pos];
      const to = after.winNow.replacement.absorbed![pos];
      const drop = (curve[from]?.value ?? 0) - (curve[to]?.value ?? 0);
      expect(gain[pos]).toBeCloseTo(drop, 9);
    }
  });
});

describe('6. absorption accounting', () => {
  it('absorbs exactly teams times spots per team, with no double counting across phases', () => {
    const cases = [
      { teams: 12, bench: 6, starters: STANDARD_STARTERS },
      { teams: 10, bench: 4, starters: SUPERFLEX_STARTERS },
      { teams: 16, bench: 9, starters: STANDARD_STARTERS },
      { teams: 8, bench: 20, starters: ['QB', 'RB', 'WR', 'FLEX', 'REC_FLEX'] as SlotKind[] },
      { teams: 12, bench: 5, starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'] as SlotKind[] },
    ];
    for (const c of cases) {
      const result = value(c);
      const shape = makeShape(c);
      const absorbed = result.winNow.replacement.absorbed!;
      const total = POSITIONS.reduce((a, p) => a + absorbed[p], 0);
      expect(total).toBe(shape.teams * modeledSpotsPerTeam(shape));
    }
  });
});

describe('7. rookies against ageing producers', () => {
  it('reads young players as future assets and ageing producers as win now', () => {
    const result = value({});
    const withAge = result.players.filter((p) => p.age != null && p.redraft > 1);

    const young = withAge.filter((p) => (p.age as number) <= 23);
    const old = withAge.filter((p) => (p.age as number) >= 30);
    expect(young.length).toBeGreaterThan(10);
    expect(old.length).toBeGreaterThan(10);

    const meanLongTerm = (list: typeof withAge) =>
      list.reduce((a, p) => a + p.longTerm, 0) / list.length;

    // Long term is rating minus redraft. A young player is worth more as an
    // asset than as this season's starter, so he reads positive; an ageing
    // producer is the reverse and reads negative.
    expect(meanLongTerm(young)).toBeGreaterThan(0);
    expect(meanLongTerm(old)).toBeLessThan(0);
    expect(meanLongTerm(young)).toBeGreaterThan(meanLongTerm(old));

    // Named examples, checked individually rather than only in aggregate.
    const rookie = [...young].sort((a, b) => b.longTerm - a.longTerm)[0];
    const veteran = [...old].sort((a, b) => a.longTerm - b.longTerm)[0];
    expect(rookie.rating).toBeGreaterThan(rookie.redraft);
    expect(veteran.redraft).toBeGreaterThan(veteran.rating);
  });
});

describe('8. a player who cannot crack the lineup', () => {
  it('has a marginal win now value of exactly zero for that roster', () => {
    const { shape, rosters, values } = buildHarness();
    const roster = rosters[0];
    const lineupPlayers: LineupPlayer[] = roster.playerIds
      .map((id) => values.get(id))
      .filter(Boolean)
      .map((v) => ({ id: v!.id, position: v!.position, value: v!.lineupValue }));

    const optimal = optimizeLineup(lineupPlayers, shape.starters);
    expect(optimal.benchIds.length).toBeGreaterThan(0);
    for (const benched of optimal.benchIds) {
      expect(marginalValue(lineupPlayers, shape.starters, benched)).toBe(0);
    }
  });
});

describe('9. the same player on two different rosters', () => {
  it('produces materially different marginal win now values', () => {
    const { shape, values } = buildHarness();
    const all = [...values.values()];
    const wrs = all.filter((p) => p.position === 'WR').sort((a, b) => b.lineupValue - a.lineupValue);
    const rbs = all.filter((p) => p.position === 'RB').sort((a, b) => b.lineupValue - a.lineupValue);
    const tes = all.filter((p) => p.position === 'TE').sort((a, b) => b.lineupValue - a.lineupValue);
    const qbs = all.filter((p) => p.position === 'QB').sort((a, b) => b.lineupValue - a.lineupValue);

    const toLineup = (p: (typeof all)[number]) => ({
      id: p.id,
      position: p.position,
      value: p.lineupValue,
    });

    // Stacked at receiver: the top six receivers in the league.
    const stacked = [qbs[0], ...rbs.slice(0, 2), ...wrs.slice(0, 6), tes[0]].map(toLineup);
    // Thin at receiver: the same shape but replacement-level receivers.
    const thin = [qbs[8], ...rbs.slice(6, 8), ...wrs.slice(60, 66), tes[8]].map(toLineup);

    const candidate = toLineup(wrs[10]);
    const gainStacked =
      optimizeLineup([...stacked, candidate], shape.starters).total -
      optimizeLineup(stacked, shape.starters).total;
    const gainThin =
      optimizeLineup([...thin, candidate], shape.starters).total -
      optimizeLineup(thin, shape.starters).total;

    expect(gainThin).toBeGreaterThan(gainStacked);
    expect(gainThin - gainStacked).toBeGreaterThan(5);
  });
});

describe('10. the finish matrix is doubly stochastic', () => {
  it('holds from raw simulation counts with no post-hoc normalisation', () => {
    const h = buildHarness({ settings: { simSeasons: 4000 } });
    const scenario = evaluateScenario(h.scenario);

    for (const matrix of [
      scenario.result.finish,
      scenario.result.draftSlots,
      scenario.result.regularSeason,
    ]) {
      const check = checkDoublyStochastic(matrix, 1e-9);
      expect(check.ok).toBe(true);
      for (const sum of check.rowSums) expect(sum).toBeCloseTo(1, 9);
      for (const sum of check.columnSums) expect(sum).toBeCloseTo(1, 9);
    }
  });
});

describe('11. the championship ceiling', () => {
  it('keeps the best roster within the range fantasy playoff variance allows', () => {
    // A realistically stratified league: the best roster projects about ten
    // points a week above league average, which is roughly what a strong
    // dynasty team looks like.
    const h = buildHarness({
      settings: { simSeasons: 6000 },
      draftMode: 'tiered',
      tierAlpha: 0.1,
    });
    const scenario = evaluateScenario(h.scenario);
    const first = scenario.result.finish.rows.map((r) => r[0]);
    const best = Math.max(...first);

    expect(best).toBeGreaterThan(0.15);
    expect(best).toBeLessThan(0.28);
    // Nobody is ever mathematically eliminated by roster strength alone.
    expect(Math.min(...first)).toBeGreaterThan(0);
  });

  it('holds the ceiling even for a deliberately stacked league', () => {
    const h = buildHarness({
      settings: { simSeasons: 6000 },
      draftMode: 'tiered',
      tierAlpha: 0.45,
    });
    const scenario = evaluateScenario(h.scenario);
    const first = scenario.result.finish.rows.map((r) => r[0]);
    // Even a roster projecting forty points a week clear of the field cannot
    // buy certainty. Sixty percent would mean the variance model is broken.
    expect(Math.max(...first)).toBeLessThan(0.55);
  });
});

describe('11a. double stochasticity survives a trade', () => {
  it('still holds after rosters are modified and the simulation re-run', () => {
    const h = buildHarness({ settings: { simSeasons: 3000 } });
    const wr = [...h.values.values()]
      .filter((p) => p.position === 'WR' && p.ownerRosterId === 2)
      .sort((a, b) => b.lineupValue - a.lineupValue)[0];
    const rb = [...h.values.values()]
      .filter((p) => p.position === 'RB' && p.ownerRosterId === 1)
      .sort((a, b) => b.lineupValue - a.lineupValue)[0];

    const result = evaluateTrade(h.scenario, {
      a: { rosterId: 1, players: [rb.id], picks: [] },
      b: { rosterId: 2, players: [wr.id], picks: [] },
    });

    const check = checkDoublyStochastic(result.after.result.finish, 1e-9);
    expect(check.ok).toBe(true);
    // The delta matrix must sum to zero in both directions: probability is
    // moved, never created.
    for (const row of result.matrixDelta.rows) {
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    }
    for (let j = 0; j < result.matrixDelta.rosterIds.length; j++) {
      const col = result.matrixDelta.rows.reduce((a, row) => a + row[j], 0);
      expect(col).toBeCloseTo(0, 9);
    }
  });
});

describe('12. the lineup optimizer', () => {
  it('matches brute force optimal assignment on randomised rosters', () => {
    const rng = mulberry32(4242);
    const configs: SlotKind[][] = [
      ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
      ['QB', 'RB', 'WR', 'WR', 'FLEX', 'SUPER_FLEX'],
      ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX'],
      ['RB', 'WR', 'REC_FLEX', 'WRRB_FLEX', 'SUPER_FLEX'],
      ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'],
    ];

    for (let trial = 0; trial < 300; trial++) {
      const starters = configs[trial % configs.length];
      const size = 6 + Math.floor(rng.next() * 6);
      const players: LineupPlayer[] = [];
      for (let i = 0; i < size; i++) {
        const pos = POSITIONS[Math.floor(rng.next() * POSITIONS.length)];
        players.push({ id: `x${i}`, position: pos, value: Math.round(rng.next() * 1000) / 10 });
      }
      const greedy = optimizeLineup(players, starters).total;
      const brute = bruteForceLineup(players, starters);
      expect(greedy).toBeCloseTo(brute, 9);
    }
  });
});

describe('13. pick ownership reconciles exactly', () => {
  it('gives every pick in every covered season exactly one owner', () => {
    const rosterIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const seasons = [2027, 2028];
    const rounds = 4;
    const traded = [
      { season: '2027', round: 1, roster_id: 3, previous_owner_id: 3, owner_id: 7 },
      { season: '2027', round: 2, roster_id: 7, previous_owner_id: 7, owner_id: 3 },
      { season: 2028, round: 1, roster_id: 12, previous_owner_id: 12, owner_id: 1 },
      // Records the engine must ignore rather than corrupt ownership with.
      { season: '2031', round: 1, roster_id: 4, previous_owner_id: 4, owner_id: 5 },
      { season: '2027', round: 9, roster_id: 4, previous_owner_id: 4, owner_id: 5 },
      { season: '2027', round: 1, roster_id: 99, previous_owner_id: 99, owner_id: 5 },
    ];

    const picks = buildPickOwnership(rosterIds, seasons, rounds, traded);
    const audit = auditOwnership(picks, rosterIds, seasons, rounds);

    expect(audit.ok).toBe(true);
    expect(audit.totalPicks).toBe(12 * 4 * 2);
    expect(audit.totalPicks).toBe(audit.expectedPicks);
    expect(audit.duplicated).toEqual([]);
    expect(audit.unowned).toEqual([]);

    const traded2027r1 = picks.find(
      (p) => p.season === 2027 && p.round === 1 && p.originalRosterId === 3,
    );
    expect(traded2027r1?.ownerRosterId).toBe(7);
    // The original owner is preserved: a pick belongs to whoever holds it, but
    // it LANDS where its original owner finishes.
    expect(traded2027r1?.originalRosterId).toBe(3);
  });
});

describe('14. the league is zero sum', () => {
  it('lowers picks originating with the improving team and raises at least one other', () => {
    const h = buildHarness({ settings: { simSeasons: 6000 } });
    const before = evaluateScenario(h.scenario);

    // Give roster 9 the two best available free agents at receiver and back.
    const freeAgents = [...h.values.values()]
      .filter((p) => p.ownerRosterId === null)
      .sort((a, b) => b.lineupValue - a.lineupValue);
    const boosted = [...h.values.values()]
      .filter((p) => p.ownerRosterId === 1)
      .sort((a, b) => b.lineupValue - a.lineupValue)
      .slice(0, 3)
      .map((p) => p.id);
    void freeAgents;

    const rosters = transferPlayers(h.rosters, 9, boosted);
    const after = evaluateScenario({ ...h.scenario, rosters });

    const improvedOwn = h.picks.filter((p) => p.originalRosterId === 9);
    for (const pick of improvedOwn) {
      expect(after.pickValues.get(pickKey(pick))!.value).toBeLessThan(
        before.pickValues.get(pickKey(pick))!.value,
      );
    }

    const others = h.picks.filter((p) => p.originalRosterId !== 9);
    const gained = others.filter(
      (p) =>
        after.pickValues.get(pickKey(p))!.value > before.pickValues.get(pickKey(p))!.value,
    );
    expect(gained.length).toBeGreaterThan(0);

    // Nothing in the league is left unchanged.
    for (const pick of h.picks) {
      const delta =
        after.pickValues.get(pickKey(pick))!.value -
        before.pickValues.get(pickKey(pick))!.value;
      expect(Math.abs(delta)).toBeGreaterThan(0);
    }
  });
});

describe('15. the improvement effect concentrates on adjacent teams', () => {
  it('moves the picks of teams near the improving team far more than distant ones', () => {
    const h = buildHarness({ settings: { simSeasons: 12000 } });
    const before = evaluateScenario(h.scenario);

    const order = [...h.rosters]
      .map((r) => ({
        rosterId: r.rosterId,
        finish: before.result.finish.rows[
          before.result.finish.rosterIds.indexOf(r.rosterId)
        ].reduce((a, p, j) => a + p * (j + 1), 0),
      }))
      .sort((a, b) => a.finish - b.finish);

    // Improve a team sitting near the bottom by handing it elite talent.
    const target = order[order.length - 3].rosterId;
    const donors = order.slice(0, 2).map((o) => o.rosterId);
    const talent = [...h.values.values()]
      .filter((p) => p.ownerRosterId != null && donors.includes(p.ownerRosterId))
      .sort((a, b) => b.lineupValue - a.lineupValue)
      .slice(0, 5)
      .map((p) => p.id);

    const rosters = transferPlayers(h.rosters, target, talent);
    const after = evaluateScenario({ ...h.scenario, rosters });

    const shiftFor = (rosterId: number) => {
      const picks = h.picks.filter(
        (p) => p.originalRosterId === rosterId && p.season === 2027 && p.round === 1,
      );
      return picks.reduce(
        (acc, p) =>
          acc +
          (after.pickValues.get(pickKey(p))!.value -
            before.pickValues.get(pickKey(p))!.value),
        0,
      );
    };

    const targetIndex = order.findIndex((o) => o.rosterId === target);
    const adjacent = order
      .filter((o, i) => o.rosterId !== target && Math.abs(i - targetIndex) <= 2 && !donors.includes(o.rosterId))
      .map((o) => Math.abs(shiftFor(o.rosterId)));
    const distant = order
      .filter((o, i) => o.rosterId !== target && Math.abs(i - targetIndex) >= 6 && !donors.includes(o.rosterId))
      .map((o) => Math.abs(shiftFor(o.rosterId)));

    expect(adjacent.length).toBeGreaterThan(0);
    expect(distant.length).toBeGreaterThan(0);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(adjacent)).toBeGreaterThan(mean(distant) * 1.5);
  });
});

describe('16. draft capital is conserved across the league', () => {
  it('redistributes rather than creates value through any trade', () => {
    const h = buildHarness({ settings: { simSeasons: 6000 } });
    const rb = [...h.values.values()]
      .filter((p) => p.ownerRosterId === 4 && p.position === 'RB')
      .sort((a, b) => b.lineupValue - a.lineupValue)[0];
    const ownPick = h.picks.find(
      (p) => p.ownerRosterId === 7 && p.originalRosterId === 7 && p.round === 1 && p.season === 2027,
    )!;

    const result = evaluateTrade(h.scenario, {
      a: { rosterId: 4, players: [rb.id], picks: [] },
      b: { rosterId: 7, players: [], picks: [pickKey(ownPick)] },
    });

    const relativeDrift =
      Math.abs(result.leagueCapitalDrift) / result.leagueCapitalBefore;
    expect(relativeDrift).toBeLessThan(0.02);
  });
});

describe('17. identical rosters, different pick holdings', () => {
  it('receive materially different verdicts on the identical trade', () => {
    const traded = [
      // Roster 11 swaps its own 2027 first for the 2027 first of roster 6,
      // a team just above it in the projected order.
      { season: 2027, round: 1, roster_id: 11, previous_owner_id: 11, owner_id: 6 },
      { season: 2027, round: 1, roster_id: 6, previous_owner_id: 6, owner_id: 11 },
    ];
    const plain = buildHarness({ settings: { simSeasons: 8000 } });
    const swapped = buildHarness({ settings: { simSeasons: 8000 }, traded });

    // Same rosters, same trade, same everything except who owns which first.
    const talent = [...plain.values.values()]
      .filter((p) => p.ownerRosterId === 1)
      .sort((a, b) => b.lineupValue - a.lineupValue)
      .slice(0, 3);

    const proposal = {
      a: { rosterId: 11, players: [] as string[], picks: [] as string[] },
      b: { rosterId: 1, players: talent.map((p) => p.id), picks: [] as string[] },
    };

    const plainResult = evaluateTrade(plain.scenario, proposal);
    const swappedResult = evaluateTrade(swapped.scenario, proposal);

    const plainCapital = plainResult.sides[0].draftCapitalDelta;
    const swappedCapital = swappedResult.sides[0].draftCapitalDelta;

    // Holding its own first, roster 11 loses capital by climbing. Holding the
    // first of a team it now passes, it loses far less or gains.
    expect(swappedCapital).toBeGreaterThan(plainCapital);
    expect(Math.abs(swappedCapital - plainCapital)).toBeGreaterThan(0.05);
  });
});

describe('18. the dead zone, corrected for coupling', () => {
  it('fires when the team holds its own picks and not when it holds the picks it passes', () => {
    const settings = { simSeasons: 8000, deadZoneThreshold: 0.02 };
    const harnessOpts = { settings, draftMode: 'tiered' as const, tierAlpha: 0.35 };

    const ownPicks = buildHarness(harnessOpts);
    const baseline = evaluateScenario(ownPicks.scenario);
    const finishOf = (rosterId: number) =>
      baseline.result.finish.rows[
        baseline.result.finish.rosterIds.indexOf(rosterId)
      ].reduce((a, p, j) => a + p * (j + 1), 0);

    const ranked = ownPicks.rosters
      .map((r) => ({ rosterId: r.rosterId, finish: finishOf(r.rosterId) }))
      .sort((a, b) => a.finish - b.finish);

    // The classic dead zone move: a team projected around tenth buys enough to
    // project around sixth, and pays for it with its own first round picks.
    const climber = ranked[9].rosterId;
    const passed = ranked.slice(5, 9).map((r) => r.rosterId);
    const seller = ranked[3].rosterId;

    const talent = [...ownPicks.values.values()]
      .filter((p) => p.ownerRosterId === seller)
      .sort((a, b) => b.lineupValue - a.lineupValue)
      .slice(0, 2)
      .map((p) => p.id);

    const climberPicks = ownPicks.picks
      .filter((p) => p.originalRosterId === climber && p.ownerRosterId === climber)
      .map(pickKey);

    const ownResult = evaluateTrade(
      ownPicks.scenario,
      {
        a: { rosterId: climber, players: [], picks: climberPicks.slice(0, 2) },
        b: { rosterId: seller, players: talent, picks: [] },
      },
      baseline,
    );
    const ownSide = ownResult.sides.find((s) => s.rosterId === climber)!;
    const ownVerdict = ownResult.deadZone.find((d) => d.rosterId === climber)!;

    // It really is the dead zone shape: a big move up the standings that buys
    // essentially nothing in the first place column.
    expect(ownSide.expectedFinishBefore - ownSide.expectedFinishAfter).toBeGreaterThan(2);
    expect(Math.abs(ownSide.payoutDelta)).toBeLessThan(0.02);
    expect(ownSide.draftCapitalDelta).toBeLessThan(0);
    expect(ownVerdict.kind).toBe('dead_zone');
    expect(ownVerdict.triggered).toBe(true);

    // Now the same team, the same trade, but holding the firsts of the very
    // teams it is about to pass instead of its own.
    const traded = passed.map((rosterId) => ({
      season: 2027,
      round: 1,
      roster_id: rosterId,
      previous_owner_id: rosterId,
      owner_id: climber,
    }));
    const coupled = buildHarness({ ...harnessOpts, traded });
    const coupledOwnPicks = coupled.picks
      .filter((p) => p.originalRosterId === climber && p.ownerRosterId === climber)
      .map(pickKey);
    const coupledResult = evaluateTrade(coupled.scenario, {
      a: { rosterId: climber, players: [], picks: coupledOwnPicks.slice(0, 2) },
      b: { rosterId: seller, players: talent, picks: [] },
    });
    const coupledSide = coupledResult.sides.find((s) => s.rosterId === climber)!;
    const coupledVerdict = coupledResult.deadZone.find((d) => d.rosterId === climber)!;

    // The picks it holds from the teams it passes gain, and that gain is real.
    const offsetting = coupledSide.pickBreakdown.filter(
      (p) => p.heldAfter && passed.includes(p.originalRosterId) && p.delta > 0,
    );
    expect(offsetting.length).toBeGreaterThan(0);
    expect(coupledSide.draftCapitalDelta).toBeGreaterThan(ownSide.draftCapitalDelta);
    expect(coupledVerdict.offsettingPicks.length).toBeGreaterThan(0);
  });
});

describe('19. synced against simulated replacement level', () => {
  it('produces similar but not identical levels, and reports the difference', () => {
    const shape = makeShape();
    const players = makeUniverse();
    const rosters = makeRosters(players, shape, 15);
    const ownership = ownershipOf(rosters);
    const result = runPipeline({ players, shape, settings: CURVE, ownership });

    expect(result.mode).toBe('observed');
    const comparison = result.winNow.comparison!;
    expect(comparison).toHaveLength(4);

    for (const row of comparison) {
      expect(row.observed).not.toBe(row.simulated);
      // Similar: within a couple of points on a 0-100 scale.
      expect(Math.abs(row.delta)).toBeLessThan(3);
      expect(row.delta).toBe(row.observed - row.simulated);
    }
    // The divergence is surfaced, not hidden: at least one position differs
    // enough to be worth telling the user about.
    expect(Math.max(...comparison.map((r) => Math.abs(r.delta)))).toBeGreaterThan(0.1);
  });
});

describe('20. simulation stability', () => {
  it('reproduces exactly on identical inputs and stays tight across seeds', () => {
    const h = buildHarness({ settings: { simSeasons: 8000 } });
    const a = evaluateScenario(h.scenario);
    const b = evaluateScenario(h.scenario);

    for (const pick of h.picks) {
      expect(a.pickValues.get(pickKey(pick))!.value).toBe(
        b.pickValues.get(pickKey(pick))!.value,
      );
    }

    // Across different seeds, pick values must not visibly jitter.
    const seeds = [11, 2222, 333333].map((seed) =>
      evaluateScenario({ ...h.scenario, settings: { ...h.settings, seed } }),
    );
    const firstRoundPicks = h.picks.filter((p) => p.round === 1 && p.season === 2027);
    let worst = 0;
    let scale = 0;
    for (const pick of firstRoundPicks) {
      const values = seeds.map((s) => s.pickValues.get(pickKey(pick))!.value);
      worst = Math.max(worst, Math.max(...values) - Math.min(...values));
      scale = Math.max(scale, Math.max(...values));
    }
    expect(worst / scale).toBeLessThan(0.03);
  });
});

describe('applyTrade', () => {
  it('moves players and picks without losing or duplicating either', () => {
    const h = buildHarness({ settings: { simSeasons: 500 } });
    const p1 = h.rosters[0].playerIds[0];
    const p2 = h.rosters[1].playerIds[0];
    const pick = h.picks.find((p) => p.ownerRosterId === 2 && p.round === 1)!;

    const applied = applyTrade(h.rosters, h.picks, {
      a: { rosterId: 1, players: [p1], picks: [] },
      b: { rosterId: 2, players: [p2], picks: [pickKey(pick)] },
    });

    const total = applied.rosters.reduce((a, r) => a + r.playerIds.length, 0);
    expect(total).toBe(h.rosters.reduce((a, r) => a + r.playerIds.length, 0));
    expect(applied.rosters[0].playerIds).toContain(p2);
    expect(applied.rosters[0].playerIds).not.toContain(p1);
    expect(applied.rosters[1].playerIds).toContain(p1);
    expect(applied.picks.find((p) => pickKey(p) === pickKey(pick))!.ownerRosterId).toBe(1);
    expect(applied.picks).toHaveLength(h.picks.length);
  });
});

describe('contention posture is derived, not asked', () => {
  const h = buildHarness({ seasons: [2027, 2028], rounds: 4, playoffTeams: 6 });
  const scenario = evaluateScenario(h.scenario);

  it('places every team on both axes and produces a usable weight', () => {
    for (const roster of h.rosters) {
      const p = assessPosture(scenario, roster.rosterId);
      expect(p.contention).toBeGreaterThanOrEqual(0);
      expect(p.contention).toBeLessThanOrEqual(1);
      expect(p.futureStrength).toBeGreaterThanOrEqual(0);
      expect(p.futureStrength).toBeLessThanOrEqual(1);
      expect(p.weight).toBeGreaterThanOrEqual(0);
      expect(p.weight).toBeLessThanOrEqual(1);
    }
    // The strongest and weakest teams must not land on the same posture.
    const ranked = [...h.rosters]
      .map((r) => assessPosture(scenario, r.rosterId))
      .sort((a, b) => b.contention - a.contention);
    expect(ranked[0].weight).toBeGreaterThan(ranked[ranked.length - 1].weight);
  });

  it('separates a dynasty from an all in team at identical championship odds', () => {
    // Same contention, opposite futures: the only difference is whether the
    // roster survives the season it is winning.
    expect(classify(0.9, 0.9)).toBe('dynasty');
    expect(classify(0.9, 0.1)).toBe('all_in');
    expect(recommendedWeight(0.9, 0.9)).toBeLessThan(recommendedWeight(0.9, 0.1));
    // Dynasty still leans win now — it is a contender, just not a mortgaging one.
    expect(recommendedWeight(0.9, 0.9)).toBeGreaterThan(0.6);
    expect(recommendedWeight(0.9, 0.1)).toBeGreaterThan(0.9);
  });

  it('sends a hopeless team to a rebuild and grades it on what it still owns', () => {
    expect(classify(0.05, 0.8)).toBe('rebuilding');
    expect(classify(0.05, 0.1)).toBe('full_rebuild');
    expect(recommendedWeight(0.05, 0.8)).toBeLessThan(0.2);
    expect(classify(0.5, 0.5)).toBe('contending');
    expect(classify(0.35, 0.5)).toBe('balanced');
  });

  it('is monotone: more contention never means less win now', () => {
    for (const future of [0, 0.25, 0.5, 0.75, 1]) {
      let previous = -1;
      for (const contention of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const w = recommendedWeight(contention, future);
        expect(w).toBeGreaterThanOrEqual(previous);
        previous = w;
      }
    }
    // And a stronger future never means more win now.
    for (const contention of [0, 0.5, 1]) {
      expect(recommendedWeight(contention, 1)).toBeLessThanOrEqual(
        recommendedWeight(contention, 0),
      );
    }
  });

  it('puts a league of identical teams in the middle rather than picking one', () => {
    const flat = new Map([1, 2, 3, 4].map((id) => [id, 0.25]));
    for (const id of [1, 2, 3, 4]) expect(standing(flat, id)).toBeCloseTo(0.5, 9);
  });
});

describe('the regular season and the playoffs are different questions', () => {
  const rowEntropy = (row: number[]) =>
    -row.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0);

  it('never makes the final standings sharper than the seeding that fed them', () => {
    // The bracket adds independent noise on top of the schedule, so the final
    // matrix can only be at least as spread out. If it ever came out sharper,
    // the bracket would be leaking information back into the regular season.
    for (const draftMode of ['linear', 'tiered'] as const) {
      const h = buildHarness({ draftMode, tierAlpha: 0.35, playoffTeams: 6, weeks: 14 });
      const s = evaluateScenario(h.scenario);
      const mean = (m: number[][]) =>
        m.reduce((a, row) => a + rowEntropy(row), 0) / m.length;
      expect(mean(s.result.finish.rows)).toBeGreaterThanOrEqual(
        mean(s.result.regularSeason.rows) - 1e-9,
      );
    }
  });

  it('shows a strong team reaching the bracket far more reliably than winning it', () => {
    const h = buildHarness({ draftMode: 'tiered', tierAlpha: 0.35, playoffTeams: 6, weeks: 14 });
    const s = evaluateScenario(h.scenario);
    const best = [...s.result.meanPoints.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const i = s.result.regularSeason.rosterIds.indexOf(best);

    const makePlayoffs = s.result.regularSeason.rows[i].slice(0, 6).reduce((a, b) => a + b, 0);
    const title = s.result.finish.rows[i][0];

    expect(makePlayoffs).toBeGreaterThan(0.9);
    expect(title).toBeLessThan(makePlayoffs);
    // The gap is the point of splitting the two charts: dominating a schedule
    // is achievable, converting it into a trophy is mostly not.
    expect(makePlayoffs - title).toBeGreaterThan(0.2);
  });

  it('lets two week playoff rounds favour the better team, as they do in reality', () => {
    const odds = (playoffWeeksPerRound: number) => {
      const h = buildHarness({ draftMode: 'tiered', tierAlpha: 0.35, playoffTeams: 6, weeks: 14 });
      const s = evaluateScenario({
        ...h.scenario,
        season: { ...h.scenario.season, playoffWeeksPerRound },
      });
      return Math.max(...s.championship.values());
    };
    // Doubling the round doubles the mean gap but only sqrt(2)s the spread,
    // so the favourite converts more often.
    expect(odds(2)).toBeGreaterThan(odds(1));
  });

  it('keeps both matrices doubly stochastic, not just the one on screen', () => {
    const h = buildHarness({ draftMode: 'tiered', tierAlpha: 0.35, playoffTeams: 6 });
    const s = evaluateScenario({
      ...h.scenario,
      season: { ...h.scenario.season, playoffWeeksPerRound: 2 },
    });
    for (const m of [s.result.regularSeason, s.result.finish, s.result.draftSlots]) {
      const check = checkDoublyStochastic(m, 1e-9);
      expect(check.ok, `row ${check.maxRowError} col ${check.maxColumnError}`).toBe(true);
    }
  });
});
