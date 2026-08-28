import type { CurveKind } from './types';

/**
 * Step 1: convert a rank into a raw value.
 *
 *   rawValue(rank) = 100 * exp(-lambda * (rank - 1))
 *
 * The default lambda of 0.021 puts the 100th ranked player at roughly 12.3% of
 * the top ranked player. The curve is a swappable function so a power law or a
 * logistic can replace it without touching anything downstream.
 */
export type RankToValue = (rank: number) => number;

export interface CurveParams {
  lambda: number;
  kind: CurveKind;
}

export function exponentialCurve(lambda: number): RankToValue {
  return (rank: number) => 100 * Math.exp(-lambda * (Math.max(1, rank) - 1));
}

/**
 * Power law alternative: value = 100 * rank^(-alpha). Alpha is derived from
 * lambda so the two curves agree at rank 100, which keeps the advanced setting
 * meaningful when a user switches curve family.
 */
export function powerCurve(lambda: number): RankToValue {
  const alpha = (lambda * 99) / Math.log(100);
  return (rank: number) => 100 * Math.pow(Math.max(1, rank), -alpha);
}

/**
 * Logistic alternative: a flat shoulder at the top of the board that then falls
 * away. Midpoint is placed where the exponential curve reaches half value.
 */
export function logisticCurve(lambda: number): RankToValue {
  const midpoint = Math.log(2) / lambda + 1;
  const steepness = lambda * 1.6;
  const atOne = 1 / (1 + Math.exp(steepness * (1 - midpoint)));
  return (rank: number) => {
    const v = 1 / (1 + Math.exp(steepness * (Math.max(1, rank) - midpoint)));
    return (100 * v) / atOne;
  };
}

export function makeCurve({ lambda, kind }: CurveParams): RankToValue {
  switch (kind) {
    case 'power':
      return powerCurve(lambda);
    case 'logistic':
      return logisticCurve(lambda);
    case 'exponential':
    default:
      return exponentialCurve(lambda);
  }
}

/** Inverse of the default curve: what rank does a given raw value correspond to. */
export function valueToRank(value: number, lambda: number): number {
  if (value <= 0) return Infinity;
  return 1 - Math.log(value / 100) / lambda;
}
