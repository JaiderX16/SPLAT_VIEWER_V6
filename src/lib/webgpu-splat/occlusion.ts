import type { Vec3 } from './math';
// `.ts` extension: the node self-check (occlusion.check.ts) imports this file directly.
import { FOOTPRINT } from './frustum.ts';

/**
 * Occlusion culling: draw only the first layer the camera sees. A wall hides the room behind it, so the
 * splats back there are neither sorted nor drawn.
 *
 * Splats are semi-transparent, so "hidden" means that almost no light from behind gets through
 * (e^-STOP_TAU). The worker estimates that from the scene's own opacity on a voxel grid (the collision
 * grid's cells): each voxel holds the optical depth its splats add to a ray crossing it. Every sort, rays
 * from the eye through the corners of a coarse screen grid of tiles march the voxels until the light left
 * runs out; the farthest of a tile's four corners, plus a margin for the blocking surface's own splats, is
 * that tile's occluder depth. A splat is hidden when its centre (less FRONT_RADII) lies beyond the occluder of
 * every tile its footprint touches: splats are drawn in the order of their centres' depth, so the layer in
 * front is painted over all of it, however far its blur reaches. Rays that leave the scene hide nothing.
 */

/** Voxel optical depth is stored × DENSITY_SCALE in a byte (saturates at 16: opaque). */
const DENSITY_SCALE = 16;
/**
 * The grid sees about a quarter of the real opacity: a wall faces the camera (twice the mean area) and its
 * splats spill into the neighbouring voxels. 4 is the highest gain with no visible change on the reference
 * scan (exact renderer, docs/occlusion-culling-plan.md); 8 already eats into surfaces seen up close.
 */
const OPACITY_GAIN = 4;
/**
 * Splats wider than a voxel (the blurry shell a scan has outside, seen from orbit) spread their opacity over
 * the voxels around them, up to this many each way: kept in their own voxel, a shell of them is mostly gaps.
 * Spread without OPACITY_GAIN: a ray straight through picks up about α, never more than the splat gives.
 */
const SPREAD_VOXELS = 2;
/** A ray is blocked once the light left falls under e^-STOP_TAU (1/255: below one colour step). */
const STOP_TAU = Math.log(255);
/** Screen tiles of the occluder map (about square in pixels); rays go through their corners. */
const TILES = 2048;
/** Occluders nearer to the eye than this many voxels are ignored: part of their splats lie behind it. */
const NEAR_SKIP_VOXELS = 1.5;
/**
 * Kept past where a ray runs out of light: the blocking surface's own splats, whose centres sit in the voxels
 * the ray crossed (or up to SPREAD_VOXELS away for wide ones) and must stay in front of whatever it hides.
 */
const DEPTH_MARGIN_VOXELS = 3.5;
/**
 * A splat counts as lying this many radii in front of its centre. Splats are drawn in the order of their
 * centres' depth, so an opaque layer in front is painted over all of a splat however far its blur reaches
 * (a noise blob under the floor seen from above). But the wide splats that make up a blurry layer (a scan's
 * outer shell) spread opacity well past the voxels the grid gives them: judged by their very centre, parts
 * of that layer go. 2 (with DEPTH_MARGIN_VOXELS 3.5) is the least with no visible change on the reference scan;
 * the nearest point (FOOTPRINT, 4.9 radii) kept every large blob under a floor. While the camera moves the
 * nearest point is used: a blurry layer seen from a new angle can open gaps the grid does not know about.
 */
const FRONT_RADII = 2;
/** Footprints are tested cell by cell on the finest pyramid level where they span at most this many cells. */
const MAX_FOOTPRINT_CELLS = 64;
/**
 * The grid draws an object up to a voxel fatter than it is (a voxel is solid wherever its splats sit inside
 * it), so near an occluder's edge the background beside it would go. Each tile takes the farthest occluder
 * within this many voxels sideways, projected at the tile's depth (plus the camera travel). Without it a
 * pedestal two voxels wide, seen up close, bit into the trees beside it (1,4 % of pixels, up to 153/255).
 */
const ERODE_VOXELS = 1;

export interface OcclusionGrid {
  origin: Vec3;
  voxel: number;
  dims: Vec3;
  /** Optical depth a ray picks up crossing one voxel, × DENSITY_SCALE; index (z · ny + y) · nx + x. */
  density: Uint8Array;
}

/** Per-voxel optical depth cap of one splat: what a ray straight through its centre picks up, −ln(1 − α). */
const CENTRE_TAU = Float32Array.from({ length: 256 }, (_, a) => -Math.log(1 - Math.min(a, 254) / 255));

