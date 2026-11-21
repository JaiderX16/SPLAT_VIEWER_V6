// `.ts` extension: the node self-check (lod.check.ts) imports this file directly.
import { decompose, quatMatrix } from './pack.ts';

/**
 * Hierarchical LOD: the splats sorted along a Morton curve (near in space, near in order) and grouped into an
 * octree. Each node also gets one merged splat that stands in for everything under it: same mass (opacity ×
 * area), mean position, colour and spread (the children's covariances plus how far apart they sit). Far away,
 * where a node's merged splat is under a pixel or two, the sort draws it instead of its splats; nodes off the
 * screen or behind an occluder are skipped whole.
 */

/** A leaf holds at most this many splats. Smaller leaves merge more finely, at one merged splat per leaf. */
export const LEAF_SPLATS = 16;
/** Merged opacity is capped below 1, like a single splat. */
const MAX_ALPHA = 0.99;

export interface LodTree {
  nodes: number;
  /** Morton position → original splat index. */
  perm: Uint32Array;
  /** First splat (in Morton order) and number of splats under each node. */
  first: Uint32Array;
  size: Uint32Array;
  /** First child (children are consecutive), −1 for a leaf; and how many. */
  child: Int32Array;
  children: Uint8Array;
  /** Box of the centres of the splats under the node (3 each) and their largest radius. */
  lo: Float32Array;
  hi: Float32Array;
  maxRadius: Float32Array;
  /** The merged splat: centre (3 each), radius (√ largest diagonal of Σ), and its GPU data. */
  mean: Float32Array;
  radius: Float32Array;
  scales: Float32Array;
  quats: Uint32Array;
  colors: Uint32Array;
}

/** Interleaves the low 10 bits of v with two zero bits between each. */
function spread(v: number) {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  v = (v | (v << 2)) & 0x09249249;
  return v;
}

/**
 * Builds the tree over `count` splats: positions and scales (3 each), quaternion bytes, rgba and radius per
 * splat. `origin`/`size`: the box the Morton grid spans (splats outside are clamped to its edge).
 */
