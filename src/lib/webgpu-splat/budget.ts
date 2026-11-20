// `.ts` extension: the node self-check (budget.check.ts) imports this file directly.
import { LOD_MAX_SCALE } from './protocol.ts';

/**
 * Splat budget for the distance LOD (sort worker). LOD thins splats smaller than a threshold in screen
 * pixels, keeping each with probability px / threshold and growing the survivors so the covered area
 * stays the same. A budget raises that threshold until the expected number of kept splats fits, so
 * the smallest splats go first and big, near ones stay.
 */

/** Budget thinning keeps at least 1 in 16 of a size class: LOD_MAX_SCALE (4×) growth still covers their area. */
export const BUDGET_MIN_KEEP = 1 / (LOD_MAX_SCALE * LOD_MAX_SCALE);
/**
 * Size histogram: 4 bins per octave from 2^-16 px, indexed by a float's exponent and top two mantissa
 * bits (`(bits >> 21) - PX_BIN_OFFSET`), so binning needs no log per splat.
 */
export const PX_BINS = 128;
export const PX_BIN_OFFSET = (127 - 16) << 2;
const PX_BIN_CENTERS = Float64Array.from({ length: PX_BINS }, (_, b) => {
  const k = b + PX_BIN_OFFSET;
  return 2 ** ((k >> 2) - 127) * (1 + ((k & 3) + 0.5) / 4);
});

/** Stable per-splat random number in [0, 1) (murmur3 finalizer): which splats a thinning keeps. */
export function hash01(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Splats LOD thinning is expected to keep at `threshold` px, from the size histogram. */
export function expectedKept(counts: Uint32Array, threshold: number, minKeep: number) {
  let sum = 0;
  for (let b = 0; b < PX_BINS; b++) {
    const c = PX_BIN_CENTERS[b];
    sum += counts[b] * (c >= threshold ? 1 : Math.max(minKeep, c / threshold));
  }
  return sum;
}

/**
 * Thinning threshold and keep floor for `candidates` splats with size histogram `counts`: the quality
 * preset's `floor` / `minKeep`, raised until the expected count fits `budget` (0 = no limit).
 */
export function budgetThreshold(counts: Uint32Array, candidates: number, floor: number, minKeep: number, budget: number) {
  if (budget <= 0 || candidates <= budget) return { threshold: floor, minKeep };
  const keep = Math.min(minKeep, BUDGET_MIN_KEEP);
  if (expectedKept(counts, floor, keep) <= budget) return { threshold: floor, minKeep: keep };
  let lo = Math.max(floor, 1e-3), hi = 65536;
  for (let it = 0; it < 32; it++) {
    const mid = Math.sqrt(lo * hi);
    if (expectedKept(counts, mid, keep) > budget) lo = mid;
    else hi = mid;
  }
  return { threshold: hi, minKeep: keep };
}
