/**
 * What a rookie pick is worth, from the market rather than from a curve.
 *
 * KeepTradeCut prices picks in three tiers per round per year — early, mid,
 * late — which is how they are actually traded. Those tiers are defined on a
 * TWELVE TEAM board: an early first is a 1-4 finish, mid is 5-8, late is 9-12.
 * That framing is the whole point, because it makes the tiers a statement
 * about absolute draft position rather than about position within a round.
 *
 * So the anchors are laid out along the overall pick number and interpolated
 * as one continuous curve across every round. A league with fewer teams then
 * reads that same curve at its own overall positions: in a ten team league the
 * 2.01 is overall pick 11, which on a twelve team board is the back of the
 * first round — and that is exactly what it is worth. Scaling the tiers to the
 * league's own round size instead would price that pick as an early second and
 * badly undersell it.
 *
 * Picks are long term assets only. There is no win now number here and there
 * should not be: a future rookie plays no games this season.
 */

export interface PickTiers {
  early: number;
  mid: number;
  late: number;
}

export interface PickBoard {
  /** year -> round -> the three published tier values, on the 0-100 scale. */
  years: Record<string, Record<string, PickTiers>>;
  /** Measured year-over-year decay, used only to extend past the last year. */
  yearDecay: number;
}

/** The board size KeepTradeCut's early/mid/late tiers are defined against. */
export const KTC_TEAMS = 12;

/**
 * Where each tier sits on the twelve team board, as an overall pick number.
 *
 * Early covers picks 1-4 of the round, mid 5-8, late 9-12, so each anchor
 * belongs at the centre of its block: 2.5, 6.5 and 10.5 within the round. A
 * 1.01 therefore sits ahead of the early anchor rather than on it, which is
 * why the top of a round prices above the published early value.
 */
export function tierAnchors(round: number): [number, number, number] {
  const base = (round - 1) * KTC_TEAMS;
  return [base + 2.5, base + 6.5, base + 10.5];
}

/** Overall pick number for a slot in a league of this size. */
export function overallPick(round: number, slotInRound: number, teams: number): number {
  return (round - 1) * Math.max(1, teams) + slotInRound;
}

interface Curve {
  xs: number[];
  ys: number[];
}

/**
 * One continuous curve over overall pick number, in log space.
 *
 * Log space because pick values decay geometrically — the gap between 1.01 and
 * 1.04 dwarfs the gap between 1.09 and 1.12 — so straight lines between
 * anchors would badly underprice the top of the board.
 */
function buildCurve(rounds: Record<string, PickTiers>): Curve | null {
  const points: [number, number][] = [];
  for (const [round, tiers] of Object.entries(rounds)) {
    const r = Number(round);
    if (!Number.isFinite(r)) continue;
    const [e, m, l] = tierAnchors(r);
    points.push([e, tiers.early], [m, tiers.mid], [l, tiers.late]);
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a[0] - b[0]);
  return {
    xs: points.map((p) => p[0]),
    ys: points.map((p) => Math.log(Math.max(1e-6, p[1]))),
  };
}

/** Piecewise linear in log space, continuing the end slopes past the anchors. */
function evaluate(curve: Curve, x: number): number {
  const { xs, ys } = curve;
  const last = xs.length - 1;

  let i = 0;
  if (x <= xs[0]) i = 0;
  else if (x >= xs[last]) i = last - 1;
  else {
    while (i < last - 1 && x > xs[i + 1]) i += 1;
  }

  const run = xs[i + 1] - xs[i];
  const slope = run === 0 ? 0 : (ys[i + 1] - ys[i]) / run;
  return Math.exp(ys[i] + slope * (x - xs[i]));
}

function scaleTiers(tiers: PickTiers, factor: number): PickTiers {
  return { early: tiers.early * factor, mid: tiers.mid * factor, late: tiers.late * factor };
}

/**
 * The published rounds for a season, resolved by DISTANCE from the next draft.
 *
 * Never by matching the calendar year directly: KeepTradeCut keeps listing a
 * draft that has already happened, at collapsed values, and a league whose
 * rookie draft is done has no such picks left to trade. Anchoring on the first
 * published year still in the future is what keeps a 2027 pick priced as one.
 */
export function roundsFor(
  board: PickBoard,
  nextDraftSeason: number,
  season: number,
): Record<string, PickTiers> | null {
  const years = Object.keys(board.years)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) return null;

  const anchorYear = years.find((y) => y >= nextDraftSeason) ?? years[years.length - 1];
  const target = anchorYear + (season - nextDraftSeason);
  const maxYear = years[years.length - 1];
  const sourceYear = Math.min(Math.max(target, years[0]), maxYear);

  const rounds = board.years[String(sourceYear)];
  if (!rounds) return null;
  if (target <= maxYear) return rounds;

  // Past the end of the published board, fade the whole year by the measured
  // decay rather than inventing a shape for it.
  const factor = Math.pow(board.yearDecay, target - maxYear);
  return Object.fromEntries(
    Object.entries(rounds).map(([r, tiers]) => [r, scaleTiers(tiers, factor)]),
  );
}

/**
 * Market value of one pick, given the slot it lands in.
 *
 * `slotInRound` is 1..teams for the league in question. It is converted to an
 * overall pick number before the curve is read, which is what lets a ten team
 * league's second rounder be priced as the late first it actually resembles.
 */
export function pickSlotRating(
  board: PickBoard,
  nextDraftSeason: number,
  season: number,
  round: number,
  slotInRound: number,
  teams: number,
): number {
  const rounds = roundsFor(board, nextDraftSeason, season);
  if (!rounds) return 0;
  const curve = buildCurve(rounds);
  if (!curve) return 0;
  return Math.max(0, evaluate(curve, overallPick(round, slotInRound, teams)));
}
