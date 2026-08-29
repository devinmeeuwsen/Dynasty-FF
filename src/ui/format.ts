import type { Position } from '../engine/types';

export const POSITION_COLOR: Record<Position, string> = {
  QB: 'var(--color-blend-400)',
  RB: 'var(--color-now-500)',
  WR: 'var(--color-later-400)',
  TE: '#f472b6',
};

export const POSITION_CLASS: Record<Position, string> = {
  QB: 'bg-blend-500/15 text-blend-400 ring-blend-500/30',
  RB: 'bg-now-500/15 text-now-400 ring-now-500/30',
  WR: 'bg-later-500/15 text-later-400 ring-later-500/30',
  TE: 'bg-pink-500/15 text-pink-300 ring-pink-500/30',
};

export function value(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function signed(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}`;
}

export function percent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPercentPoints(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n * 100).toFixed(digits)}pp`;
}

export function ordinal(n: number): string {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

export function relativeTime(date: Date | null): string {
  if (!date) return 'never';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The balanced band for long term value.
 *
 * Long term is a player's rating minus his redraft value, both read off the
 * same ladder, so zero means he stands equally high as an asset and as a
 * starter. Three points either side of that is the band where he is genuinely
 * both — about 40% of ranked players, which keeps all three readings useful.
 */
export const BALANCED_BAND = 3;

export type Timeline = 'future' | 'balanced' | 'now';

export function timelineOf(longTerm: number): Timeline {
  if (longTerm > BALANCED_BAND) return 'future';
  if (longTerm < -BALANCED_BAND) return 'now';
  return 'balanced';
}

export const TIMELINE_LABEL: Record<Timeline, string> = {
  future: 'Future asset',
  balanced: 'Balanced',
  now: 'Win now',
};

/** Colour a long term number by which side of the balanced band it falls. */
export function timelineClass(longTerm: number): string {
  switch (timelineOf(longTerm)) {
    case 'future':
      return 'text-later-400';
    case 'now':
      return 'text-now-400';
    default:
      return 'text-ink-300';
  }
}

/** Colour for a delta: green up, rose down, muted at zero. */
export function deltaClass(n: number, epsilon = 1e-9): string {
  if (n > epsilon) return 'text-good-500';
  if (n < -epsilon) return 'text-bad-500';
  return 'text-ink-400';
}

/**
 * Heat map ramp for the finish matrix. Perceptually monotone from the panel
 * ground to full violet, so the eye reads probability as intensity without a
 * legend.
 */
export function heatColor(probability: number, max: number): string {
  if (max <= 0) return 'transparent';
  const t = Math.min(1, Math.max(0, probability / max));
  const eased = Math.pow(t, 0.62);
  return `color-mix(in oklab, var(--color-blend-500) ${(eased * 88).toFixed(1)}%, transparent)`;
}

/** Diverging ramp for the trade delta matrix. */
export function divergingColor(delta: number, scale: number): string {
  if (scale <= 0) return 'transparent';
  const t = Math.min(1, Math.abs(delta) / scale);
  const eased = Math.pow(t, 0.6);
  const color = delta >= 0 ? 'var(--color-good-500)' : 'var(--color-bad-500)';
  return `color-mix(in oklab, ${color} ${(eased * 82).toFixed(1)}%, transparent)`;
}
