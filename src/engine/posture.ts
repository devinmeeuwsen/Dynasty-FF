import type { Scenario } from './scenario';

/**
 * Where a team actually sits, derived rather than declared.
 *
 * Asking a user to set their own contention timeline asks them to answer the
 * question the product exists to answer. The simulation already knows this
 * team's championship probability, and the value pipeline already knows
 * whether its assets are the kind that expire. Those two numbers place the
 * team without anyone guessing.
 *
 * The two axes are deliberately separate, because collapsing them loses the
 * distinction the whole thing turns on: a team that is winning now because it
 * is good, and a team that is winning now because it spent its future to be
 * good, are the same point on one axis and opposite situations to manage.
 */
export type Posture =
  | 'full_rebuild'
  | 'rebuilding'
  | 'balanced'
  | 'contending'
  | 'dynasty'
  | 'all_in';

export interface PostureResult {
  posture: Posture;
  /** Recommended contention weight: 1 is pure win now, 0 is pure long term. */
  weight: number;
  /** Championship probability, as published by the simulation. */
  championshipOdds: number;
  /** 0-1 standing within the league on championship odds. */
  contention: number;
  /** 0-1 standing within the league on long term assets plus draft capital. */
  futureStrength: number;
  label: string;
  blurb: string;
}

/**
 * Rank-based standing rather than a share of the total.
 *
 * Championship odds are heavily skewed — one dominant roster can hold a third
 * of them — and a share-based measure would read every other team as hopeless.
 * What matters is where a team sits relative to the ones it competes with, so
 * position in the ordering is the honest summary. Ties share a rank, which
 * keeps a league of identical rosters at 0.5 instead of handing an arbitrary
 * team the top spot.
 */
export function standing(values: Map<number, number>, rosterId: number): number {
  const mine = values.get(rosterId);
  if (mine == null || values.size < 2) return 0.5;
  let below = 0;
  let equal = 0;
  for (const [, v] of values) {
    if (v < mine - 1e-12) below += 1;
    else if (Math.abs(v - mine) <= 1e-12) equal += 1;
  }
  // Midpoint of the tied block, so ties land together rather than by map order.
  return (below + (equal - 1) / 2) / (values.size - 1);
}

/**
 * Long term assets and draft capital, added because they answer the same
 * question. A roster of 23 year olds and a stack of firsts are both ways of
 * having a future; a team that has traded its picks for veterans has neither,
 * however good it looks this season.
 */
function futureByTeam(scenario: Scenario): Map<number, number> {
  const out = new Map<number, number>();
  for (const [rosterId, longTerm] of scenario.longTermByTeam) {
    out.set(rosterId, longTerm + (scenario.capitalByTeam.get(rosterId) ?? 0));
  }
  return out;
}

const COPY: Record<Posture, { label: string; blurb: string }> = {
  full_rebuild: {
    label: 'Full rebuild',
    blurb:
      'Low championship odds and little to protect. Win now production is inventory to sell, not a goal.',
  },
  rebuilding: {
    label: 'Rebuilding',
    blurb:
      'Not close this year, but the asset base is real. Keep converting expiring production into it.',
  },
  balanced: {
    label: 'Balanced',
    blurb:
      'Neither committed nor eliminated. Both horizons priced evenly until the season picks a side.',
  },
  contending: {
    label: 'Contending',
    blurb: 'Live for a title. Draft capital is currency now rather than inventory.',
  },
  dynasty: {
    label: 'Dynasty',
    blurb:
      'Winning now on a roster that does not expire. Buy this season, but not by selling the window that follows it.',
  },
  all_in: {
    label: 'All in',
    blurb:
      'Real odds on a roster that will not hold them. The window is this season, so spend the future to win it.',
  },
};

/**
 * Thresholds are stated here rather than scattered so they can be argued with.
 * `dynasty` needs genuine contention AND an above-average future; without the
 * second test it would just be a second name for contending.
 */
const CONTENDER = 0.7;
const YOUNG = 0.55;
const LIVE = 0.48;
const ADRIFT = 0.28;
const HAS_ASSETS = 0.45;

export function classify(contention: number, futureStrength: number): Posture {
  if (contention >= CONTENDER) {
    return futureStrength >= YOUNG ? 'dynasty' : 'all_in';
  }
  if (contention >= LIVE) return 'contending';
  if (contention >= ADRIFT) return 'balanced';
  return futureStrength >= HAS_ASSETS ? 'rebuilding' : 'full_rebuild';
}

/**
 * Contention pulls the weight toward this season; a strong future pulls it
 * back. The future term is what separates a dynasty from an all in team:
 * identical championship odds, but the team that will still be here next year
 * has no reason to pay the premium that selling its window would cost.
 */
export function recommendedWeight(contention: number, futureStrength: number): number {
  const raw = 0.14 + 0.9 * contention - 0.25 * futureStrength;
  return Math.min(1, Math.max(0, Math.round(raw * 100) / 100));
}

export function assessPosture(scenario: Scenario, rosterId: number): PostureResult {
  const contention = standing(scenario.championship, rosterId);
  const futureStrength = standing(futureByTeam(scenario), rosterId);
  const posture = classify(contention, futureStrength);
  return {
    posture,
    weight: recommendedWeight(contention, futureStrength),
    championshipOdds: scenario.championship.get(rosterId) ?? 0,
    contention,
    futureStrength,
    ...COPY[posture],
  };
}

export const POSTURE_COPY = COPY;
