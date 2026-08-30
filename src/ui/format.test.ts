import { describe, expect, it } from 'vitest';
import { blendedRating } from '../engine/values';
import { deltaClass, ordinal, percent, signed, signedPercentPoints, value } from './format';

/** The interface is tested lightly: just the formatting the tables depend on. */
describe('formatting', () => {
  it('formats values, percentages and signs', () => {
    expect(value(12.345)).toBe('12.3');
    expect(value(Number.NaN)).toBe('—');
    expect(percent(0.253)).toBe('25.3%');
    expect(signed(3.21)).toBe('+3.2');
    expect(signed(-3.21)).toBe('−3.2');
    expect(signed(0)).toBe('0.0');
    expect(signedPercentPoints(0.0123)).toBe('+1.23pp');
  });

  it('produces English ordinals including the teens', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(6.4)).toBe('6th');
  });

  it('colours deltas by sign with a dead band', () => {
    expect(deltaClass(1)).toBe('text-good-500');
    expect(deltaClass(-1)).toBe('text-bad-500');
    expect(deltaClass(0)).toBe('text-ink-400');
    expect(deltaClass(0.2, 0.5)).toBe('text-ink-400');
  });
});

describe('the Rating column is KeepTradeCut, unmodified', () => {
  // The contention slider used to be multiplied into a column labelled with
  // KeepTradeCut's name. At a weight of 0.55 it lifted CeeDee Lamb from his
  // real 74.6 to 80.2 and moved him from 14th on the board to 7th, so the app
  // silently disagreed with the source it cites. A column carrying a source's
  // name carries that source's value.
  const lamb = { rating: 74.6, redraft: 84.7 };

  it('never lets the timeline move a source value', () => {
    // Anywhere off the far-left stop the blend has moved him.
    for (const weight of [0.25, 0.55, 0.82, 1]) {
      expect(blendedRating(lamb as never, weight)).not.toBeCloseTo(lamb.rating, 1);
    }
    // Which is exactly why the column may not use it: the blend is a different
    // number at every setting, and the rating is one number at all of them.
    // Only at the far-left stop do the two coincide, which is what made the
    // bug survive — it looked right whenever anyone checked it on a rebuild.
    expect(blendedRating(lamb as never, 0)).toBeCloseTo(lamb.rating, 9);
    expect(blendedRating(lamb as never, 1)).toBeCloseTo(lamb.redraft, 9);
    expect(blendedRating(lamb as never, 0.55)).toBeCloseTo(80.2, 1);
  });

  it('orders the board by the rating, not by the blend', () => {
    // Lamb sits below Bowers on the dynasty board and above him on the blend.
    // Sorting by "Rating" has to reproduce the first ordering.
    const bowers = { rating: 83.2, redraft: 71.0 };
    expect(lamb.rating).toBeLessThan(bowers.rating);
    expect(blendedRating(lamb as never, 0.55)).toBeGreaterThan(
      blendedRating(bowers as never, 0.55),
    );
  });
});
