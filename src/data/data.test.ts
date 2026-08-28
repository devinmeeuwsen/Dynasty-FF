import { describe, expect, it } from 'vitest';
import { matchRankings, normalizeName } from './names';
import { parseRankingText, listFromText } from './rankings/parse';
import { bundledRankingSet, bundledPlayerPool } from './rankings/bundled';
import { assemblePlayers } from './assemble';
import { rankingFormatFor, tePremiumFor, toRankingFormat } from './rankings/types';
import { toLeagueShape } from './league';
import { toSlotKind } from './sleeper';
import type { SleeperLeagueSummary } from './sleeper';
import { blendedRating, blendedVar, runPipeline } from '../engine/values';
import { DEFAULT_SETTINGS, POSITIONS } from '../engine/types';
import type { SlotKind } from '../engine/types';

const TAB = String.fromCharCode(9);

describe('name normalisation', () => {
  it('strips punctuation, case, accents and generational suffixes', () => {
    expect(normalizeName('Ja’Marr Chase')).toBe('jamarrchase');
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarrchase');
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amonrastbrown');
    expect(normalizeName('Michael Pittman Jr.')).toBe('michaelpittman');
    expect(normalizeName('Marvin Harrison Jr')).toBe('marvinharrison');
    expect(normalizeName('Kenneth Walker III')).toBe('kennethwalker');
    expect(normalizeName('  D.K.  Metcalf ')).toBe('dkmetcalf');
  });

  it('keeps different players apart', () => {
    expect(normalizeName('Michael Carter')).not.toBe(normalizeName('Michael Pittman'));
  });
});