/**
 * Mean screen area of a splat's Gaussian over all view directions, in world units² per unit peak
 * opacity: π·√(sum of Σ's principal 2×2 minors). Exact for flat splats (π·s1·s2), 13 % low for round
 * ones (hides less, never more).
 */
export function splatArea(c00: number, c01: number, c02: number, c11: number, c12: number, c22: number) {
  const minors = c00 * c11 - c01 * c01 + c00 * c22 - c02 * c02 + c11 * c22 - c12 * c12;
  return Math.PI * Math.sqrt(Math.max(minors, 0));
}

/**
 * Optical depth of each voxel of `bounds` from the splats in it: a small splat adds α × its mean area /
 * voxel² (× OPACITY_GAIN) to its own voxel; one wider than a voxel spreads α × area over the cube of voxels
 * it covers (SPREAD_VOXELS). Neither adds more to a voxel than a ray through the splat's centre picks up.
 */
export function buildOcclusionGrid(
  bounds: { origin: Vec3; voxel: number; dims: Vec3 },
  positions: Float32Array,
  alphas: Uint8Array,
  areas: Float32Array,
  count: number,
): OcclusionGrid {
  const { origin, voxel, dims } = bounds;
  const [nx, ny, nz] = dims;
  // Accumulated in 1/256 steps (faint splats add up), stored in 1/DENSITY_SCALE.
  const acc = new Uint16Array(nx * ny * nz);
  const perArea = (OPACITY_GAIN * 256) / (voxel * voxel);
  for (let i = 0; i < count; i++) {
    const x = Math.floor((positions[i * 3] - origin[0]) / voxel);
    const y = Math.floor((positions[i * 3 + 1] - origin[1]) / voxel);
    const z = Math.floor((positions[i * 3 + 2] - origin[2]) / voxel);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    const a = alphas[i];
    // Half-size of the cube it covers, from its mean radius √(area / π).
    const h = Math.min(SPREAD_VOXELS, Math.floor(Math.sqrt(areas[i] / Math.PI) / voxel));
    if (h === 0) {
      const k = (z * ny + y) * nx + x;
      acc[k] = Math.min(65535, acc[k] + Math.min((a / 255) * areas[i] * perArea, CENTRE_TAU[a] * 256));
      continue;
    }
    const side = 2 * h + 1;
    const share = Math.min(((a / 255) * areas[i] * perArea) / (OPACITY_GAIN * side * side * side), CENTRE_TAU[a] * 256);
    for (let zz = Math.max(0, z - h); zz <= Math.min(nz - 1, z + h); zz++) {
      for (let yy = Math.max(0, y - h); yy <= Math.min(ny - 1, y + h); yy++) {
        for (let xx = Math.max(0, x - h); xx <= Math.min(nx - 1, x + h); xx++) {
          const k = (zz * ny + yy) * nx + xx;
          acc[k] = Math.min(65535, acc[k] + share);
        }
      }
    }
  }
  const density = new Uint8Array(acc.length);
  for (let k = 0; k < acc.length; k++) density[k] = Math.min(255, Math.round(acc[k] / (256 / DENSITY_SCALE)));
  return { origin, voxel, dims, density };
}

export interface OcclusionMap {
  tw: number;
  th: number;
  /**
   * Max pyramid of the tiles' occluder depths (beyond it a splat centre is hidden; Infinity: nothing is):
   * level 0 is the tiles, each next level's cells the farthest of 2 × 2 (Infinity past the edge).
   */
  levels: { w: number; h: number; cells: Float32Array }[];
  /**
   * Per tile corner ((tw + 1) × (th + 1)): the farthest occluder of the four tiles around it, Infinity on the
   * border. A footprint under half a tile stays within the four tiles around its nearest corner: one look-up.
   */
  quad: Float32Array;
  /** Smallest cull depth: nearer splats are never hidden. */
  nearest: number;
  /** Tile coordinates of a clip position: clip / w · scale + offset. */
  tileScaleX: number;
  tileScaleY: number;
  tileOffsetX: number;
  tileOffsetY: number;
  /** Footprint half-size in tiles per unit of world radius / view depth, without the off-axis stretch. */
  reachX: number;
  reachY: number;
  /** Radii in front of its centre a splat is taken to start (FRONT_RADII still, FOOTPRINT while moving). */
  front: number;
  /** proj[0], proj[5]; and the largest off-axis stretch on the map (at its corners). */
  scaleX: number;
  scaleY: number;
  stretch: number;
}

/**
 * Occluder depth of each screen tile. `view`: column-major view matrix; `scaleX`/`scaleY`: proj[0]/proj[5]
 * (perspective only); `extent`: NDC half-size to cover (the screen plus the frustum margin); `travel`:
 * world distance the camera may move before the next sort replaces the list. Moving sideways slides a
 * near occluder over what is behind it by up to travel·scale / depth, so each tile takes the farthest
 * occluder within that reach (and within ERODE_VOXELS).
 */
