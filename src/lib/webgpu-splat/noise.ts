/**
 * Noise splats: the giant blobs and long needles a capture leaves at its edges and in empty space. They
 * are few (~0.02 % of an interior scan) but each can cover much of the screen, as smears and streaks.
 * Measured on that scan, dropping them changes normal interior views imperceptibly (47–56 dB PSNR).
 */

/** Longest axis over the middle one above which a splat is a needle (a streak across the view). */
export const NEEDLE_RATIO = 20;
/** Splats larger than this many times the scene's 99th size percentile are giants. */
export const GIANT_FACTOR = 2;
export const NEEDLE = 1;
export const GIANT = 2;

/** Whether axis scales (any order, any sign) make a needle. */
export function isNeedle(sx: number, sy: number, sz: number) {
  const a = Math.abs(sx), b = Math.abs(sy), c = Math.abs(sz);
  const max = Math.max(a, b, c);
  const mid = a + b + c - max - Math.min(a, b, c);
  return max > NEEDLE_RATIO * mid;
}

/** Size above which splats are giants: GIANT_FACTOR × the 99th percentile of a sample of `sizes`. */
export function giantSize(sizes: Float32Array, count: number) {
  const stride = Math.max(1, Math.floor(count / 100_000));
  const sample = new Float32Array(Math.ceil(count / stride));
  for (let k = 0; k < sample.length; k++) sample[k] = sizes[k * stride];
  sample.sort();
  return GIANT_FACTOR * sample[Math.floor((sample.length - 1) * 0.99)];
}
