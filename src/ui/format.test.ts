import { describe, expect, it } from 'vitest';
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
