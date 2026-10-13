/**
 * Message protocol between the main thread and `splat.worker.ts`.
 *
 * GPU layout of one splat (8 × u32 = 32 bytes, read as two `vec4u` in WGSL):
 *   [0..2] position xyz (f32 bits)
 *   [3]    rgba8 color (r in the low byte → `unpack4x8unorm`)
 *   [4]    pack2x16float(c00, c01)
 *   [5]    pack2x16float(c02, c11)
 *   [6]    pack2x16float(c12, c22)
 *   [7]    unused (keeps 16-byte alignment)
 * The 3D covariance is stored pre-multiplied by COVARIANCE_PACK_SCALE so tiny
 * splats stay out of the fp16 subnormal range; the shader undoes it.
 */
export const SPLAT_WORDS = 8;
export const SPLAT_BYTES = SPLAT_WORDS * 4;
/** Size of one record in the antimatter15 `.splat` format. */
export const SPLAT_FILE_RECORD_BYTES = 32;
export const COVARIANCE_PACK_SCALE = 4;

export interface SceneTransform {
  position?: [number, number, number];
  /** Quaternion [x, y, z, w]. */
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export type MainToWorker =
  | {
      type: 'load';
      url: string;
      /** Splats whose alpha (0–255) is below this are dropped at parse time. */
      alphaThreshold: number;
      transform?: SceneTransform;
    }
  | { type: 'abort' }
  | {
      type: 'sort';
      /** Column-major view-projection matrix. */
      viewProj: Float32Array;
      /** Column-major view matrix (only the depth row is used). */
      view: Float32Array;
    }
  /** Hands an order buffer back after its contents were uploaded to the GPU. */
  | { type: 'recycle'; order: Uint32Array }
  /**
   * Ray pick: first sufficiently opaque splat inside a cone around the ray.
   * `coneTan` is the cone half-angle tangent (perspective) and `coneRadius`
   * a constant radius (orthographic / minimum), both in world units.
   */
  | {
      type: 'pick';
      id: number;
      origin: [number, number, number];
      dir: [number, number, number];
      coneTan: number;
      coneRadius: number;
    };

export type WorkerToMain =
  /** `capacity` is an upper bound (file size / 32) or 0 when unknown. */
  | { type: 'begin'; capacity: number }
  | { type: 'progress'; loadedBytes: number; totalBytes: number }
  /** Packed splats `[first, first + count)` ready to upload. */
  | { type: 'chunk'; first: number; count: number; data: Uint32Array }
  | {
      type: 'done';
      count: number;
      bounds: { min: [number, number, number]; max: [number, number, number] };
    }
  | { type: 'sorted'; order: Uint32Array; visible: number; sortMs: number }
  | { type: 'picked'; id: number; point: [number, number, number] | null }
  | { type: 'error'; message: string };