export function occlusionMap(grid: OcclusionGrid, view: Float32Array, scaleX: number, scaleY: number, extent: number, travel: number): OcclusionMap {
  const aspect = scaleY / scaleX; // width / height
  const tw = Math.max(4, Math.round(Math.sqrt(TILES * aspect)));
  const th = Math.max(4, Math.round(TILES / tw));
  const eye: Vec3 = [
    -(view[0] * view[12] + view[1] * view[13] + view[2] * view[14]),
    -(view[4] * view[12] + view[5] * view[13] + view[6] * view[14]),
    -(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]),
  ];
  // Corner rays: dir = right·x/scaleX + up·y/scaleY + forward, so a ray's parameter is its view depth.
  const corners = new Float32Array((tw + 1) * (th + 1));
  const stop = STOP_TAU * DENSITY_SCALE * grid.voxel;
  const skip = NEAR_SKIP_VOXELS * grid.voxel;
  for (let j = 0; j <= th; j++) {
    const y = (-extent + (2 * extent * j) / th) / scaleY;
    for (let i = 0; i <= tw; i++) {
      const x = (-extent + (2 * extent * i) / tw) / scaleX;
      corners[j * (tw + 1) + i] = march(
        grid, eye,
        view[0] * x + view[1] * y - view[2],
        view[4] * x + view[5] * y - view[6],
        view[8] * x + view[9] * y - view[10],
        stop, skip,
      );
    }
  }
  const depth = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const c = j * (tw + 1) + i;
      depth[j * tw + i] = Math.max(corners[c], corners[c + 1], corners[c + tw + 1], corners[c + tw + 2]);
    }
  }
  // Each tile takes the farthest occluder within the edge's uncertainty sideways: the grid's own voxel plus
  // how far the camera may move. Tiles per world unit sideways at depth 1:
  const sideways = (travel + ERODE_VOXELS * grid.voxel) * (Math.max(scaleX * tw, scaleY * th) / (2 * extent));
  const raw = maxPyramid(depth, tw, th);
  const cull = new Float32Array(tw * th);
  const margin = DEPTH_MARGIN_VOXELS * grid.voxel;
  let nearest = Infinity;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      let d = depth[j * tw + i];
      if (d !== Infinity) {
        const r = Math.ceil(sideways / d);
        d = farthest(raw, i - r, i + r, j - r, j + r);
      }
      cull[j * tw + i] = d + margin;
      if (d + margin < nearest) nearest = d + margin;
    }
  }
  const quad = new Float32Array((tw + 1) * (th + 1)).fill(Infinity);
  for (let j = 1; j < th; j++) {
    for (let i = 1; i < tw; i++) {
      const t = j * tw + i;
      quad[j * (tw + 1) + i] = Math.max(cull[t - tw - 1], cull[t - tw], cull[t - 1], cull[t]);
    }
  }
  const levels = maxPyramid(cull, tw, th);
  const tileScaleX = tw / (2 * extent), tileScaleY = th / (2 * extent);
  return {
    tw, th, levels, quad, nearest, front: travel > 0 ? FOOTPRINT : FRONT_RADII,
    tileScaleX, tileScaleY, tileOffsetX: extent * tileScaleX, tileOffsetY: extent * tileScaleY,
    reachX: FOOTPRINT * scaleX * tileScaleX, reachY: FOOTPRINT * scaleY * tileScaleY,
    // Off-axis the projection stretches footprints by √(1 + tan²x + tan²y), most at the corners.
    scaleX, scaleY, stretch: Math.sqrt(1 + (extent / scaleX) ** 2 + (extent / scaleY) ** 2),
  };
}

/**
 * Whether a splat is hidden: clip position (`cx`, `cy`, `cw`, perspective so `cw` is its view depth) and
 * world radius as in the sort worker. Its centre (less FRONT_RADII) is tested against the occluders of every tile
 * its footprint touches: one look-up under half a tile, otherwise on the pyramid (`farthest`).
 */
export function isOccluded(map: OcclusionMap, cx: number, cy: number, cw: number, radius: number) {
  const depth = cw - radius * map.front;
  if (depth <= map.nearest) return false;
  const inv = 1 / cw;
  const nx = cx * inv, ny = cy * inv;
  const fx = nx * map.tileScaleX + map.tileOffsetX, fy = ny * map.tileScaleY + map.tileOffsetY;
  // Small splats take the largest stretch (no square root); big ones their own.
  let reach = radius * inv * map.stretch;
  if (reach * map.reachX <= 0.5 && reach * map.reachY <= 0.5) {
    const { tw, th } = map;
    return fx >= 0 && fy >= 0 && fx < tw && fy < th && depth > map.quad[((fy + 0.5) | 0) * (tw + 1) + ((fx + 0.5) | 0)];
  }
  const tx = nx / map.scaleX, ty = ny / map.scaleY;
  reach = radius * inv * Math.sqrt(1 + tx * tx + ty * ty);
  const ux = reach * map.reachX, uy = reach * map.reachY;
  return depth > farthest(map.levels, Math.floor(fx - ux), Math.floor(fx + ux), Math.floor(fy - uy), Math.floor(fy + uy));
}