describe('ranking matching', () => {
  const pool = [
    { id: '1', name: 'Ja’Marr Chase', position: 'WR' as const, team: 'CIN' },
    { id: '2', name: 'Michael Pittman Jr.', position: 'WR' as const, team: 'IND' },
    { id: '3', name: 'Michael Carter', position: 'RB' as const, team: 'ARI' },
    { id: '4', name: 'Michael Carter', position: 'WR' as const, team: 'NYJ' },
    { id: '5', name: 'Joshua Palmer', position: 'WR' as const, team: 'BUF' },
  ];

  it('matches across punctuation and suffix differences', () => {
    const result = matchRankings(
      [
        { name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
        { name: 'Michael Pittman', position: 'WR', team: 'IND' },
      ],
      pool,
    );
    expect(result.matched.get(normalizeName("Ja'Marr Chase"))).toBe('1');
    expect(result.matched.get(normalizeName('Michael Pittman'))).toBe('2');
    expect(result.unmatched).toEqual([]);
  });

  it('never matches across positions', () => {
    const result = matchRankings(
      [{ name: 'Michael Carter', position: 'RB', team: null }],
      pool,
    );
    expect(result.matched.get('michaelcarter')).toBe('3');
  });

  it('disambiguates duplicate names by NFL team', () => {
    const result = matchRankings(
      [{ name: 'Michael Carter', position: 'WR', team: 'NYJ' }],
      pool,
    );
    expect(result.matched.get('michaelcarter')).toBe('4');
  });

  it('surfaces unmatched names rather than dropping them', () => {
    const result = matchRankings(
      [{ name: 'Nobody At All', position: 'TE', team: 'SEA' }],
      pool,
    );
    expect(result.matched.size).toBe(0);
    expect(result.unmatched).toEqual([
      { name: 'Nobody At All', position: 'TE', team: 'SEA' },
    ]);
  });

  it('honours a persisted manual override', () => {
    const overrides = new Map([[normalizeName('Mystery Guy'), '5']]);
    const result = matchRankings(
      [{ name: 'Mystery Guy', position: 'WR', team: null }],
      pool,
      overrides,
    );
    expect(result.matched.get('mysteryguy')).toBe('5');
  });

  it('falls back to last name plus first initial for nicknames', () => {
    const result = matchRankings(
      [{ name: 'Josh Palmer', position: 'WR', team: 'BUF' }],
      pool,
    );
    expect(result.matched.get('joshpalmer')).toBe('5');
  });
});

describe('ranking import', () => {
  it('parses a FantasyPros style CSV export', () => {
    const csv = [
      '"RK","TIERS","PLAYER NAME","TEAM","POS","BYE WEEK"',
      '1,1,"Ja\'Marr Chase","CIN","WR1",10',
      '2,1,"Bijan Robinson","ATL","RB1",5',
      '3,1,"Josh Allen","BUF","QB1",7',
    ].join('\n');
    const result = parseRankingText(csv);
    expect(result.detected).toBe('csv');
    expect(result.entries.map((e) => e.name)).toEqual([
      "Ja'Marr Chase",
      'Bijan Robinson',
      'Josh Allen',
    ]);
    expect(result.entries.map((e) => e.position)).toEqual(['WR', 'RB', 'QB']);
    expect(result.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(result.entries[0].team).toBe('CIN');
  });

  it('parses a spreadsheet paste', () => {
    const tsv = [
      ['1', 'Bijan Robinson', 'RB', 'ATL'].join(TAB),
      ['2', 'Puka Nacua', 'WR', 'LAR'].join(TAB),
    ].join('\n');
    const result = parseRankingText(tsv);
    expect(result.detected).toBe('tsv');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1].name).toBe('Puka Nacua');
  });

  it('parses a hand typed numbered list', () => {
    const text = ['1. Bijan Robinson RB', '2. Puka Nacua WR', 'Tier 2', '3. Josh Allen QB'].join(
      '\n',
    );
    const result = parseRankingText(text);
    expect(result.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(result.entries.map((e) => e.position)).toEqual(['RB', 'WR', 'QB']);
  });

  it('reports lines it could not understand instead of guessing', () => {
    const result = parseRankingText(['1. Bijan Robinson RB', 'some stray note'].join('\n'));
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual(['some stray note']);
  });

  it('re-ranks a positional list densely', () => {
    const { list } = listFromText(
      ['1. Josh Allen QB', '2. Bijan Robinson RB', '3. Lamar Jackson QB'].join('\n'),
      'redraft',
      'QB',
      'superflex',
    );
    expect(list.entries.map((e) => [e.name, e.rank])).toEqual([
      ['Josh Allen', 1],
      ['Lamar Jackson', 2],
    ]);
  });
});

describe('bundled snapshot', () => {
  const set = bundledRankingSet();

  it('ships dynasty and redraft lists in both formats', () => {
    for (const horizon of ['dynasty', 'redraft'] as const) {
      for (const format of ['standard', 'superflex'] as const) {
        const list = set.lists.find(
          (l) => l.horizon === horizon && l.scope === 'overall' && l.format === format,
        );
        expect(list, `${horizon}/${format}`).toBeTruthy();
        // KeepTradeCut's dynasty board runs deeper than its redraft board.
        // Both must still cover a deep league's rostered players plus a
        // meaningful waiver wire beneath them.
        expect(list!.entries.length).toBeGreaterThanOrEqual(horizon === 'dynasty' ? 400 : 250);
        expect(list!.entries[0].rank).toBe(1);
        // Every entry carries a 0-100 market value, not just an ordering.
        for (const entry of list!.entries) {
          expect(entry.rating).toBeGreaterThan(0);
          expect(entry.rating).toBeLessThanOrEqual(100);
        }
        // Foreign identifiers must never masquerade as Sleeper ids: 25 of
        // KeepTradeCut's mflids are also valid Sleeper ids for other players.
        expect(list!.entries.every((e) => e.sleeperId === undefined)).toBe(true);
      }
    }
  });

  it('ranks quarterbacks far higher in the superflex list than the standard one', () => {
    const firstQb = (format: 'standard' | 'superflex') => {
      const list = set.lists.find(
        (l) => l.horizon === 'redraft' && l.scope === 'overall' && l.format === format,
      )!;
      return list.entries.findIndex((e) => e.position === 'QB') + 1;
    };
    const qbsInTop24 = (format: 'standard' | 'superflex') => {
      const list = set.lists.find(
        (l) => l.horizon === 'redraft' && l.scope === 'overall' && l.format === format,
      )!;
      return list.entries.slice(0, 24).filter((e) => e.position === 'QB').length;
    };
    // Assert the relationship rather than an absolute rank. How aggressively a
    // one-quarterback market discounts the position is the market's opinion,
    // not this codebase's, and it moves week to week.
    expect(firstQb('superflex')).toBeLessThan(firstQb('standard'));
    expect(qbsInTop24('superflex')).toBeGreaterThan(qbsInTop24('standard'));
  });

  it('moves young players up and old players down between redraft and dynasty', () => {
    const redraft = set.lists.find(
      (l) => l.horizon === 'redraft' && l.scope === 'overall' && l.format === 'standard',
    )!;
    const dynasty = set.lists.find(
      (l) => l.horizon === 'dynasty' && l.scope === 'overall' && l.format === 'standard',
    )!;
    // Joined on name: these lists carry no Sleeper ids, by design.
    const dynastyRank = new Map(dynasty.entries.map((e) => [e.name, e.rank]));

    const shifts = redraft.entries
      .filter((e) => e.rank <= 150 && e.age != null && dynastyRank.has(e.name))
      .map((e) => ({ age: e.age as number, shift: e.rank - (dynastyRank.get(e.name) as number) }));

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const young = mean(shifts.filter((s) => s.age <= 23).map((s) => s.shift));
    const old = mean(shifts.filter((s) => s.age >= 29).map((s) => s.shift));

    expect(young).toBeGreaterThan(0); // climbs in dynasty
    expect(old).toBeLessThan(0); // falls in dynasty
  });
});

describe('assembling engine players from a ranking set', () => {
  const set = bundledRankingSet();
  const pool = bundledPlayerPool();

  it('populates all four rank fields and feeds the value pipeline', () => {
    const result = assemblePlayers({ set, format: 'standard', pool });

    expect(result.unmatched).toEqual([]);
    expect(result.players.length).toBeGreaterThan(400);
    for (const player of result.players) {
      // The two boards are different depths, so a player can be priced on one
      // horizon and not the other. What must never happen is a player carried
      // with no ranking at all, or an overall rank with no positional rank.
      expect(player.dynastyOverallRank != null || player.redraftOverallRank != null).toBe(true);
      expect(player.dynastyPositionRank == null).toBe(player.dynastyOverallRank == null);
      expect(player.redraftPositionRank == null).toBe(player.redraftOverallRank == null);
      // A rank from a value-publishing board must carry its value with it.
      expect(player.dynastyRating == null).toBe(player.dynastyOverallRank == null);
      expect(player.redraftRating == null).toBe(player.redraftOverallRank == null);
    }

    const shape = {
      teams: 12,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'] as const,
      benchSlots: 6,
      irSlots: 2,
      taxiSlots: 0,
      superflex: false,
      tightEndPremium: 0,
    };
    const valued = runPipeline({
      players: result.players,
      shape: { ...shape, starters: [...shape.starters] },
      settings: { lambda: DEFAULT_SETTINGS.lambda, curve: DEFAULT_SETTINGS.curve },
    });
    for (const position of POSITIONS) {
      const best = valued.players
        .filter((p) => p.position === position)
        .sort((a, b) => b.winNow - a.winNow)[0];
      expect(best.winNow).toBeGreaterThan(0);
    }
  });

  it('gives every position a dense 1..n positional ranking', () => {
    const result = assemblePlayers({ set, format: 'superflex', pool });
    for (const position of POSITIONS) {
      const ranks = result.players
        .filter((p) => p.position === position && p.dynastyPositionRank != null)
        .map((p) => p.dynastyPositionRank as number)
        .sort((a, b) => a - b);
      expect(ranks[0]).toBe(1);
      expect(new Set(ranks).size).toBe(ranks.length);
      expect(ranks[ranks.length - 1]).toBe(ranks.length);
    }
  });
});

describe('ratings and value over replacement are separate columns', () => {
  const set = bundledRankingSet();
  const pool = bundledPlayerPool();
  const shape = {
    teams: 12,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'] as const,
    benchSlots: 6,
    irSlots: 2,
    taxiSlots: 0,
    superflex: true,
    tightEndPremium: 0,
  };

  const build = () => {
    const { players } = assemblePlayers({ set, format: 'superflex', pool });
    // Roster the top 180 by dynasty board order, leaving a real waiver wire.
    const rostered = [...players]
      .filter((p) => p.dynastyOverallRank != null)
      .sort((a, b) => (a.dynastyOverallRank as number) - (b.dynastyOverallRank as number))
      .slice(0, shape.teams * 15);
    const ownership = new Map(rostered.map((p, i) => [p.id, (i % shape.teams) + 1]));
    return runPipeline({
      players,
      shape: { ...shape, starters: [...shape.starters] },
      settings: { lambda: DEFAULT_SETTINGS.lambda, curve: DEFAULT_SETTINGS.curve },
      ownership,
    });
  };

  it('reads market values straight through instead of re-deriving them from rank', () => {
    const { players } = assemblePlayers({ set, format: 'superflex', pool });
    const result = runPipeline({
      players,
      shape: { ...shape, starters: [...shape.starters] },
      settings: { lambda: DEFAULT_SETTINGS.lambda, curve: DEFAULT_SETTINGS.curve },
    });
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const valued of result.players) {
      const source = byId.get(valued.id)!;
      if (source.dynastyRating != null) {
        expect(valued.longTermRating).toBeCloseTo(source.dynastyRating, 6);
      }
      if (source.redraftRating != null) {
        expect(valued.winNowRating).toBeCloseTo(source.redraftRating, 6);
      }
    }
  });

  it('gives waiver wire players a real rating rather than flattening them to zero', () => {
    const result = build();
    const free = result.players.filter((p) => p.ownerRosterId == null);
    expect(free.length).toBeGreaterThan(50);

    // The whole point: a free agent has standalone worth on the same 0-100
    // scale as everyone else.
    const rated = free.filter((p) => p.longTermRating > 0);
    expect(rated.length).toBe(free.length);
    expect(Math.max(...free.map((p) => p.longTermRating))).toBeGreaterThan(1);

    for (const player of result.players) {
      expect(player.longTermRating).toBeGreaterThan(0);
      expect(player.longTermRating).toBeLessThanOrEqual(100);
      expect(player.winNowRating).toBeLessThanOrEqual(100);
    }
  });

  it('measures value over replacement as a signed second column', () => {
    const result = build();

    // The player who sets replacement level is exactly zero, by construction.
    const replacementId = result.longTerm.replacement.players.WR;
    const replacement = result.players.find((p) => p.id === replacementId)!;
    expect(replacement.longTermVar).toBeCloseTo(0, 6);

    // Below him the column goes negative: worse than freely available.
    const negatives = result.players.filter((p) => p.longTermVar < 0);
    expect(negatives.length).toBeGreaterThan(0);
    for (const player of negatives) {
      expect(player.longTermRating).toBeGreaterThan(0); // still rated
      expect(player.longTerm).toBe(0); // engine value stays clamped
    }

    // Starters clear replacement comfortably.
    const best = [...result.players].sort((a, b) => b.longTermRating - a.longTermRating)[0];
    expect(best.longTermVar).toBeGreaterThan(0);
    expect(best.longTerm).toBeCloseTo(best.longTermVar, 6);
  });

  it('keeps the two columns consistent under the contention blend', () => {
    const result = build();
    for (const weight of [0, 0.5, 1]) {
      for (const player of result.players.slice(0, 40)) {
        const rating = blendedRating(player, weight);
        const vor = blendedVar(player, weight);
        expect(rating).toBeCloseTo(
          weight * player.winNowRating + (1 - weight) * player.longTermRating,
          6,
        );
        // The gap between the columns is the blended replacement level, so it
        // is the same for every player at a position regardless of weight.
        expect(rating - vor).toBeGreaterThan(0);
      }
    }
  });
});

