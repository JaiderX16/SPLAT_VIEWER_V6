/** Minimal column-major mat4 / vec3 helpers (WebGPU clip space: z ∈ [0, 1]). */
export type Vec3 = [number, number, number];

export const vec3 = {
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export function lookAt(eye: Vec3, target: Vec3, up: Vec3, out: Float32Array): Float32Array {
  const z = vec3.normalize(vec3.sub(eye, target));
  let x = vec3.cross(up, z);
  if (vec3.length(x) < 1e-6) x = vec3.cross([0, 0, 1], z);
  x = vec3.normalize(x);
  const y = vec3.cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -vec3.dot(x, eye);
  out[13] = -vec3.dot(y, eye);
  out[14] = -vec3.dot(z, eye);
  out[15] = 1;
  return out;
}

export function perspective(fovYRad: number, aspect: number, near: number, far: number, out: Float32Array) {
  const f = 1 / Math.tan(fovYRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

export function orthographic(halfHeight: number, aspect: number, near: number, far: number, out: Float32Array) {
  const halfWidth = halfHeight * aspect;
  out.fill(0);
  out[0] = 1 / halfWidth;
  out[5] = 1 / halfHeight;
  out[10] = 1 / (near - far);
  out[14] = near / (near - far);
  out[15] = 1;
  return out;
}

export function multiply(a: Float32Array, b: Float32Array, out: Float32Array) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
  /** Pick-cone half-angle tangent for a few pixels of tolerance (0 for orthographic). */
  coneTan: number;
  /** Constant pick-cone radius in world units (orthographic). */
  coneRadius: number;
  /** Ignore hits closer than this (picks default to the render near cull). */
  near?: number;
}

/**
 * World-space ray through normalized device coordinates (x right, y up, ±1)
 * of a camera described by its view matrix (as built by `lookAt`).
 * `halfHeight` is tan(fov/2) for perspective, or the half height in world
 * units for orthographic. `pickPx` / `heightPx` size the pick tolerance.
 */
export function cameraRay(
  view: Float32Array,
  ndcX: number,
  ndcY: number,
  aspect: number,
  halfHeight: number,
  ortho: boolean,
  pickPx: number,
  heightPx: number,
): Ray {
  const right: Vec3 = [view[0], view[4], view[8]];
  const up: Vec3 = [view[1], view[5], view[9]];
  const back: Vec3 = [view[2], view[6], view[10]];
  // Eye = -Rᵀ t
  const t: Vec3 = [view[12], view[13], view[14]];
  const eye: Vec3 = [
    -(right[0] * t[0] + up[0] * t[1] + back[0] * t[2]),
    -(right[1] * t[0] + up[1] * t[1] + back[1] * t[2]),
    -(right[2] * t[0] + up[2] * t[1] + back[2] * t[2]),
  ];
  const tolerance = (2 * halfHeight * pickPx) / Math.max(heightPx, 1);
  const sx = ndcX * halfHeight * aspect;
  const sy = ndcY * halfHeight;
  if (ortho) {
    return {
      origin: vec3.add(eye, vec3.add(vec3.scale(right, sx), vec3.scale(up, sy))),
      dir: vec3.scale(back, -1),
      coneTan: 0,
      coneRadius: tolerance,
    };
  }
  const dir = vec3.normalize(vec3.add(vec3.scale(back, -1), vec3.add(vec3.scale(right, sx), vec3.scale(up, sy))));
  return { origin: eye, dir, coneTan: tolerance, coneRadius: 0 };
}

/** Intersection of a ray with the plane through `point` with normal `n`. */
export function intersectPlane(ray: Ray, n: Vec3, point: Vec3 = [0, 0, 0]): Vec3 | null {
  const denom = vec3.dot(ray.dir, n);
  if (Math.abs(denom) < 1e-6) return null;
  const t = vec3.dot(vec3.sub(point, ray.origin), n) / denom;
  return t > 0 ? vec3.add(ray.origin, vec3.scale(ray.dir, t)) : null;
}
