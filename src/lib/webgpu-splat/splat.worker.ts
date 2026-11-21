/// <reference lib="webworker" />
/**
 * Off-main-thread `.splat` pipeline:
 *   1. Streams the file with `fetch` and parses complete 32-byte records as
 *      they arrive (progressive loading — the first splats render while the
 *      rest is still downloading).
 *   2. Packs each splat into the 32-byte GPU layout (see protocol.ts) and
 *      transfers the packed chunk to the main thread (zero-copy).
 *   3. Keeps a compact copy of the positions and answers `sort` requests with
 *      a frustum-culled, back-to-front 16-bit counting sort. The order array
 *      ping-pongs between threads, so steady-state sorting allocates nothing.
 */
import {
  COVARIANCE_PACK_SCALE,
  LOD_INDEX_BITS,
  LOD_MAX_PACKED_SPLATS,
  LOD_MAX_SCALE,
  REVEAL_QUANTILE_STEPS,
  type LodParams,
  SPLAT_FILE_RECORD_BYTES,
  SPLAT_WORDS,
  type MainToWorker,
  type SceneTransform,
  type WorkerToMain,
} from './protocol';
import { buildVoxelGrid, floorCutHeight, SURFACE_ALPHA } from './collision';
import { alphaExtent, footprintReaches, frustumTest, LOOSE_MARGIN, type FrustumParams } from './frustum';
import { buildOcclusionGrid, isOccluded, occlusionMap, splatArea, type OcclusionGrid } from './occlusion';
import { budgetThreshold, hash01, PX_BIN_OFFSET, PX_BINS } from './budget';
import { GIANT, giantSize, isNeedle, NEEDLE } from './noise';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Parse/flush granularity: ~32k splats per GPU upload. */
const FLUSH_BYTES = SPLAT_FILE_RECORD_BYTES * 32768;
/** Loose clip-space margin (hide-unseen off): keeps large splats centred just off-screen. */
const CULL_MARGIN = 1 + LOOSE_MARGIN;
const SORT_BUCKETS = 65536;
/** Must match the vertex shader's near cull. */
const NEAR_CULL = 0.05;
/** Splats fainter than this are transparent to picking rays (the collision grid shares the threshold). */
const PICK_MIN_ALPHA = SURFACE_ALPHA;
/** Share of a splat's full footprint that its opacity (0–255) lets show (splat.wgsl shrinks faint quads alike). */
const ALPHA_REACH = Float32Array.from({ length: 256 }, (_, a) => alphaExtent(a) / 2);

// ─── State ──────────────────────────────────────────────────────────────────
let loadToken = 0;
let abortController: AbortController | null = null;

let positions = new Float32Array(0);
/** Per-splat opacity (0–255), used to ignore faint floaters when picking. */
let alphas = new Uint8Array(0);
/** Per-splat world radius (largest 1σ axis), for screen-size LOD. */
let radii = new Float32Array(0);
/** Per-splat noise flags (noise.ts): NEEDLE set while parsing, GIANT once the whole scene is in. */
let noise = new Uint8Array(0);
/** Per-splat mean screen area (occlusion.ts), only while loading: the occlusion grid is built from it. */
let areas = new Float32Array(0);
/** Scene opacity per voxel for occlusion culling (hide-unseen); null until the whole scene is in. */
let occluders: OcclusionGrid | null = null;
let splatCount = 0;
/** Floor cut height for the loaded scene, worked out once (collision.ts floorCutHeight). */
let floorCut: { key: string; height: number } | null = null;

let order: Uint32Array | null = new Uint32Array(0);
let pendingSort: { viewProj: Float32Array; view: Float32Array; lod: LodParams; frustum: FrustumParams | null } | null = null;
let depthScratch = new Float32Array(0);
let indexScratch = new Uint32Array(0);
let keyScratch = new Uint16Array(0);
const bucketCounts = new Uint32Array(SORT_BUCKETS);
const REVEAL_SAMPLES = 4096;

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

// ─── fp16 packing ─────────────────────────────────────────────────────────────
const f32Scratch = new Float32Array(1);
const i32Scratch = new Int32Array(f32Scratch.buffer);

