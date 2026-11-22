/**
 * Tight frustum culling ("hide splats the camera does not see"). The loose rule keeps every splat
 * centred up to 40 % past each screen edge; measured on an interior scan, 15–40 % of those never put a
 * pixel on screen yet still go through sorting, upload and the vertex shader. Here a splat stays only
 * if its own footprint can reach the screen, plus a margin for the camera motion until the next sort
 * replaces the list. Dropping a splat with no on-screen pixel never changes the image.
 */

/** Quad half-extent per unit of the worker's radius: 2√2·σ (splat.wgsl), with σ ≤ √3 × √(largest diagonal of Σ). */
export const FOOTPRINT = 2 * Math.SQRT2 * Math.sqrt(3);

/**
 * Visible half-size of a splat's quad in units of √2σ for opacity `alpha` (0–255), as splat.wgsl draws it:
 * fragments with α·e^-r² < 1/255 are dropped, so a faint splat ends before the ±2 cutoff.
 */
export function alphaExtent(alpha: number) {
  return Math.min(2, Math.sqrt(Math.max(Math.log(alpha), 0)) * 1.01 + 0.01);
}
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
  /** For `nodeReachesScreen`: length of the side planes' normals, and the largest off-axis stretch of a drawn splat. */
  planeX: number;
  planeY: number;
  stretch: number;
  /** For `nodeReachesScreen`'s shader-limit bound: length of the normals of the planes |c| = cap·cw. */
  capPlaneX: number;
  capPlaneY: number;
}

export function frustumTest(f: FrustumParams): FrustumTest {
  const inner = 1 + f.margin, cap = SHADER_NDC_LIMIT + f.margin;
  return {
    travel: f.travel,
    slideX: f.travel * f.scaleX,
    slideY: f.travel * f.scaleY,
    inner,
    cap,
    scaleX: f.scaleX,
    scaleY: f.scaleY,
    planeX: Math.sqrt(f.scaleX * f.scaleX + inner * inner),
    planeY: Math.sqrt(f.scaleY * f.scaleY + inner * inner),
    stretch: Math.sqrt(1 + (cap / f.scaleX) ** 2 + (cap / f.scaleY) ** 2),
    capPlaneX: Math.hypot(f.scaleX, cap),
    capPlaneY: Math.hypot(f.scaleY, cap),
  };
}

/**
 * The shader draws no centre past its NDC limit `cap` (limit + margin), wherever the camera goes before the next sort:
 * at most `travel` nearer or farther (cw ± travel) and `slide` sideways. So a centre with |c| > cap·(cw + travel) + slide
 * never draws (|cx|, |cy| given as ax, ay). This holds at any depth. The bounds in reachesScreen divide by cw − travel
 * and kept everything beside the camera (cw ≤ travel): during fast moves up to a third of the splat budget, all off screen.
 * With the camera still (travel 0) it is the same as their own limit test.
 */
export function pastShaderLimit(ax: number, ay: number, cw: number, k: FrustumTest) {
  const capW = k.cap * (cw + k.travel);
  return ax > capW + k.slideX || ay > capW + k.slideY;
}

/**
 * Whether any splat of a tree node can pass `reachesScreen`: its centres lie within `half` (world) of the clip position
 * (cx, cy, cw) and its radii are at most `radius`. Not `reachesScreen` on a big radius: the shader's limit holds for one
 * centre only, and a big sphere near the camera projects larger than radius / depth. Divided by cw, reachesScreen keeps
 * a splat when |c| − inner·cw ≤ scale·(travel + FOOTPRINT·radius·stretch) + travel·|ndc|; moving to any of the node's
 * centres changes |c| − inner·cw by at most half·planeX (the side planes' gradient), so if that fails at the node's centre
 * by more, it fails for all of them.
 */
export function nodeReachesScreen(cx: number, cy: number, cw: number, half: number, radius: number, k: FrustumTest) {
  const ax = cx < 0 ? -cx : cx, ay = cy < 0 ? -cy : cy;
  // pastShaderLimit for the node's most central centre: |c| − cap·cw changes by at most half·capPlane across the node.
  const slack = k.cap * k.travel;
  if (ax - k.cap * cw > half * k.capPlaneX + slack + k.slideX || ay - k.cap * cw > half * k.capPlaneY + slack + k.slideY) return false;
  const near = cw - half;
  if (near <= k.travel) return true; // the bounds below divide by near − travel
  // The widest NDC a kept centre can have (the shader limit plus the slide, loosest at the node's nearest depth), and
  // the off-axis stretch there.
  let capX = k.cap, capY = k.cap, stretch = k.stretch;
  if (k.travel > 0) {
    capX = (k.cap * near + k.slideX) / (near - k.travel);
    capY = (k.cap * near + k.slideY) / (near - k.travel);
    stretch = Math.sqrt(1 + (capX / k.scaleX) ** 2 + (capY / k.scaleY) ** 2);
  }
  const foot = radius * FOOTPRINT * stretch + k.travel;
  return ax - k.inner * cw <= half * k.planeX + k.scaleX * foot + k.travel * capX && ay - k.inner * cw <= half * k.planeY + k.scaleY * foot + k.travel * capY;
}

/**
 * Whether a splat at clip position (cx, cy, cw) with world radius `radius` can draw on screen.
 * Before the next sort its centre may slide (clip units) by cw·margin + travel·scale sideways, and
 * backing away pulls it in by travel·|ndc|. Everything is multiplied by cw (> 0) to skip divisions:
 * |c| ≤ cw·limit + cw·margin + travel·scale + travel·|c|/cw  ⇔  |c|·(cw − travel) ≤ cw·(cw·(limit + margin) + travel·scale).
 */
export function reachesScreen(cx: number, cy: number, cw: number, radius: number, k: FrustumTest) {
  // splat.worker.ts inlines these first tests in its sort loop: keep both in step.
  const ax = cx < 0 ? -cx : cx, ay = cy < 0 ? -cy : cy;
  if (pastShaderLimit(ax, ay, cw, k)) return false;
  const kx = ax * (cw - k.travel), ky = ay * (cw - k.travel);
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
