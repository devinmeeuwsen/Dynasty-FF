/**
 * Production-by-age curves used to turn a one-year ordering into a dynasty
 * ordering. Peak is 1.0. Anchors are interpolated piecewise linearly.
 *
 * These are the model's opinion about aging, stated explicitly so it can be
 * argued with. Running backs fall off a cliff at 28-30, receivers hold a broad
 * peak from 24 to 29, tight ends peak late and decline slowly, quarterbacks are
 * flat from 27 to 34.
 */
export const AGE_CURVES = {
  QB: [[21, 0.72], [25, 0.94], [28, 1.0], [34, 1.0], [36, 0.84], [39, 0.55], [43, 0.2]],
  RB: [[21, 0.86], [24, 1.0], [26, 0.95], [28, 0.8], [30, 0.55], [32, 0.3], [35, 0.1]],
  WR: [[21, 0.7], [24, 0.95], [26, 1.0], [29, 0.93], [31, 0.75], [33, 0.5], [36, 0.2]],
  TE: [[22, 0.55], [25, 0.85], [27, 1.0], [30, 0.93], [32, 0.78], [34, 0.55], [37, 0.25]],
};

export function productionAtAge(position, age) {
  const anchors = AGE_CURVES[position];
  if (!anchors) return 1;
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
 * Discounted sum of remaining production, normalised so a player already at his
 * peak with a long career ahead scores near 1. This is what separates the
 * dynasty ordering from the redraft one.
 */
export function horizonMultiplier(position, age, years = 10, discount = 0.88) {
  let sum = 0;
  let norm = 0;
  for (let t = 0; t < years; t++) {
    sum += productionAtAge(position, age + t) * Math.pow(discount, t);
    norm += Math.pow(discount, t);
  }
  return sum / norm;
}