function toHalf(value: number): number {
  f32Scratch[0] = value;
  const bits = i32Scratch[0];
  const sign = (bits >>> 16) & 0x8000;
  const exp = ((bits >>> 23) & 0xff) - 127 + 15;
  const frac = bits & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow → ±0
    const sub = (frac | 0x800000) >>> (1 - exp);
    return sign | ((sub + 0x1000) >>> 13);
  }
  if (exp >= 31) return sign | 0x7bff; // clamp to the largest finite half
  return sign | Math.min((exp << 10) + ((frac + 0x1000) >>> 13), 0x7bff);
}

function packHalf2(a: number, b: number): number {
  return (toHalf(a) | (toHalf(b) << 16)) >>> 0;
}

// ─── Scene transform (3×3 linear part + translation) ─────────────────────────
interface Affine {
  m: Float64Array; // row-major 3×3
  t: [number, number, number];
}

function buildAffine(transform?: SceneTransform): Affine | null {
  if (!transform) return null;
  const [qx, qy, qz, qw] = transform.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = transform.scale ?? [1, 1, 1];
  const t = transform.position ?? [0, 0, 0];
  const isIdentity =
    qx === 0 && qy === 0 && qz === 0 && qw === 1 &&
    sx === 1 && sy === 1 && sz === 1 &&
    t[0] === 0 && t[1] === 0 && t[2] === 0;
  if (isIdentity) return null;
  const m = new Float64Array([
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy - qw * qz) * sy, 2 * (qx * qz + qw * qy) * sz,
    2 * (qx * qy + qw * qz) * sx, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz - qw * qx) * sz,
    2 * (qx * qz - qw * qy) * sx, 2 * (qy * qz + qw * qx) * sy, (1 - 2 * (qx * qx + qy * qy)) * sz,
  ]);
  return { m, t: [t[0], t[1], t[2]] };
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
function ensurePositionCapacity(splats: number) {
  if (positions.length >= splats * 3) return;
  const capacity = Math.max(splats, Math.ceil((positions.length / 3) * 1.5));
  const next = new Float32Array(capacity * 3);
  next.set(positions.subarray(0, splatCount * 3));
  positions = next;
  const nextAlphas = new Uint8Array(capacity);
  nextAlphas.set(alphas.subarray(0, splatCount));
  alphas = nextAlphas;
  const nextRadii = new Float32Array(capacity);
  nextRadii.set(radii.subarray(0, splatCount));
  radii = nextRadii;
  const nextNoise = new Uint8Array(capacity);
  nextNoise.set(noise.subarray(0, splatCount));
  noise = nextNoise;
  const nextAreas = new Float32Array(capacity);
  nextAreas.set(areas.subarray(0, splatCount));
  areas = nextAreas;
}

