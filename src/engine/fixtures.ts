/**
 * Deterministic synthetic ranking universes for the engine tests.
 *
 * The shape mimics a real board: the top of the overall list is almost all
 * running backs and wide receivers, quarterbacks start around overall 25 in a
 * one-quarterback list, and tight ends are sparse and steep.
 */
import type { EnginePlayer, LeagueShape, Position, SlotKind, TeamRoster } from './types';
import { mulberry32 } from './rng';

const QB_OVERALL_1QB = [
  25, 33, 40, 47, 55, 62, 70, 78, 86, 95, 104, 113, 122, 131, 141, 151, 161, 172, 183,
  194, 206, 218, 230, 243, 256, 270, 284, 298, 312, 327, 342, 358, 374, 390,
];
const QB_OVERALL_SF = [
  3, 6, 9, 12, 15, 19, 23, 27, 31, 36, 41, 46, 52, 58, 64, 71, 78, 86, 94, 103, 112,
  122, 133, 145, 158, 172, 187, 203, 220, 238, 257, 277, 298, 320,
];
const TE_OVERALL = [
  18, 30, 44, 58, 72, 88, 100, 112, 124, 137, 149, 162, 175, 188, 200, 213, 226, 240,
  254, 268, 282, 296, 310, 325, 340, 355, 370, 385,
];

export interface UniverseOptions {
  size?: number;
  /** Use the superflex flavoured overall list, where quarterbacks rank far higher. */
  superflexRankings?: boolean;
  seed?: number;
}

/**
 * Production curves by age. Peak is 1.0. These drive the difference between the
 * dynasty ordering and the redraft ordering in the fixture, which is what makes
 * the rookie / ageing player test meaningful.
 */
const AGE_CURVES: Record<Position, [number, number][]> = {
  QB: [[21, 0.72], [25, 0.94], [28, 1.0], [33, 1.0], [35, 0.86], [38, 0.6], [42, 0.25]],
  RB: [[21, 0.86], [24, 1.0], [26, 0.95], [28, 0.8], [30, 0.55], [32, 0.3], [35, 0.1]],
  WR: [[21, 0.7], [24, 0.95], [26, 1.0], [28, 0.95], [30, 0.8], [32, 0.55], [35, 0.25]],
  TE: [[22, 0.55], [25, 0.85], [27, 1.0], [29, 0.95], [31, 0.8], [33, 0.6], [36, 0.3]],
};

export function productionAtAge(position: Position, age: number): number {
  const anchors = AGE_CURVES[position];
  if (age <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (age >= last[0]) return Math.max(0, last[1]);
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (age <= x1) return y0 + ((age - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/**
 * The dynasty horizon multiplier: the discounted sum of remaining production
 * relative to a player already at his peak. A 22 year old carries many
 * discounted peak seasons; a 30 year old carries two and then a cliff.
 */
export function horizonMultiplier(
  position: Position,
  age: number,
  years = 10,
  discount = 0.88,
): number {
  let sum = 0;
  let norm = 0;
  for (let t = 0; t < years; t++) {
    sum += productionAtAge(position, age + t) * Math.pow(discount, t);
    norm += Math.pow(discount, t);
  }
  return sum / norm;
}

export function makeUniverse(options: UniverseOptions = {}): EnginePlayer[] {
  const size = options.size ?? 400;
  const rng = mulberry32(options.seed ?? 12345);
  const qbRanks = options.superflexRankings ? QB_OVERALL_SF : QB_OVERALL_1QB;

  const positionAt = new Array<Position | null>(size + 1).fill(null);
  for (const r of qbRanks) if (r <= size) positionAt[r] = 'QB';
  for (const r of TE_OVERALL) if (r <= size && positionAt[r] == null) positionAt[r] = 'TE';

  let flip = 0;
  for (let r = 1; r <= size; r++) {
    if (positionAt[r] != null) continue;
    // Slightly more receivers than backs, alternating so neither position
    // clumps at the top of the board.
    positionAt[r] = flip % 5 === 0 || flip % 5 === 2 ? 'RB' : 'WR';
    flip++;
  }

  const players: EnginePlayer[] = [];
  const positionCounts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };

  for (let rank = 1; rank <= size; rank++) {
    const position = positionAt[rank] as Position;
    positionCounts[position] += 1;
    // Deterministic ages spread across a realistic band, with genuine rookies
    // seeded throughout the board rather than only at the bottom.
    const roll = rng.next();
    const age = Math.round(21 + roll * 12);
    players.push({
      id: `p${rank}`,
      name: `${position} Player ${rank}`,
      position,
      team: `T${(rank % 32) + 1}`,
      age,
      redraftOverallRank: rank,
      redraftPositionRank: positionCounts[position],
      dynastyOverallRank: null,
      dynastyPositionRank: null,
    });
  }

  // Dynasty ordering: re-rank the same players by a multi-season horizon.
  const scored = players.map((p) => ({
    player: p,
    score:
      Math.exp(-0.021 * ((p.redraftOverallRank as number) - 1)) *
      (horizonMultiplier(p.position, p.age as number) /
        Math.max(0.2, productionAtAge(p.position, p.age as number))),
  }));
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.player.redraftOverallRank as number) - (b.player.redraftOverallRank as number),
  );
  const dynastyCounts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  scored.forEach((entry, i) => {
    entry.player.dynastyOverallRank = i + 1;
    dynastyCounts[entry.player.position] += 1;
    entry.player.dynastyPositionRank = dynastyCounts[entry.player.position];
  });

  return players;
}

export interface ShapeOptions {
  teams?: number;
  starters?: SlotKind[];
  bench?: number;
  superflex?: boolean;
}

export const STANDARD_STARTERS: SlotKind[] = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX',
];
export const SUPERFLEX_STARTERS: SlotKind[] = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX',
];

