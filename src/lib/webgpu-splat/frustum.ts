/**
 * Tight frustum culling ("hide splats the camera does not see"). The loose rule keeps every splat
 * centred up to 40 % past each screen edge; measured on an interior scan, 15–40 % of those never put a
 * pixel on screen yet still go through sorting, upload and the vertex shader. Here a splat stays only
 * if its own footprint can reach the screen, plus a margin for the camera motion until the next sort
 * replaces the list. Dropping a splat with no on-screen pixel never changes the image.
 */

/** Quad half-extent per unit of the worker's radius: 2√2·σ (splat.wgsl), with σ ≤ √3 × √(largest diagonal of Σ). */
export const FOOTPRINT = 2 * Math.SQRT2 * Math.sqrt(3);
/** splat.wgsl draws nothing for splats centred beyond this NDC. */
const SHADER_NDC_LIMIT = 1.5;
/** The loose rule: keep splats centred up to this screen fraction past each edge. */
export const LOOSE_MARGIN = 0.4;

export interface FrustumParams {
  /** Extra screen fraction kept past every edge: covers rotation and zoom until the next sort. */
  margin: number;
  /** World distance the camera may move until the next sort: covers parallax. */
  travel: number;
  /** proj[0] and proj[5]: clip-space size of a unit lateral offset. */
  scaleX: number;
  scaleY: number;
}

/** Per-sort constants of `reachesScreen` (so the per-splat test is a handful of multiplications). */
export interface FrustumTest {
  travel: number;
  /** travel × scale: how far a sideways move slides a centre, in clip units. */
  slideX: number;
  slideY: number;
  inner: number;
  cap: number;
  scaleX: number;
  scaleY: number;
}

export function frustumTest(f: FrustumParams): FrustumTest {
  return {
    travel: f.travel,
    slideX: f.travel * f.scaleX,
    slideY: f.travel * f.scaleY,
    inner: 1 + f.margin,
    cap: SHADER_NDC_LIMIT + f.margin,
    scaleX: f.scaleX,
    scaleY: f.scaleY,
  };
}

/**
 * Whether a splat at clip position (cx, cy, cw) with world radius `radius` can draw on screen.
 * Before the next sort its centre may slide (clip units) by cw·margin + travel·scale sideways, and
 * backing away pulls it in by travel·|ndc|. Everything is multiplied by cw (> 0) to skip divisions:
 * |c| ≤ cw·limit + cw·margin + travel·scale + travel·|c|/cw  ⇔  |c|·(cw − travel) ≤ cw·(cw·(limit + margin) + travel·scale).
 */
export function reachesScreen(cx: number, cy: number, cw: number, radius: number, k: FrustumTest) {
  // splat.worker.ts inlines these first two tests in its sort loop: keep both in step.
  const kx = (cx < 0 ? -cx : cx) * (cw - k.travel), ky = (cy < 0 ? -cy : cy) * (cw - k.travel);
  const inX = cw * (cw * k.inner + k.slideX), inY = cw * (cw * k.inner + k.slideY);
  if (kx <= inX && ky <= inY) return true;
  if (kx > cw * (cw * k.cap + k.slideX) || ky > cw * (cw * k.cap + k.slideY)) return false;
  return footprintReaches(cx, cy, cw, kx, ky, inX, inY, radius, k);
}

/** A centre off screen (but not past the shader's limit) still draws if its own footprint reaches in. */
export function footprintReaches(cx: number, cy: number, cw: number, kx: number, ky: number, inX: number, inY: number, radius: number, k: FrustumTest) {
  // Off-axis the projection stretches footprints by up to √(1 + tan²x + tan²y).
  const tx = cx / (cw * k.scaleX), ty = cy / (cw * k.scaleY);
  const reach = cw * radius * FOOTPRINT * Math.sqrt(1 + tx * tx + ty * ty);
  return kx <= inX + k.scaleX * reach && ky <= inY + k.scaleY * reach;
}