/** Max pyramid: level 0 is `cells` (w × h), each next level's cells the farthest of 2 × 2 (Infinity past the edge). */
function maxPyramid(cells: Float32Array, w: number, h: number) {
  const levels: OcclusionMap['levels'] = [];
  for (;;) {
    levels.push({ w, h, cells });
    if (w <= 2 && h <= 2) return levels;
    const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
    const next = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) {
      for (let i = 0; i < nw; i++) {
        const x = 2 * i, y = 2 * j;
        next[j * nw + i] = x + 1 < w && y + 1 < h
          ? Math.max(cells[y * w + x], cells[y * w + x + 1], cells[(y + 1) * w + x], cells[(y + 1) * w + x + 1])
          : Infinity;
      }
    }
    cells = next;
    w = nw;
    h = nh;
  }
}

/**
 * The farthest value over tiles [x0, x1] × [y0, y1] (Infinity if any lies off the map), cell by cell on the
 * finest pyramid level where the rectangle spans at most MAX_FOOTPRINT_CELLS cells: a coarser level only
 * widens it by its cells.
 */
function farthest(levels: OcclusionMap['levels'], x0: number, x1: number, y0: number, y1: number) {
  if (x0 < 0 || y0 < 0 || x1 >= levels[0].w || y1 >= levels[0].h) return Infinity;
  for (const { w, cells } of levels) {
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_FOOTPRINT_CELLS) {
      let d = 0;
      for (let v = y0; v <= y1; v++) {
        for (let u = x0; u <= x1; u++) d = Math.max(d, cells[v * w + u]);
      }
      return d;
    }
    x0 >>= 1;
    x1 >>= 1;
    y0 >>= 1;
    y1 >>= 1;
  }
  return Infinity;
}

/**
 * Depth along (dx, dy, dz) from `eye` at which the light left falls under e^-STOP_TAU (in units of the
 * direction's length: its view depth), or Infinity if the ray leaves the grid first.
 */
function march(grid: OcclusionGrid, eye: Vec3, dx: number, dy: number, dz: number, stop: number, skip: number) {
  const { origin: o, voxel: v, dims, density } = grid;
  const [nx, ny, nz] = dims;
  const d = [dx, dy, dz];
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = o[a], hi = o[a] + dims[a] * v;
    if (Math.abs(d[a]) < 1e-12) {
      if (eye[a] < lo || eye[a] > hi) return Infinity;
      continue;
    }
    const ta = (lo - eye[a]) / d[a], tb = (hi - eye[a]) / d[a];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t0 >= t1) return Infinity;
  const len = Math.hypot(dx, dy, dz);
  const cell = (a: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((eye[a] + d[a] * t0 - o[a]) / v)));
  let x = cell(0, nx), y = cell(1, ny), z = cell(2, nz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0, stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0, stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  let nextX = stepX === 0 ? Infinity : (o[0] + (x + (stepX > 0 ? 1 : 0)) * v - eye[0]) / dx;
  let nextY = stepY === 0 ? Infinity : (o[1] + (y + (stepY > 0 ? 1 : 0)) * v - eye[1]) / dy;
  let nextZ = stepZ === 0 ? Infinity : (o[2] + (z + (stepZ > 0 ? 1 : 0)) * v - eye[2]) / dz;
  const deltaX = v / Math.abs(dx), deltaY = v / Math.abs(dy), deltaZ = v / Math.abs(dz);
  let t = t0;
  let acc = 0;
  for (;;) {
    const end = Math.min(nextX, nextY, nextZ, t1);
    const dens = density[(z * ny + y) * nx + x];
    if (dens !== 0 && t * len >= skip) {
      acc += dens * (end - t) * len;
      if (acc >= stop) return end;
    }
    if (end >= t1) return Infinity;
    t = end;
    if (nextX <= nextY && nextX <= nextZ) {
      x += stepX;
      if (x < 0 || x >= nx) return Infinity;
      nextX += deltaX;
    } else if (nextY <= nextZ) {
      y += stepY;
      if (y < 0 || y >= ny) return Infinity;
      nextY += deltaY;
    } else {
      z += stepZ;
      if (z < 0 || z >= nz) return Infinity;
      nextZ += deltaZ;
    }
  }
}
