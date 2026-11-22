/// <reference lib="webworker" />
/**
 * Off-main-thread `.splat` pipeline:
 *   1. Streams the file with `fetch` and parses complete 32-byte records as
 *      they arrive (progressive loading — the first splats render while the
 *      rest is still downloading).
 *   2. Packs the splats in blocks of 256 into the 20-byte GPU layout (pack.ts)
 *      and transfers each packed chunk to the main thread (zero-copy).
 *   3. Once the whole scene is in, builds the LOD tree (lod.ts) and uploads its
 *      merged splats after the originals.
 *   4. Answers `sort` requests: walks the tree (skipping nodes off the screen or
 *      hidden, drawing small far nodes as their merged splat), then sorts what
 *      is left back to front with a 16-bit counting sort. The order array
 *      ping-pongs between threads, so steady-state sorting allocates nothing.
 */
import {
  REVEAL_QUANTILE_STEPS,
  type LodParams,
  SPLAT_FILE_RECORD_BYTES,
  type MainToWorker,
  type SceneTransform,
  type WorkerToMain,
} from './protocol';
import { BLOCK_FLOATS, BLOCK_SPLATS, decompose, packBlock, quatMatrix, SPLAT_WORDS } from './pack';
import { buildLod, type LodTree } from './lod';
import { buildVoxelGrid, floorCutHeight, SURFACE_ALPHA } from './collision';
import { alphaExtent, FOOTPRINT, footprintReaches, frustumTest, LOOSE_MARGIN, nodeReachesScreen, type FrustumParams } from './frustum';
import { buildOcclusionGrid, isOccluded, nodeOccluded, occlusionMap, type OcclusionGrid } from './occlusion';
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
/**
 * Splat budget: the pass over the tree also counts what each larger merge size would draw, in bins of
 * 1/HIST_STEPS octave from HIST_MIN px (bin b: HIST_MIN · 2^(b / HIST_STEPS) px, 1/8 px to 512 px); the
 * smallest size that fits is then applied to that pass's list, with no second pass.
 */
const HIST_MIN = 0.125;
const HIST_STEPS = 16;
const HIST_BINS = 12 * HIST_STEPS;
/** First bin whose merge size is above `px`. */
const binAbove = (px: number) => (px < HIST_MIN ? 0 : px >= Infinity ? HIST_BINS : Math.min(HIST_BINS, Math.floor(Math.log2(px / HIST_MIN) * HIST_STEPS) + 1));

// ─── State ──────────────────────────────────────────────────────────────────
let loadToken = 0;
let abortController: AbortController | null = null;

/** Per splat, in Morton order once the tree is built (`gpuIndex` maps back to the GPU index). */
let positions = new Float32Array(0);
/** Per-splat opacity (0–255), used to ignore faint floaters when picking. */
let alphas = new Uint8Array(0);
/** Per-splat world radius (√ largest diagonal of Σ), for culling and screen size. */
let radii = new Float32Array(0);
/** Per-splat noise flags (noise.ts): NEEDLE set while parsing, GIANT once the whole scene is in. */
let noise = new Uint8Array(0);
/** While loading only: per-splat axis scales (3 each), quaternion bytes and rgba, for packing and the tree. */
let scales = new Float32Array(0);
let quats = new Uint32Array(0);
let colors = new Uint32Array(0);
let splatCount = 0;
/** Splats already packed and sent (whole blocks while streaming). */
let packedCount = 0;
/** Scene opacity per voxel for occlusion culling (hide-unseen); null until the whole scene is in. */
let occluders: OcclusionGrid | null = null;
/** Floor cut height for the loaded scene, worked out once (collision.ts floorCutHeight). */
let floorCut: { key: string; height: number } | null = null;
/** The LOD tree (null while streaming), the GPU index of node 0's merged splat, and Morton → GPU index. */
let tree: LodTree | null = null;
let mergedBase = 0;
let gpuIndex: Uint32Array | null = null;
/** Per tree node: centre of the box of its splats' centres and half its diagonal (4 each). */
let nodeSphere = new Float32Array(0);
/** In-view splats the last streaming sort found (its budget thinning keeps a share of them). */
let lastCandidates = 0;
/** Merge size (px) the splat budget settled on last sort: the next one starts its walk just below it. */
let budgetPx = 0;