/** Parses whole records in `bytes` and returns the packed GPU words. */
function parseRecords(bytes: Uint8Array, alphaThreshold: number, affine: Affine | null) {
  const records = Math.floor(bytes.byteLength / SPLAT_FILE_RECORD_BYTES);
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, records * 8);
  const packed = new Uint32Array(records * SPLAT_WORDS);
  const packedF32 = new Float32Array(packed.buffer);
  ensurePositionCapacity(splatCount + records);

  const cov = new Float64Array(6);
  let kept = 0;
  for (let r = 0; r < records; r++) {
    const byteBase = r * SPLAT_FILE_RECORD_BYTES;
    const alpha = bytes[byteBase + 27];
    if (alpha < alphaThreshold) continue;

    let x = f32[r * 8 + 0];
    let y = f32[r * 8 + 1];
    let z = f32[r * 8 + 2];
    const sx = f32[r * 8 + 3];
    const sy = f32[r * 8 + 4];
    const sz = f32[r * 8 + 5];

    // Quaternion stored as (w, x, y, z) bytes mapped from [-1, 1].
    let qw = (bytes[byteBase + 28] - 128) / 128;
    let qx = (bytes[byteBase + 29] - 128) / 128;
    let qy = (bytes[byteBase + 30] - 128) / 128;
    let qz = (bytes[byteBase + 31] - 128) / 128;
    const qlen = Math.hypot(qw, qx, qy, qz) || 1;
    qw /= qlen; qx /= qlen; qy /= qlen; qz /= qlen;

    // M = R · S (row-major); Σ = M · Mᵀ.
    const m00 = (1 - 2 * (qy * qy + qz * qz)) * sx;
    const m01 = 2 * (qx * qy - qw * qz) * sy;
    const m02 = 2 * (qx * qz + qw * qy) * sz;
    const m10 = 2 * (qx * qy + qw * qz) * sx;
    const m11 = (1 - 2 * (qx * qx + qz * qz)) * sy;
    const m12 = 2 * (qy * qz - qw * qx) * sz;
    const m20 = 2 * (qx * qz - qw * qy) * sx;
    const m21 = 2 * (qy * qz + qw * qx) * sy;
    const m22 = (1 - 2 * (qx * qx + qy * qy)) * sz;

    cov[0] = m00 * m00 + m01 * m01 + m02 * m02;
    cov[1] = m00 * m10 + m01 * m11 + m02 * m12;
    cov[2] = m00 * m20 + m01 * m21 + m02 * m22;
    cov[3] = m10 * m10 + m11 * m11 + m12 * m12;
    cov[4] = m10 * m20 + m11 * m21 + m12 * m22;
    cov[5] = m20 * m20 + m21 * m21 + m22 * m22;

    if (affine) {
      const a = affine.m;
      const nx = a[0] * x + a[1] * y + a[2] * z + affine.t[0];
      const ny = a[3] * x + a[4] * y + a[5] * z + affine.t[1];
      const nz = a[6] * x + a[7] * y + a[8] * z + affine.t[2];
      x = nx; y = ny; z = nz;
      // Σ' = A Σ Aᵀ
      const s = [cov[0], cov[1], cov[2], cov[1], cov[3], cov[4], cov[2], cov[4], cov[5]];
      const as = new Float64Array(9);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          as[i * 3 + j] = a[i * 3] * s[j] + a[i * 3 + 1] * s[3 + j] + a[i * 3 + 2] * s[6 + j];
        }
      }
      const out = (i: number, j: number) => as[i * 3] * a[j * 3] + as[i * 3 + 1] * a[j * 3 + 1] + as[i * 3 + 2] * a[j * 3 + 2];
      cov[0] = out(0, 0); cov[1] = out(0, 1); cov[2] = out(0, 2);
      cov[3] = out(1, 1); cov[4] = out(1, 2); cov[5] = out(2, 2);
    }

    const o = kept * SPLAT_WORDS;
    packedF32[o + 0] = x;
    packedF32[o + 1] = y;
    packedF32[o + 2] = z;
    packed[o + 3] =
      (bytes[byteBase + 24] |
        (bytes[byteBase + 25] << 8) |
        (bytes[byteBase + 26] << 16) |
        (alpha << 24)) >>> 0;
    const k = COVARIANCE_PACK_SCALE;
    packed[o + 4] = packHalf2(cov[0] * k, cov[1] * k);
    packed[o + 5] = packHalf2(cov[2] * k, cov[3] * k);
    packed[o + 6] = packHalf2(cov[4] * k, cov[5] * k);
    packed[o + 7] = 0;

    alphas[splatCount + kept] = alpha;
    radii[splatCount + kept] = Math.sqrt(Math.max(cov[0], cov[3], cov[5]));
    areas[splatCount + kept] = splatArea(cov[0], cov[1], cov[2], cov[3], cov[4], cov[5]);
    // shortcut: judged on the file's own scales; a non-uniform scene transform could make or unmake needles.
    noise[splatCount + kept] = isNeedle(sx, sy, sz) ? NEEDLE : 0;
    const p = (splatCount + kept) * 3;
    positions[p] = x;
    positions[p + 1] = y;
    positions[p + 2] = z;
    kept++;
  }

  const first = splatCount;
  splatCount += kept;
  return { first, count: kept, data: kept === records ? packed : packed.slice(0, kept * SPLAT_WORDS) };
}

/** Sampled distance-from-origin quantiles (see protocol.ts). */
function revealQuantiles() {
  const stride = Math.max(1, Math.floor(splatCount / REVEAL_SAMPLES));
  const dist = new Float32Array(Math.ceil(splatCount / stride));
  for (let i = 0, k = 0; i < splatCount; i += stride, k++) {
    dist[k] = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  }
  dist.sort();
  const out = new Float32Array(REVEAL_QUANTILE_STEPS + 1);
  for (let i = 0; i <= REVEAL_QUANTILE_STEPS; i++) {
    out[i] = dist[Math.round((i / REVEAL_QUANTILE_STEPS) * (dist.length - 1))];
  }
  return out;
}