export function buildLod(
  positions: Float32Array, scales: Float32Array, quats: Uint32Array, colors: Uint32Array, radii: Float32Array, count: number,
  origin: readonly number[], size: readonly number[],
): LodTree {
  // Morton keys, then an LSD radix sort (3 passes of 10 bits) of the splat indices by key.
  let keys = new Uint32Array(count), perm = new Uint32Array(count);
  const cell = (i: number, a: number) => Math.min(1023, Math.max(0, Math.floor(((positions[i * 3 + a] - origin[a]) / size[a]) * 1024)));
  for (let i = 0; i < count; i++) {
    keys[i] = (spread(cell(i, 0)) | (spread(cell(i, 1)) << 1) | (spread(cell(i, 2)) << 2)) >>> 0;
    perm[i] = i;
  }
  let keys2 = new Uint32Array(count), perm2 = new Uint32Array(count);
  const counts = new Uint32Array(1024);
  for (let shift = 0; shift < 30; shift += 10) {
    counts.fill(0);
    for (let i = 0; i < count; i++) counts[(keys[i] >>> shift) & 1023]++;
    for (let d = 0, sum = 0; d < 1024; d++) {
      const c = counts[d];
      counts[d] = sum;
      sum += c;
    }
    for (let i = 0; i < count; i++) {
      const at = counts[(keys[i] >>> shift) & 1023]++;
      keys2[at] = keys[i];
      perm2[at] = perm[i];
    }
    [keys, keys2, perm, perm2] = [keys2, keys, perm2, perm];
  }

  // Octree, top-down: a node splits by the next 3 key bits; levels where everything shares the digit are skipped.
  const first: number[] = [0], sizes: number[] = [count], child: number[] = [-1], children: number[] = [0];
  const digit = (key: number, level: number) => (key >>> (27 - 3 * level)) & 7;
  const stack: number[] = [0, 0]; // node, level
  while (stack.length) {
    let level = stack.pop()!;
    const k = stack.pop()!;
    const a = first[k], b = a + sizes[k];
    if (b - a <= LEAF_SPLATS) continue;
    while (level < 10 && digit(keys[a], level) === digit(keys[b - 1], level)) level++;
    if (level >= 10) continue; // identical cells: one (big) leaf
    child[k] = first.length;
    for (let lo = a; lo < b;) {
      const dg = digit(keys[lo], level);
      let hi = lo + 1;
      while (hi < b && digit(keys[hi], level) === dg) hi++;
      first.push(lo);
      sizes.push(hi - lo);
      child.push(-1);
      children.push(0);
      children[k]++;
      stack.push(first.length - 1, level + 1);
      lo = hi;
    }
  }

  const nodes = first.length;
  const tree: LodTree = {
    nodes, perm,
    first: Uint32Array.from(first), size: Uint32Array.from(sizes), child: Int32Array.from(child), children: Uint8Array.from(children),
    lo: new Float32Array(nodes * 3), hi: new Float32Array(nodes * 3), maxRadius: new Float32Array(nodes),
    mean: new Float32Array(nodes * 3), radius: new Float32Array(nodes),
    scales: new Float32Array(nodes * 3), quats: new Uint32Array(nodes), colors: new Uint32Array(nodes),
  };

  // Merge bottom-up (children come after their parent): mass = opacity × mean area. The merged splat keeps the
  // mass; its centre, colour and second moment are mass-weighted, taken about a reference point (the first
  // item) so a tiny spread far from the origin keeps its precision.
  const mass = new Float64Array(nodes), cov = new Float64Array(nodes * 6), rgb = new Float64Array(nodes * 3);
  const r = new Float64Array(9), acc = new Float64Array(6), col = new Float64Array(3);
  let m = 0, ox = 0, oy = 0, oz = 0, refX = 0, refY = 0, refZ = 0;
  const add = (w: number, x: number, y: number, z: number, c00: number, c01: number, c02: number, c11: number, c12: number, c22: number, cr: number, cg: number, cb: number) => {
    if (m === 0) [refX, refY, refZ] = [x, y, z];
    const dx = x - refX, dy = y - refY, dz = z - refZ;
    m += w;
    ox += w * dx; oy += w * dy; oz += w * dz;
    acc[0] += w * (c00 + dx * dx); acc[1] += w * (c01 + dx * dy); acc[2] += w * (c02 + dx * dz);
    acc[3] += w * (c11 + dy * dy); acc[4] += w * (c12 + dy * dz); acc[5] += w * (c22 + dz * dz);
    col[0] += w * cr; col[1] += w * cg; col[2] += w * cb;
  };
  for (let k = nodes - 1; k >= 0; k--) {
    m = ox = oy = oz = 0;
    acc.fill(0);
    col.fill(0);
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity, maxR = 0;
    if (tree.child[k] < 0) {
      for (let j = tree.first[k]; j < tree.first[k] + tree.size[k]; j++) {
        const i = perm[j];
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        const sx = scales[i * 3] ** 2, sy = scales[i * 3 + 1] ** 2, sz = scales[i * 3 + 2] ** 2;
        quatMatrix(quats[i], r);
        const c = colors[i];
        add(
          ((c >>> 24) / 255) * Math.PI * Math.sqrt(sx * sy + sx * sz + sy * sz), x, y, z,
          r[0] * r[0] * sx + r[1] * r[1] * sy + r[2] * r[2] * sz, r[0] * r[3] * sx + r[1] * r[4] * sy + r[2] * r[5] * sz,
          r[0] * r[6] * sx + r[1] * r[7] * sy + r[2] * r[8] * sz, r[3] * r[3] * sx + r[4] * r[4] * sy + r[5] * r[5] * sz,
          r[3] * r[6] * sx + r[4] * r[7] * sy + r[5] * r[8] * sz, r[6] * r[6] * sx + r[7] * r[7] * sy + r[8] * r[8] * sz,
          c & 255, (c >>> 8) & 255, (c >>> 16) & 255,
        );
        lx = Math.min(lx, x); ly = Math.min(ly, y); lz = Math.min(lz, z);
        hx = Math.max(hx, x); hy = Math.max(hy, y); hz = Math.max(hz, z);
        maxR = Math.max(maxR, radii[i]);
      }
    } else {
      for (let c = tree.child[k]; c < tree.child[k] + tree.children[k]; c++) {
        add(
          mass[c], tree.mean[c * 3], tree.mean[c * 3 + 1], tree.mean[c * 3 + 2],
          cov[c * 6], cov[c * 6 + 1], cov[c * 6 + 2], cov[c * 6 + 3], cov[c * 6 + 4], cov[c * 6 + 5],
          rgb[c * 3], rgb[c * 3 + 1], rgb[c * 3 + 2],
        );
        lx = Math.min(lx, tree.lo[c * 3]); ly = Math.min(ly, tree.lo[c * 3 + 1]); lz = Math.min(lz, tree.lo[c * 3 + 2]);
        hx = Math.max(hx, tree.hi[c * 3]); hy = Math.max(hy, tree.hi[c * 3 + 1]); hz = Math.max(hz, tree.hi[c * 3 + 2]);
        maxR = Math.max(maxR, tree.maxRadius[c]);
      }
    }
    m = Math.max(m, 1e-30);
    const mx = ox / m, my = oy / m, mz = oz / m;
    const s0 = acc[0] / m - mx * mx, s1 = acc[1] / m - mx * my, s2 = acc[2] / m - mx * mz;
    const s3 = acc[3] / m - my * my, s4 = acc[4] / m - my * mz, s5 = acc[5] / m - mz * mz;
    cov[k * 6] = s0; cov[k * 6 + 1] = s1; cov[k * 6 + 2] = s2; cov[k * 6 + 3] = s3; cov[k * 6 + 4] = s4; cov[k * 6 + 5] = s5;
    // Mean area of the merged Gaussian: π √(sum of Σ's principal 2×2 minors), as for one splat.
    const area = Math.PI * Math.sqrt(Math.max(s0 * s3 - s1 * s1 + s0 * s5 - s2 * s2 + s3 * s5 - s4 * s4, 1e-60));
    const alpha = Math.min(MAX_ALPHA, m / area);
    mass[k] = alpha * area; // what overlap already lost stays lost
    rgb[k * 3] = col[0] / m; rgb[k * 3 + 1] = col[1] / m; rgb[k * 3 + 2] = col[2] / m;
    tree.mean[k * 3] = refX + mx; tree.mean[k * 3 + 1] = refY + my; tree.mean[k * 3 + 2] = refZ + mz;
    tree.radius[k] = Math.sqrt(Math.max(s0, s3, s5));
    tree.quats[k] = decompose(s0, s1, s2, s3, s4, s5, tree.scales, k * 3);
    tree.colors[k] = (Math.round(rgb[k * 3]) | (Math.round(rgb[k * 3 + 1]) << 8) | (Math.round(rgb[k * 3 + 2]) << 16) | (Math.round(alpha * 255) << 24)) >>> 0;
    tree.lo[k * 3] = lx; tree.lo[k * 3 + 1] = ly; tree.lo[k * 3 + 2] = lz;
    tree.hi[k * 3] = hx; tree.hi[k * 3 + 1] = hy; tree.hi[k * 3 + 2] = hz;
    tree.maxRadius[k] = maxR;
  }
  return tree;
}