describe('league format decides which board a player is priced on', () => {
  const set = bundledRankingSet();
  const pool = bundledPlayerPool();

  const price = (superflex: boolean, tightEndPremium: number) => {
    const shape = {
      teams: 12,
      starters: (superflex
        ? ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']
        : ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX']) as SlotKind[],
      benchSlots: 6,
      irSlots: 2,
      taxiSlots: 0,
      superflex,
      tightEndPremium,
    };
    const format = rankingFormatFor({ superflex, tightEndPremium });
    const { players } = assemblePlayers({ set, format, pool });
    const result = runPipeline({
      players,
      shape,
      settings: { lambda: DEFAULT_SETTINGS.lambda, curve: DEFAULT_SETTINGS.curve },
    });
    return { format, byName: new Map(result.players.map((p) => [p.name, p])), result };
  };

  it('maps Sleeper bonus_rec_te onto the board the market actually trades', () => {
    expect(tePremiumFor(0)).toBe('base');
    expect(tePremiumFor(0.5)).toBe('tep');
    expect(tePremiumFor(1)).toBe('tepp');
    expect(tePremiumFor(1.5)).toBe('teppp');
    expect(rankingFormatFor({ superflex: true, tightEndPremium: 1 })).toBe('superflex.tepp');
    expect(rankingFormatFor({ superflex: false, tightEndPremium: 0 })).toBe('standard');
    expect(toRankingFormat('superflex', 'base')).toBe('superflex');
  });

  it('ships a distinct board for every quarterback and tight end combination', () => {
    for (const horizon of ['dynasty', 'redraft'] as const) {
      for (const qb of ['standard', 'superflex'] as const) {
        for (const te of ['base', 'tep', 'tepp', 'teppp'] as const) {
          const format = toRankingFormat(qb, te);
          const list = set.lists.find(
            (l) => l.horizon === horizon && l.scope === 'overall' && l.format === format,
          );
          expect(list, `${horizon}/${format}`).toBeTruthy();
          expect(list!.entries.length).toBeGreaterThan(250);
          // Rank must follow the merged ordering, not the base board's.
          const ratings = list!.entries.map((e) => e.rating as number);
          for (let i = 1; i < ratings.length; i++) {
            expect(ratings[i]).toBeLessThanOrEqual(ratings[i - 1]);
          }
        }
      }
    }
  });

  it('raises quarterbacks in superflex and leaves other positions alone', () => {
    const one = price(false, 0);
    const sf = price(true, 0);
    const qb = 'Josh Allen';
    if (one.byName.has(qb) && sf.byName.has(qb)) {
      expect(sf.byName.get(qb)!.longTermRating).toBeGreaterThan(
        one.byName.get(qb)!.longTermRating * 1.15,
      );
    }
    // More quarterbacks get rostered, so the quarterback wire gets thinner.
    expect(sf.result.longTerm.replacement.levels.QB).toBeLessThan(
      one.result.longTerm.replacement.levels.QB,
    );
  });

  it('raises tight ends with the premium and moves nothing else', () => {
    const base = price(false, 0);
    const mid = price(false, 0.5);
    const high = price(false, 1);
    expect(base.format).toBe('standard');
    expect(high.format).toBe('standard.tepp');

    let tightEndsChecked = 0;
    let othersChecked = 0;
    for (const [name, p] of base.byName) {
      const lifted = high.byName.get(name);
      if (!lifted) continue;
      if (p.position === 'TE') {
        if (p.longTermRating > 5) {
          expect(lifted.longTermRating).toBeGreaterThan(p.longTermRating);
          tightEndsChecked += 1;
        }
      } else {
        expect(lifted.longTermRating).toBeCloseTo(p.longTermRating, 6);
        othersChecked += 1;
      }
    }
    expect(tightEndsChecked).toBeGreaterThan(10);
    expect(othersChecked).toBeGreaterThan(200);

    // The premium is monotone: more points per reception is never worth less.
    for (const [name, p] of base.byName) {
      if (p.position !== 'TE' || p.longTermRating <= 5) continue;
      const m = mid.byName.get(name);
      const h = high.byName.get(name);
      if (!m || !h) continue;
      expect(m.longTermRating).toBeGreaterThanOrEqual(p.longTermRating);
      expect(h.longTermRating).toBeGreaterThanOrEqual(m.longTermRating - 1e-9);
    }

    // A premium makes tight ends scarcer, so replacement level rises.
    expect(high.result.longTerm.replacement.levels.TE).toBeGreaterThan(
      base.result.longTerm.replacement.levels.TE,
    );
  });
});

describe('Sleeper league translation', () => {
  const league = {
    league_id: 'x',
    name: 'Test',
    season: '2026',
    sport: 'nfl',
    total_rosters: 12,
    status: 'in_season',
    avatar: null,
    previous_league_id: null,
    roster_positions: [
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
      'BN', 'BN', 'BN', 'BN', 'BN', 'IR', 'IR', 'TAXI',
    ],
    settings: { playoff_teams: 6, playoff_week_start: 15, taxi_slots: 3 },
    scoring_settings: { bonus_rec_te: 0.5 },
  } satisfies SleeperLeagueSummary;

  it('reads the shape straight off roster_positions', () => {
    const { shape, unsupported } = toLeagueShape(league);
    expect(shape.teams).toBe(12);
    expect(shape.benchSlots).toBe(5);
    expect(shape.irSlots).toBe(2);
    expect(shape.taxiSlots).toBe(1);
    expect(shape.superflex).toBe(true);
    expect(shape.tightEndPremium).toBe(0.5);
    expect(unsupported).toEqual(['K', 'DEF']);
    expect(shape.starters).toContain('SUPER_FLEX');
  });

  it('marks positions the value model does not cover rather than mapping them', () => {
    expect(toSlotKind('K')).toBe('UNSUPPORTED');
    expect(toSlotKind('DEF')).toBe('UNSUPPORTED');
    expect(toSlotKind('DL')).toBe('UNSUPPORTED');
    expect(toSlotKind('WRRB_FLEX')).toBe('WRRB_FLEX');
    expect(toSlotKind('SUPER_FLEX')).toBe('SUPER_FLEX');
  });
});
