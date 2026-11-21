/**
 * GPU layout of one splat: 5 × u32 = 20 bytes (32 before), read as `array<u32>` in splat.wgsl.
 *   [0] x u16 | y u16 << 16   position, quantized in the box of its block of BLOCK_SPLATS splats
 *   [1] z u16 | σx f16 << 16  axis scales (1σ, × SCALE_PACK) as half floats
 *   [2] σy f16 | σz f16 << 16
 *   [3] rgba8                  (r in the low byte → `unpack4x8unorm`)
 *   [4] rotation quaternion w, x, y, z as bytes ((b − 128) / 128, normalized): the `.splat` file's own bytes
 * Each block has its box in a separate `vec4f` pair: min, extent. A block's box is usually most of the scene
 * (files are not ordered by place): 16 bits over 25 m is 0.4 mm.
 */
export const SPLAT_WORDS = 5;
export const SPLAT_BYTES = SPLAT_WORDS * 4;
export const BLOCK_SPLATS = 256;
/** Floats per block in the box table (min xyz, 0, extent xyz, 0). */
export const BLOCK_FLOATS = 8;
/** Scales are stored × this, so tiny splats stay clear of the half-float subnormals and 1000-unit ones fit. */
export const SCALE_PACK = 64;

const f32Scratch = new Float32Array(1);
const i32Scratch = new Int32Array(f32Scratch.buffer);

export function toHalf(value: number): number {
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

export function fromHalf(h: number): number {
  const exp = (h >> 10) & 0x1f, frac = h & 0x3ff, sign = h & 0x8000 ? -1 : 1;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** Quaternion component in [−1, 1] → byte, as `.splat` stores it. */
const quatByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 128 + 128)));

/** Quaternion bytes (w in the low byte) of a rotation matrix (row-major, columns = rotated axes). */
export function quatBytes(r: ArrayLike<number>) {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]];
  let w, x, y, z;
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    [w, x, y, z] = [0.25 / s, (r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s];
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    [w, x, y, z] = [(r21 - r12) / s, 0.25 * s, (r01 + r10) / s, (r02 + r20) / s];
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    [w, x, y, z] = [(r02 - r20) / s, (r01 + r10) / s, 0.25 * s, (r12 + r21) / s];
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    [w, x, y, z] = [(r10 - r01) / s, (r02 + r20) / s, (r12 + r21) / s, 0.25 * s];
  }
  return (quatByte(w) | (quatByte(x) << 8) | (quatByte(y) << 16) | (quatByte(z) << 24)) >>> 0;
}

/** Rotation matrix (row-major) of quaternion bytes, normalized: what the shader builds. */
export function quatMatrix(bytes: number, out: Float64Array) {
  let w = ((bytes & 255) - 128) / 128, x = (((bytes >>> 8) & 255) - 128) / 128;
  let y = (((bytes >>> 16) & 255) - 128) / 128, z = ((bytes >>> 24) - 128) / 128;
  const l = Math.sqrt(w * w + x * x + y * y + z * z) || 1; // not Math.hypot: called per splat, and hypot is slow
  w /= l; x /= l; y /= l; z /= l;
  out[0] = 1 - 2 * (y * y + z * z); out[1] = 2 * (x * y - w * z); out[2] = 2 * (x * z + w * y);
  out[3] = 2 * (x * y + w * z); out[4] = 1 - 2 * (x * x + z * z); out[5] = 2 * (y * z - w * x);
  out[6] = 2 * (x * z - w * y); out[7] = 2 * (y * z + w * x); out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

/**
 * Scales (√ eigenvalues) and rotation (quaternion bytes) of a covariance Σ = R S² Rᵀ, by cyclic Jacobi:
 * a scene transform with a non-uniform scale, or a merged LOD splat, ends up as a plain covariance.
 * Writes σx, σy, σz into `scales` at `at` and returns the quaternion bytes.
 */
export function decompose(c00: number, c01: number, c02: number, c11: number, c12: number, c22: number, scales: Float32Array, at: number) {
  const a = [c00, c01, c02, c01, c11, c12, c02, c12, c22];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 16; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off <= 1e-24 * (a[0] * a[0] + a[4] * a[4] + a[8] * a[8])) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (apq === 0) continue;
      const tau = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(tau * tau + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = a[k * 3 + p], kq = a[k * 3 + q];
        a[k * 3 + p] = c * kp - s * kq;
        a[k * 3 + q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = a[p * 3 + k], qk = a[q * 3 + k];
        a[p * 3 + k] = c * pk - s * qk;
        a[q * 3 + k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[k * 3 + p], kq = v[k * 3 + q];
        v[k * 3 + p] = c * kp - s * kq;
        v[k * 3 + q] = s * kp + c * kq;
      }
    }
  }
  // A rotation, not a reflection: flip the last axis if needed (the Gaussian is symmetric).
  const det = v[0] * (v[4] * v[8] - v[5] * v[7]) - v[1] * (v[3] * v[8] - v[5] * v[6]) + v[2] * (v[3] * v[7] - v[4] * v[6]);
  if (det < 0) for (let k = 0; k < 3; k++) v[k * 3 + 2] = -v[k * 3 + 2];
  scales[at] = Math.sqrt(Math.max(a[0], 0));
  scales[at + 1] = Math.sqrt(Math.max(a[4], 0));
  scales[at + 2] = Math.sqrt(Math.max(a[8], 0));
  return quatBytes(v);
}

/**
 * Packs splats `src`…`src + count` of the given per-splat arrays (positions and scales 3 each, quaternion
 * bytes, rgba) as one block: words at word offset `w` of `words`, its box at float offset `b` of `boxes`.
 */
export function packBlock(
  positions: Float32Array, scales: Float32Array, quats: Uint32Array, colors: Uint32Array, src: number, count: number,
  words: Uint32Array, w: number, boxes: Float32Array, b: number,
) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = src; i < src + count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  const step = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const ext = hi[a] - lo[a];
    boxes[b + a] = lo[a];
    boxes[b + 4 + a] = ext;
    step[a] = ext > 0 ? 65535 / ext : 0;
  }
  boxes[b + 3] = boxes[b + 7] = 0;
  for (let i = src; i < src + count; i++, w += SPLAT_WORDS) {
    const qx = Math.round((positions[i * 3] - lo[0]) * step[0]);
    const qy = Math.round((positions[i * 3 + 1] - lo[1]) * step[1]);
    const qz = Math.round((positions[i * 3 + 2] - lo[2]) * step[2]);
    words[w] = (qx | (qy << 16)) >>> 0;
    words[w + 1] = (qz | (toHalf(scales[i * 3] * SCALE_PACK) << 16)) >>> 0;
    words[w + 2] = (toHalf(scales[i * 3 + 1] * SCALE_PACK) | (toHalf(scales[i * 3 + 2] * SCALE_PACK) << 16)) >>> 0;
    words[w + 3] = colors[i];
    words[w + 4] = quats[i];
  }
}

/** Decodes splat `k` of a block (what splat.wgsl does): position, scales, quaternion bytes, rgba. */
export function unpackSplat(words: Uint32Array, w: number, boxes: Float32Array, b: number) {
  const pos = [0, 1, 2].map((a) => boxes[b + a] + (boxes[b + 4 + a] * [words[w] & 0xffff, words[w] >>> 16, words[w + 1] & 0xffff][a]) / 65535);
  const scales = [words[w + 1] >>> 16, words[w + 2] & 0xffff, words[w + 2] >>> 16].map((h) => fromHalf(h) / SCALE_PACK);
  return { pos, scales, quat: words[w + 4], rgba: words[w + 3] };
}