export function makeShape(options: ShapeOptions = {}): LeagueShape {
  const starters = options.starters ?? STANDARD_STARTERS;
  return {
    teams: options.teams ?? 12,
    starters,
    benchSlots: options.bench ?? 6,
    irSlots: 0,
    taxiSlots: 0,
    superflex: options.superflex ?? starters.includes('SUPER_FLEX'),
    tightEndPremium: 0,
  };
}

/**
 * Distribute the board onto rosters.
 *
 * A snake draft produces a league where every roster is almost identical,
 * which is a bad test bed: the finish matrix is correctly near uniform and
 * nothing interesting happens. Real dynasty leagues are lopsided a few years
 * in, so `linear` is the default — each team takes the same slot every round,
 * which spreads lineup strength the way an actual league is spread.
 */
export type DraftMode = 'linear' | 'snake' | 'tiered';

export function makeRosters(
  players: EnginePlayer[],
  shape: LeagueShape,
  spotsPerTeam = 15,
  mode: DraftMode = 'linear',
  tierAlpha = 0.3,
): TeamRoster[] {
  const rosters: TeamRoster[] = [];
  for (let i = 0; i < shape.teams; i++) {
    rosters.push({
      rosterId: i + 1,
      ownerId: `owner${i + 1}`,
      teamName: `Team ${String.fromCharCode(65 + i)}`,
      playerIds: [],
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
    });
  }

  const board = [...players].sort(
    (a, b) => (a.redraftOverallRank ?? 1e9) - (b.redraftOverallRank ?? 1e9),
  );

  if (mode === 'tiered') {
    // A blend between a linear draft, which produces near identical rosters,
    // and a block allocation, which produces an absurd super team. Real
    // dynasty leagues sit in between, and the ceiling and dead zone tests need
    // that: without genuine stratification there is no such thing as a team
    // "projected tenth".
    const order: { team: number; key: number }[] = [];
    for (let i = 0; i < rosters.length; i++) {
      for (let k = 0; k < spotsPerTeam; k++) {
        const blockIndex = i * spotsPerTeam + k;
        const linearIndex = k * rosters.length + i;
        order.push({
          team: i,
          key: tierAlpha * blockIndex + (1 - tierAlpha) * linearIndex,
        });
      }
    }
    order.sort((a, b) => a.key - b.key || a.team - b.team);
    order.forEach((entry, boardIndex) => {
      const player = board[boardIndex];
      if (player) rosters[entry.team].playerIds.push(player.id);
    });
    return rosters;
  }

  let index = 0;
  for (let round = 0; round < spotsPerTeam; round++) {
    const order =
      mode === 'snake' && round % 2 === 1 ? [...rosters].reverse() : rosters;
    for (const roster of order) {
      const player = board[index++];
      if (!player) break;
      roster.playerIds.push(player.id);
    }
  }
  return rosters;
}

export function ownershipOf(rosters: TeamRoster[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const roster of rosters) {
    for (const id of roster.playerIds) map.set(id, roster.rosterId);
  }
  return map;
}
