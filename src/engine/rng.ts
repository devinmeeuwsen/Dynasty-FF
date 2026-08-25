/**
 * Deterministic RNG.
 *
 * Every simulation run is seeded. Baseline and trade scenarios are run under
 * identical seeds so the two share common random numbers: the difference
 * between two matrices then reflects the roster change alone rather than
 * Monte Carlo noise. Without this, pick values visibly jitter between runs and
 * small trade deltas are unreadable.
 */
export interface Rng {
  next(): number;
  normal(): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller with a cached spare, so the normal stream is cheap.
  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };

  return { next, normal };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}
