import { describe, expect, it } from 'vitest';
import { matchRankings, normalizeName } from './names';
import { parseRankingText, listFromText } from './rankings/parse';
import { bundledRankingSet, bundledPlayerPool } from './rankings/bundled';
import { assemblePlayers } from './assemble';
import { toLeagueShape } from './league';
import { toSlotKind } from './sleeper';
import type { SleeperLeagueSummary } from './sleeper';
import { runPipeline } from '../engine/values';
import { DEFAULT_SETTINGS, POSITIONS } from '../engine/types';

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
        expect(list!.entries.length).toBeGreaterThan(300);
        expect(list!.entries[0].rank).toBe(1);
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
    expect(firstQb('superflex')).toBeLessThan(8);
    expect(firstQb('standard')).toBeGreaterThan(10);
  });

  it('moves young players up and old players down between redraft and dynasty', () => {
    const redraft = set.lists.find(
      (l) => l.horizon === 'redraft' && l.scope === 'overall' && l.format === 'standard',
    )!;
    const dynasty = set.lists.find(
      (l) => l.horizon === 'dynasty' && l.scope === 'overall' && l.format === 'standard',
    )!;
    const dynastyRank = new Map(dynasty.entries.map((e) => [e.sleeperId, e.rank]));

    const shifts = redraft.entries
      .filter((e) => e.rank <= 150 && e.age != null && dynastyRank.has(e.sleeperId))
      .map((e) => ({ age: e.age as number, shift: e.rank - (dynastyRank.get(e.sleeperId) as number) }));

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
      expect(player.dynastyOverallRank).not.toBeNull();
      expect(player.redraftOverallRank).not.toBeNull();
      expect(player.dynastyPositionRank).not.toBeNull();
      expect(player.redraftPositionRank).not.toBeNull();
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
        .filter((p) => p.position === position)
        .map((p) => p.dynastyPositionRank as number)
        .sort((a, b) => a - b);
      expect(ranks[0]).toBe(1);
      expect(new Set(ranks).size).toBe(ranks.length);
      expect(ranks[ranks.length - 1]).toBe(ranks.length);
    }
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