let order: Uint32Array | null = new Uint32Array(0);
let pendingSort: { viewProj: Float32Array; view: Float32Array; lod: LodParams; frustum: FrustumParams | null } | null = null;
let depthScratch = new Float32Array(0);
let indexScratch = new Uint32Array(0);
let keyScratch = new Uint16Array(0);
/** Per listed item: the first budget bin from which a larger merge size no longer draws it (an ancestor stands in). */
let untilScratch = new Uint8Array(0);
/** Tree nodes a larger merge size would draw merged: node, depth of its merged splat, its first bin and the first past it. */
let openNode = new Uint32Array(0);
let openDepth = new Float32Array(0);
let openFrom = new Uint8Array(0);
let openTo = new Uint8Array(0);
const bucketCounts = new Uint32Array(SORT_BUCKETS);
const nodeStack = new Int32Array(4096);
/** Per stacked node: the first budget bin at which its parent would be drawn merged instead. */
const parentBin = new Int32Array(4096);
/** Budget count per merge size, as differences between bins (see HIST_STEPS). */
const histogram = new Int32Array(HIST_BINS + 1);
const REVEAL_SAMPLES = 4096;

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

/** Stable per-splat random number in [0, 1) (murmur3 finalizer): which splats a streaming budget keeps. */
function hash01(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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
function ensureCapacity(splats: number) {
  if (positions.length >= splats * 3) return;
  const capacity = Math.max(splats, Math.ceil((positions.length / 3) * 1.5));
  const grow = <T extends Float32Array | Uint32Array | Uint8Array>(old: T, per: number, make: (n: number) => T) => {
    const next = make(capacity * per);
    next.set(old.subarray(0, splatCount * per));
    return next;
  };
  positions = grow(positions, 3, (n) => new Float32Array(n));
  alphas = grow(alphas, 1, (n) => new Uint8Array(n));
  radii = grow(radii, 1, (n) => new Float32Array(n));
  noise = grow(noise, 1, (n) => new Uint8Array(n));
  scales = grow(scales, 3, (n) => new Float32Array(n));
  quats = grow(quats, 1, (n) => new Uint32Array(n));
  colors = grow(colors, 1, (n) => new Uint32Array(n));
}

/** Parses whole records in `bytes` into the per-splat arrays (opacity under `alphaThreshold` is dropped). */
function parseRecords(bytes: Uint8Array, alphaThreshold: number, affine: Affine | null) {
  const records = Math.floor(bytes.byteLength / SPLAT_FILE_RECORD_BYTES);
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, records * 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ensureCapacity(splatCount + records);
  const r = new Float64Array(9);
  const c = new Float64Array(6);
  for (let rec = 0; rec < records; rec++) {
    const at = rec * SPLAT_FILE_RECORD_BYTES;
    const alpha = bytes[at + 27];
    if (alpha < alphaThreshold) continue;
    const i = splatCount++;
    let x = f32[rec * 8], y = f32[rec * 8 + 1], z = f32[rec * 8 + 2];
    const sx = Math.abs(f32[rec * 8 + 3]), sy = Math.abs(f32[rec * 8 + 4]), sz = Math.abs(f32[rec * 8 + 5]);
    // Quaternion stored as (w, x, y, z) bytes mapped from [-1, 1]: kept as the file has it.
    let quat = view.getUint32(at + 28, true);
    // Σ = R S² Rᵀ, for the radius (and the scene transform).
    quatMatrix(quat, r);
    const xx = sx * sx, yy = sy * sy, zz = sz * sz;
    c[0] = r[0] * r[0] * xx + r[1] * r[1] * yy + r[2] * r[2] * zz;
    c[1] = r[0] * r[3] * xx + r[1] * r[4] * yy + r[2] * r[5] * zz;
    c[2] = r[0] * r[6] * xx + r[1] * r[7] * yy + r[2] * r[8] * zz;
    c[3] = r[3] * r[3] * xx + r[4] * r[4] * yy + r[5] * r[5] * zz;
    c[4] = r[3] * r[6] * xx + r[4] * r[7] * yy + r[5] * r[8] * zz;
    c[5] = r[6] * r[6] * xx + r[7] * r[7] * yy + r[8] * r[8] * zz;
    scales[i * 3] = sx; scales[i * 3 + 1] = sy; scales[i * 3 + 2] = sz;
    if (affine) {
      const a = affine.m;
      [x, y, z] = [
        a[0] * x + a[1] * y + a[2] * z + affine.t[0],
        a[3] * x + a[4] * y + a[5] * z + affine.t[1],
        a[6] * x + a[7] * y + a[8] * z + affine.t[2],
      ];
      // Σ' = A Σ Aᵀ, back to scales + rotation (any transform, also a non-uniform scale).
      const s = [c[0], c[1], c[2], c[1], c[3], c[4], c[2], c[4], c[5]];
      const as = new Float64Array(9);
      for (let p = 0; p < 3; p++) {
        for (let q = 0; q < 3; q++) as[p * 3 + q] = a[p * 3] * s[q] + a[p * 3 + 1] * s[3 + q] + a[p * 3 + 2] * s[6 + q];
      }
      const out = (p: number, q: number) => as[p * 3] * a[q * 3] + as[p * 3 + 1] * a[q * 3 + 1] + as[p * 3 + 2] * a[q * 3 + 2];
      c[0] = out(0, 0); c[1] = out(0, 1); c[2] = out(0, 2); c[3] = out(1, 1); c[4] = out(1, 2); c[5] = out(2, 2);
      quat = decompose(c[0], c[1], c[2], c[3], c[4], c[5], scales, i * 3);
    }
    quats[i] = quat;
    colors[i] = view.getUint32(at + 24, true);
    alphas[i] = alpha;
    radii[i] = Math.sqrt(Math.max(c[0], c[3], c[5]));
    // shortcut: judged on the file's own scales; a non-uniform scene transform could make or unmake needles.
    noise[i] = isNeedle(sx, sy, sz) ? NEEDLE : 0;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
}

/**
 * Packs splats `from`…`to` (one or more whole blocks, the last may be short) of the given arrays and sends
 * them as GPU splats starting at index `first`.
 */
function sendSplats(first: number, from: number, to: number, pos: Float32Array, sc: Float32Array, qs: Uint32Array, cs: Uint32Array, reveal: boolean) {
  const count = to - from;
  if (count <= 0) return;
  const blocks = Math.ceil(count / BLOCK_SPLATS);
  const data = new Uint32Array(count * SPLAT_WORDS);
  const boxes = new Float32Array(blocks * BLOCK_FLOATS);
  for (let b = 0; b < blocks; b++) {
    const src = from + b * BLOCK_SPLATS;
    packBlock(pos, sc, qs, cs, src, Math.min(BLOCK_SPLATS, to - src), data, b * BLOCK_SPLATS * SPLAT_WORDS, boxes, b * BLOCK_FLOATS);
  }
  post({ type: 'chunk', first, count, data, boxes, revealQuantiles: reveal ? revealQuantiles() : undefined }, [data.buffer, boxes.buffer]);
}

/** Sends the whole blocks parsed so far (or everything, at the end). */
function sendParsed(final: boolean) {
  const to = final ? splatCount : splatCount - (splatCount % BLOCK_SPLATS);
  sendSplats(packedCount, packedCount, to, positions, scales, quats, colors, true);
  packedCount = Math.max(packedCount, to);
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

function reset() {
  positions = new Float32Array(0);
  alphas = new Uint8Array(0);
  radii = new Float32Array(0);
  noise = new Uint8Array(0);
  scales = new Float32Array(0);
  quats = new Uint32Array(0);
  colors = new Uint32Array(0);
  splatCount = packedCount = 0;
  occluders = null;
  floorCut = null;
  tree = null;
  gpuIndex = null;
  nodeSphere = new Float32Array(0);
  lastCandidates = budgetPx = 0;
  openNode = new Uint32Array(0);
  openDepth = new Float32Array(0);
  openFrom = new Uint8Array(0);
  openTo = new Uint8Array(0);
}

async function load(url: string, alphaThreshold: number, transform: SceneTransform | undefined, token: number) {
  abortController?.abort();
  abortController = new AbortController();
  reset();
  const affine = buildAffine(transform);

  const response = await fetch(url, { signal: abortController.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar la escena`);
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  const capacity = Math.floor(totalBytes / SPLAT_FILE_RECORD_BYTES);
  ensureCapacity(Math.max(capacity, 1));
  post({ type: 'begin', capacity });

  const flush = (bytes: Uint8Array) => {
    parseRecords(bytes, alphaThreshold, affine);
    sendParsed(false);
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
          flush(staging.subarray(0, whole));
          staging.copyWithin(0, whole, used);
          used -= whole;
        }
      }
      if (done) break;
    }
  }

  if (token !== loadToken) return;
  if (splatCount === 0) throw new Error('El archivo no contiene splats válidos (.splat)');
  sendParsed(true);
  // Giants are relative to this scene's own sizes, known only now.
  const giant = giantSize(radii, splatCount);
  for (let i = 0; i < splatCount; i++) if (radii[i] > giant) noise[i] |= GIANT;
  // Before 'done': the main thread only accepts a grid while its load is still pending.
  const grid = buildVoxelGrid(positions, alphas, splatCount);
  occluders = grid && buildOcclusionGrid(grid, positions, alphas, scales, splatCount);
  if (grid) post({ type: 'grid', grid }, [grid.bits.buffer]);

  // LOD: the tree over the whole scene, its merged splats after the originals (from a fresh block).
  const [origin, size] = grid
    ? [grid.origin, grid.dims.map((d) => d * grid.voxel)]
    : sceneBox(positions, splatCount);
  tree = buildLod(positions, scales, quats, colors, radii, splatCount, origin, size);
  mergedBase = Math.ceil(splatCount / BLOCK_SPLATS) * BLOCK_SPLATS;
  sendSplats(mergedBase, 0, tree.nodes, tree.mean, tree.scales, tree.quats, tree.colors, false);
  // The tree walks its splats in Morton order: put the per-splat arrays in that order too.
  const perm = tree.perm;
  const reorder = <T extends Float32Array | Uint8Array>(old: T, per: number, make: (n: number) => T) => {
    const next = make(splatCount * per);
    for (let j = 0; j < splatCount; j++) for (let a = 0; a < per; a++) next[j * per + a] = old[perm[j] * per + a];
    return next;
  };
  positions = reorder(positions, 3, (n) => new Float32Array(n));
  radii = reorder(radii, 1, (n) => new Float32Array(n));
  alphas = reorder(alphas, 1, (n) => new Uint8Array(n));
  noise = reorder(noise, 1, (n) => new Uint8Array(n));
  gpuIndex = perm;
  nodeSphere = new Float32Array(tree.nodes * 4);
  for (let k = 0; k < tree.nodes; k++) {
    const lo = tree.lo, hi = tree.hi;
    const hx = (hi[k * 3] - lo[k * 3]) * 0.5, hy = (hi[k * 3 + 1] - lo[k * 3 + 1]) * 0.5, hz = (hi[k * 3 + 2] - lo[k * 3 + 2]) * 0.5;
    nodeSphere[k * 4] = lo[k * 3] + hx;
    nodeSphere[k * 4 + 1] = lo[k * 3 + 1] + hy;
    nodeSphere[k * 4 + 2] = lo[k * 3 + 2] + hz;
    nodeSphere[k * 4 + 3] = Math.sqrt(hx * hx + hy * hy + hz * hz);
  }
  // Packed and merged: what is left of the load-only data can go.
  scales = new Float32Array(0);
  quats = new Uint32Array(0);
  colors = new Uint32Array(0);
  tree.scales = new Float32Array(0);
  tree.quats = new Uint32Array(0);
  tree.colors = new Uint32Array(0);
  post({ type: 'done', count: splatCount, total: mergedBase + tree.nodes });
  runPendingSort();
}

/** Bounding box of the splats (when the scene is too small for a voxel grid). */
function sceneBox(p: Float32Array, n: number): [number[], number[]] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p[i * 3 + a]);
      hi[a] = Math.max(hi[a], p[i * 3 + a]);
    }
  }
  return [lo, hi.map((h, a) => Math.max(h - lo[a], 1e-6))];
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
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
    untilScratch = new Uint8Array(order.length);
  }
  const counting = !!tree && lod.budget > 0;
  if (tree && counting && openNode.length < tree.nodes) {
    openNode = new Uint32Array(tree.nodes);
    openDepth = new Float32Array(tree.nodes);
    openFrom = new Uint8Array(tree.nodes);
    openTo = new Uint8Array(tree.nodes);
  }

  const vp = viewProj;
  const p = positions;
  const dz0 = view[2], dz1 = view[6], dz2 = view[10], dz3 = view[14];
  const hideNoise = lod.hideNoise;
  const cut = lod.cutBelow;
  const cutAxis = cut ? cut.axis : 0, cutSign = cut ? cut.sign : 0;
  let cutHeight = 0;
  if (cut) {
    const key = `${cut.axis},${cut.sign},${cut.floor},${cut.voxel},${n}`;
    if (floorCut?.key !== key) floorCut = { key, height: floorCutHeight(p, n, cut.axis, cut.sign, cut.floor, cut.voxel) };
    cutHeight = floorCut.height;
  }
  const occ = frustum && occluders ? occlusionMap(occluders, view, frustum.scaleX, frustum.scaleY, 1 + frustum.margin, frustum.travel) : null;
  const test = frustum && frustumTest(frustum);
  // reachesScreen's constants as locals: its fast path is inlined below.
  const tTravel = test ? test.travel : 0, tInner = test ? test.inner : 0, tCap = test ? test.cap : 0;
  const tSlideX = test ? test.slideX : 0, tSlideY = test ? test.slideY : 0;
  const ids = gpuIndex;
  // While streaming (no tree yet) a budget keeps a stable share of the splats in view.
  const keep = !tree && lod.budget > 0 && lastCandidates > lod.budget ? lod.budget / lastCandidates : 1;
  const scaleOf = (d: number) => lod.focalPx / (lod.ortho ? 1 : -d);

  let visible = 0, minDepth = Infinity, maxDepth = -Infinity;
  /** Splats the loose margin would keep that cannot reach the screen. */
  let offscreen = 0;
  /** In-view giant and needle splats skipped (noise.ts). */
  let noisy = 0;
  /** In-view splats under the floor (floor cut). */
  let underground = 0;
  /** Splats hidden behind the first layer the camera sees (hide-unseen, occlusion.ts). */
  let occluded = 0;
  /** Splats drawn as part of a merged LOD splat (or, while streaming, left out by the budget). */
  let merged = 0;
  let candidates = 0;
  /** Nodes listed in openNode by the last walk. */
  let opened = 0;

  const emit = (d: number, index: number, until: number) => {
    depthScratch[visible] = d;
    indexScratch[visible] = index;
    untilScratch[visible] = until;
    visible++;
    if (d < minDepth) minDepth = d;
    if (d > maxDepth) maxDepth = d;
  };

  /** Splats j…end − 1 one by one (a leaf, or the whole scene while streaming); `until` as in untilScratch. */
  const scan = (from: number, end: number, until: number) => {
    for (let j = from; j < end; j++) {
      const x = p[j * 3], y = p[j * 3 + 1], z = p[j * 3 + 2];
      const d = dz0 * x + dz1 * y + dz2 * z + dz3; // view-space z (more negative = farther)
      if (d > -NEAR_CULL) continue; // behind the eye (also for orthographic)
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 1e-4) continue;
      const lim = cw * CULL_MARGIN;
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
      const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      const loose = cx >= -lim && cx <= lim && cy >= -lim && cy <= lim;
      if (test) {
        // reachesScreen (frustum.ts) inlined: a function call per splat costs ~25 % more sort time.
        const ax = cx < 0 ? -cx : cx, ay = cy < 0 ? -cy : cy;
        const capW = tCap * (cw + tTravel); // pastShaderLimit: also beside a moving camera
        const kx = ax * (cw - tTravel), ky = ay * (cw - tTravel);
        const inX = cw * (cw * tInner + tSlideX), inY = cw * (cw * tInner + tSlideY);
        if (ax > capW + tSlideX || ay > capW + tSlideY || ((kx > inX || ky > inY) && (kx > cw * (cw * tCap + tSlideX) || ky > cw * (cw * tCap + tSlideY) || !footprintReaches(cx, cy, cw, kx, ky, inX, inY, radii[j] * ALPHA_REACH[alphas[j]], test)))) {
          if (loose) offscreen++;
          continue;
        }
      } else if (!loose) {
        continue;
      }
      if (hideNoise && noise[j] !== 0) {
        noisy++;
        continue;
      }
      if (cut && cutSign * p[j * 3 + cutAxis] < cutHeight) {
        underground++;
        continue;
      }
      if (occ && isOccluded(occ, cx, cy, cw, radii[j] * ALPHA_REACH[alphas[j]])) {
        occluded++;
        continue;
      }
      const index = ids ? ids[j] : j;
      candidates++;
      if (keep < 1 && hash01(index) >= keep) {
        merged++;
        continue;
      }
      emit(d, index, until);
    }
  };

  /**
   * The tree, top-down: nodes off the screen, hidden or under the floor cut are skipped whole; a node whose
   * merged splat is under `px` pixels on screen is drawn as that one splat; leaves fall back to `scan`.
   * `counting` also counts what each larger merge size would draw (histogram, untilScratch, openNode): a
   * node's merged splat stands in for it from its own size on screen up to the smallest of its ancestors',
   * and its splats (or children) are drawn below that.
   */
  const walk = (t: LodTree, px: number) => {
    visible = 0; minDepth = Infinity; maxDepth = -Infinity;
    offscreen = noisy = underground = occluded = merged = candidates = opened = 0;
    if (counting) histogram.fill(0);
    const s = nodeSphere;
    let sp = 0;
    nodeStack[0] = 0;
    parentBin[0] = HIST_BINS;
    sp++;
    while (sp > 0) {
      const k = nodeStack[--sp], upBin = parentBin[sp];
      const bx = s[k * 4], by = s[k * 4 + 1], bz = s[k * 4 + 2], half = s[k * 4 + 3], maxRadius = t.maxRadius[k];
      const world = half + maxRadius * FOOTPRINT;
      const d = dz0 * bx + dz1 * by + dz2 * bz + dz3;
      if (d - world > -NEAR_CULL) continue; // all of it behind the eye
      const ahead = d + world < -NEAR_CULL;
      const leaf = t.child[k] < 0;
      if (ahead) {
        const cw = vp[3] * bx + vp[7] * by + vp[11] * bz + vp[15];
        const cx = vp[0] * bx + vp[4] * by + vp[8] * bz + vp[12];
        const cy = vp[1] * bx + vp[5] * by + vp[9] * bz + vp[13];
        if (test && !nodeReachesScreen(cx, cy, cw, half, maxRadius, test)) {
          offscreen += t.size[k];
          continue;
        }
        // Leaves skip it: a big footprint is a slow test, and `scan` tests each of their few splats anyway.
        if (occ && !leaf && nodeOccluded(occ, cx, cy, cw, half, maxRadius)) {
          occluded += t.size[k];
          continue;
        }
      }
      let straddle = false;
      if (cut) {
        const low = cutSign > 0 ? t.lo[k * 3 + cutAxis] : -t.hi[k * 3 + cutAxis];
        const high = cutSign > 0 ? t.hi[k * 3 + cutAxis] : -t.lo[k * 3 + cutAxis];
        if (high < cutHeight) {
          underground += t.size[k];
          continue;
        }
        straddle = low < cutHeight; // its merged splat would carry what the cut drops
      }
      // Size on screen of the merged splat, or Infinity when it cannot stand in for the node.
      // shortcut: merged splats include the noise splats under them, so with hide-noise on a far merged splat still
      // carries some of a giant's colour; upgrade: merge without noise splats and draw those apart while it is off.
      let size = Infinity, dm = 0;
      if (ahead && !straddle) {
        const mx = t.mean[k * 3], my = t.mean[k * 3 + 1], mz = t.mean[k * 3 + 2];
        dm = dz0 * mx + dz1 * my + dz2 * mz + dz3;
        if (dm < -NEAR_CULL) {
          // Hide-unseen off keeps the loose rule: the merged centre must be in the loose box, like a splat's.
          const cw = vp[3] * mx + vp[7] * my + vp[11] * mz + vp[15], lim = cw * CULL_MARGIN;
          const cx = vp[0] * mx + vp[4] * my + vp[8] * mz + vp[12], cy = vp[1] * mx + vp[5] * my + vp[9] * mz + vp[13];
          if (test || (cx >= -lim && cx <= lim && cy >= -lim && cy <= lim)) size = t.radius[k] * scaleOf(dm);
          if (size < px) {
            emit(dm, mergedBase + k, upBin);
            merged += t.size[k] - 1;
            if (counting) {
              histogram[0]++;
              histogram[upBin]--;
            }
            continue;
          }
        }
      }
      // Below `upBin` no ancestor is merged yet; from `bin` on, this node is.
      const bin = counting ? Math.min(binAbove(size), upBin) : HIST_BINS;
      if (bin < upBin) {
        histogram[bin]++;
        histogram[upBin]--;
        openNode[opened] = k;
        openDepth[opened] = dm;
        openFrom[opened] = bin;
        openTo[opened] = upBin;
        opened++;
      }
      if (leaf) {
        const before = visible;
        scan(t.first[k], t.first[k] + t.size[k], bin);
        if (counting) {
          histogram[0] += visible - before;
          histogram[bin] -= visible - before;
        }
      } else {
        for (let c = t.child[k]; c < t.child[k] + t.children[k]; c++) {
          nodeStack[sp] = c;
          parentBin[sp] = bin;
          sp++;
        }
      }
    }
  };

  if (!tree || (lod.minPx <= 0 && !counting)) {
    // Streaming, or nothing to merge: splat by splat is faster than walking the tree (about a third, with nothing merged).
    scan(0, n, HIST_BINS);
    if (!tree) lastCandidates = candidates;
  } else {
    // With a budget the walk starts just below last sort's merge size: walking down to a small one costs as much
    // as drawing everything.
    let px = lod.minPx;
    if (counting) px = Math.max(px, budgetPx * 0.9);
    walk(tree, px);
    if (counting && px > lod.minPx && visible < lod.budget * 0.8) {
      // Well under budget: the size it needs dropped (the camera came closer, the budget grew). Start over from the preset's.
      px = lod.minPx;
      walk(tree, px);
    }
    if (counting && visible > lod.budget) {
      // Over budget: the smallest larger merge size that fits. Keep what it still draws, add the nodes it merges.
      const first = binAbove(px);
      let count = 0, b = 0;
      for (; ; b++) {
        count += histogram[b];
        if (b === HIST_BINS - 1 || (b >= first && count <= lod.budget)) break;
      }
      px = HIST_MIN * 2 ** (b / HIST_STEPS);
      let w = 0;
      merged = 0; minDepth = Infinity; maxDepth = -Infinity;
      for (let i = 0; i < visible; i++) {
        if (untilScratch[i] <= b) continue;
        const d = depthScratch[i], index = indexScratch[i];
        depthScratch[w] = d;
        indexScratch[w++] = index;
        if (d < minDepth) minDepth = d;
        if (d > maxDepth) maxDepth = d;
        if (index >= mergedBase) merged += tree.size[index - mergedBase] - 1;
      }
      for (let j = 0; j < opened; j++) {
        if (openFrom[j] > b || openTo[j] <= b) continue;
        const d = openDepth[j], k = openNode[j];
        depthScratch[w] = d;
        indexScratch[w++] = mergedBase + k;
        if (d < minDepth) minDepth = d;
        if (d > maxDepth) maxDepth = d;
        merged += tree.size[k] - 1;
      }
      // Self-check: the walk's count for this size is exactly what the trimmed list holds.
      if (import.meta.env?.DEV && w !== count) console.error(`LOD: el presupuesto contó ${count} y quedaron ${w}`);
      visible = w;
    }
    budgetPx = counting ? px : 0;
  }

  // 16-bit counting sort, ascending view z → farthest first (back-to-front).
  bucketCounts.fill(0);
  const range = maxDepth - minDepth;
  const scale = range > 0 ? (SORT_BUCKETS - 1) / range : 0;
  for (let i = 0; i < visible; i++) {
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
  post({ type: 'sorted', order: out, visible, sortMs: performance.now() - start, lodCulled: merged, offscreen, noisy, occluded, underground }, [out.buffer]);
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
      reset();
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