async function load(url: string, alphaThreshold: number, transform: SceneTransform | undefined, token: number) {
  abortController?.abort();
  abortController = new AbortController();
  positions = new Float32Array(0);
  alphas = new Uint8Array(0);
  radii = new Float32Array(0);
  noise = new Uint8Array(0);
  areas = new Float32Array(0);
  occluders = null;
  floorCut = null;
  splatCount = 0;
  const affine = buildAffine(transform);

  const response = await fetch(url, { signal: abortController.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar la escena`);
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  const capacity = Math.floor(totalBytes / SPLAT_FILE_RECORD_BYTES);
  ensurePositionCapacity(Math.max(capacity, 1));
  post({ type: 'begin', capacity });

  const flush = (bytes: Uint8Array) => {
    const chunk = parseRecords(bytes, alphaThreshold, affine);
    if (chunk.count > 0) {
      post(
        { type: 'chunk', first: chunk.first, count: chunk.count, data: chunk.data, revealQuantiles: revealQuantiles() },
        [chunk.data.buffer],
      );
    }
  };

  const reader = response.body?.getReader();
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer());
    if (token !== loadToken) return;
    flush(all.subarray(0, all.byteLength - (all.byteLength % SPLAT_FILE_RECORD_BYTES)));
  } else {
    // Accumulate network chunks into a reusable staging buffer and parse in
    // FLUSH_BYTES blocks; partial records carry over to the next block.
    let staging = new Uint8Array(FLUSH_BYTES * 2);
    let used = 0;
    let loadedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (token !== loadToken) {
        await reader.cancel().catch(() => {});
        return;
      }
      if (value) {
        loadedBytes += value.byteLength;
        if (used + value.byteLength > staging.byteLength) {
          const grown = new Uint8Array(Math.max(staging.byteLength * 2, used + value.byteLength));
          grown.set(staging.subarray(0, used));
          staging = grown;
        }
        staging.set(value, used);
        used += value.byteLength;
        post({ type: 'progress', loadedBytes, totalBytes });
      }
      if (used >= FLUSH_BYTES || (done && used > 0)) {
        const whole = used - (used % SPLAT_FILE_RECORD_BYTES);
        if (whole > 0) {
          // Copy out so the transferred/parsed block never aliases staging.
          flush(staging.slice(0, whole));
          staging.copyWithin(0, whole, used);
          used -= whole;
        }
      }
      if (done) break;
    }
  }

  if (token !== loadToken) return;
  if (splatCount === 0) throw new Error('El archivo no contiene splats válidos (.splat)');
  // Arrays were sized from the file before faint splats were dropped: trim them to what loaded.
  if (positions.length > splatCount * 3 * 1.1) {
    positions = positions.slice(0, splatCount * 3);
    alphas = alphas.slice(0, splatCount);
    radii = radii.slice(0, splatCount);
    noise = noise.slice(0, splatCount);
  }
  // Giants are relative to this scene's own sizes, known only now.
  const giant = giantSize(radii, splatCount);
  for (let i = 0; i < splatCount; i++) if (radii[i] > giant) noise[i] |= GIANT;
  // Before 'done': the main thread only accepts a grid while its load is still pending.
  const grid = buildVoxelGrid(positions, alphas, splatCount);
  occluders = grid && buildOcclusionGrid(grid, positions, alphas, areas, splatCount);
  areas = new Float32Array(0);
  if (grid) post({ type: 'grid', grid }, [grid.bits.buffer]);
  post({ type: 'done', count: splatCount });
  runPendingSort();
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
/** Candidate sizes in screen px for the splat budget (binning inlined in `sort`, see budget.ts). */
const pxHistogram = new Uint32Array(PX_BINS);
const pxFloat = new Float32Array(1);
const pxBits = new Int32Array(pxFloat.buffer);

/** `frustum`: tight culling (only splats that can reach the screen); null keeps the loose margin. */
function sort(viewProj: Float32Array, view: Float32Array, lod: LodParams, frustum: FrustumParams | null) {
  const start = performance.now();
  const n = splatCount;
  // Sized to the position arrays' capacity (no regrowth while streaming); shrinks once they are trimmed.
  const capacity = Math.max(n, positions.length / 3);
  if (!order || order.length < n || order.length > capacity * 1.25) order = new Uint32Array(capacity);
  if (depthScratch.length !== order.length) {
    depthScratch = new Float32Array(order.length);
    indexScratch = new Uint32Array(order.length);
    keyScratch = new Uint16Array(order.length);
  }

  const vp = viewProj;
  const p = positions;
  const dz0 = view[2], dz1 = view[6], dz2 = view[10], dz3 = view[14];
  let visible = 0;
  let lodCulled = 0;
  /** Splats the loose margin would keep that cannot reach the screen. */
  let offscreen = 0;
  /** In-view giant and needle splats skipped (noise.ts). */
  let noisy = 0;
  const hideNoise = lod.hideNoise;
  /** In-view splats under the floor (floor cut). */
  let underground = 0;
  const cut = lod.cutBelow;
  const cutAxis = cut ? cut.axis : 0, cutSign = cut ? cut.sign : 0;
  let cutHeight = 0;
  if (cut) {
    const key = `${cut.axis},${cut.sign},${cut.floor},${cut.voxel},${n}`;
    if (floorCut?.key !== key) floorCut = { key, height: floorCutHeight(p, n, cut.axis, cut.sign, cut.floor, cut.voxel) };
    cutHeight = floorCut.height;
  }
  /** Splats hidden behind the first layer the camera sees (hide-unseen, occlusion.ts). */
  let occluded = 0;
  const occ = frustum && occluders ? occlusionMap(occluders, view, frustum.scaleX, frustum.scaleY, 1 + frustum.margin, frustum.travel) : null;
  const test = frustum && frustumTest(frustum);
  // reachesScreen's constants as locals: its fast path is inlined below.
  const tTravel = test ? test.travel : 0, tInner = test ? test.inner : 0, tCap = test ? test.cap : 0;
  const tSlideX = test ? test.slideX : 0, tSlideY = test ? test.slideY : 0;
  const packed = n <= LOD_MAX_PACKED_SPLATS;
  const budget = packed ? lod.budget : 0;
  // Thinning needs the LOD scale bits of packed order entries.
  const thin = packed && (lod.minPx > 0 || budget > 0);
  if (thin) pxHistogram.fill(0);
  let candidates = 0;
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const d = dz0 * x + dz1 * y + dz2 * z + dz3; // view-space z (more negative = farther)
    if (d > -NEAR_CULL) continue; // behind the eye (also for orthographic)
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (cw <= 1e-4) continue;
    const lim = cw * CULL_MARGIN;
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const loose = cx >= -lim && cx <= lim && cy >= -lim && cy <= lim;
    // Depth buckets span the loose set either way, so hiding unseen splats never reorders the rest.
    if (loose) {
      if (d < minDepth) minDepth = d;
      if (d > maxDepth) maxDepth = d;
    }
    if (test) {
      // reachesScreen (frustum.ts) inlined: a function call per splat costs ~25 % more sort time.
      const kx = (cx < 0 ? -cx : cx) * (cw - tTravel), ky = (cy < 0 ? -cy : cy) * (cw - tTravel);
      const inX = cw * (cw * tInner + tSlideX), inY = cw * (cw * tInner + tSlideY);
      if ((kx > inX || ky > inY) && (kx > cw * (cw * tCap + tSlideX) || ky > cw * (cw * tCap + tSlideY) || !footprintReaches(cx, cy, cw, kx, ky, inX, inY, radii[i] * ALPHA_REACH[alphas[i]], test))) {
        if (loose) offscreen++;
        continue;
      }
    } else if (!loose) {
      continue;
    }
    if (hideNoise && noise[i] !== 0) {
      noisy++;
      continue;
    }
    if (cut && cutSign * p[i * 3 + cutAxis] < cutHeight) {
      underground++;
      continue;
    }
    if (occ && isOccluded(occ, cx, cy, cw, radii[i] * ALPHA_REACH[alphas[i]])) {
      occluded++;
      continue;
    }

    depthScratch[candidates] = d;
    indexScratch[candidates] = i;
    candidates++;
    if (thin) {
      pxFloat[0] = (radii[i] * lod.focalPx) / (lod.ortho ? 1 : -d);
      pxHistogram[Math.min(PX_BINS - 1, Math.max(0, (pxBits[0] >> 21) - PX_BIN_OFFSET))]++;
    }
  }

  // Distance LOD: thin splats smaller than `threshold` px, keeping each with probability px / threshold
  // and growing the survivors so the covered area stays the same. The quality preset sets the floor;
  // a splat budget raises it until the expected count fits. The hash makes the choice stable, so
  // approaching a region only ever adds splats.
  const { threshold, minKeep } = thin ? budgetThreshold(pxHistogram, candidates, lod.minPx, lod.minKeep, budget) : { threshold: 0, minKeep: 1 };
  const lodScaleToByte = 255 / (LOD_MAX_SCALE - 1);
  for (let c = 0; c < candidates; c++) {
    const i = indexScratch[c], d = depthScratch[c];
    let lodByte = 0;
    if (threshold > 0) {
      const px = (radii[i] * lod.focalPx) / (lod.ortho ? 1 : -d);
      if (px < threshold) {
        const keep = Math.max(minKeep, px / threshold);
        if (hash01(i) >= keep) {
          lodCulled++;
          continue;
        }
        const grow = Math.min(LOD_MAX_SCALE, 1 / Math.sqrt(keep)); // area ∝ 1/keep
        lodByte = Math.round((grow - 1) * lodScaleToByte);
      }
    }
    depthScratch[visible] = d;
    indexScratch[visible] = packed ? (i | (lodByte << LOD_INDEX_BITS)) >>> 0 : i;
    visible++;
  }

  // 16-bit counting sort, ascending view z → farthest first (back-to-front).
  bucketCounts.fill(0);
  const range = maxDepth - minDepth;
  const scale = range > 0 ? (SORT_BUCKETS - 1) / range : 0;
  for (let i = 0; i < visible; i++) {
    // Clamped: a big splat kept from past the loose margin can lie outside the bucket range.
    const key = Math.min(SORT_BUCKETS - 1, Math.max(0, ((depthScratch[i] - minDepth) * scale) | 0));
    keyScratch[i] = key;
    bucketCounts[key]++;
  }
  let sum = 0;
  for (let b = 0; b < SORT_BUCKETS; b++) {
    const c = bucketCounts[b];
    bucketCounts[b] = sum;
    sum += c;
  }
  for (let i = 0; i < visible; i++) {
    order[bucketCounts[keyScratch[i]]++] = indexScratch[i];
  }

  const out = order;
  order = null; // lent to the main thread until it is recycled
  post({ type: 'sorted', order: out, visible, sortMs: performance.now() - start, packed, lodCulled, offscreen, noisy, occluded, underground }, [out.buffer]);
}

function runPendingSort() {
  if (!pendingSort || !order || splatCount === 0) return;
  const { viewProj, view, lod, frustum } = pendingSort;
  pendingSort = null;
  sort(viewProj, view, lod, frustum);
}

// ─── Picking ──────────────────────────────────────────────────────────────────
function pick(origin: [number, number, number], dir: [number, number, number], coneTan: number, coneRadius: number, near: number) {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  const p = positions;
  let bestT = Infinity;
  let best = -1;
  for (let i = 0; i < splatCount; i++) {
    if (alphas[i] < PICK_MIN_ALPHA) continue;
    const vx = p[i * 3] - ox, vy = p[i * 3 + 1] - oy, vz = p[i * 3 + 2] - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if (t <= near || t >= bestT) continue;
    const perp2 = vx * vx + vy * vy + vz * vz - t * t;
    const r = coneRadius + coneTan * t;
    if (perp2 <= r * r) {
      bestT = t;
      best = i;
    }
  }
  if (best < 0) return null;
  return [p[best * 3], p[best * 3 + 1], p[best * 3 + 2]] as [number, number, number];
}

// ─── Messages ─────────────────────────────────────────────────────────────────
ctx.onmessage = (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'load': {
      const token = ++loadToken;
      load(msg.url, msg.alphaThreshold, msg.transform, token).catch((error: unknown) => {
        if (token !== loadToken) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      });
      break;
    }
    case 'abort':
      loadToken++;
      abortController?.abort();
      abortController = null;
      splatCount = 0;
      occluders = null;
      pendingSort = null;
      break;
    case 'sort':
      pendingSort = { viewProj: msg.viewProj, view: msg.view, lod: msg.lod, frustum: msg.frustum };
      runPendingSort();
      break;
    case 'recycle':
      order = msg.order;
      runPendingSort();
      break;
    case 'pick':
      post({ type: 'picked', id: msg.id, point: pick(msg.origin, msg.dir, msg.coneTan, msg.coneRadius, msg.near ?? NEAR_CULL) });
      break;
  }
};
