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
      lod: LodParams;
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
      /** Hits closer than this are ignored (default: the render near cull). */
      near?: number;
    };

/**
 * Distance LOD: splats whose projected radius is below `minPx` pixels are
 * thinned to a stable, hash-selected fraction (never below `minKeep`), and the
 * survivors are enlarged so the covered area stays the same.
 */
export interface LodParams {
  /** Pixels per world unit at depth 1 (perspective) or per world unit (orthographic). */
  focalPx: number;
  ortho: boolean;
  /** 0 disables LOD. */
  minPx: number;
  minKeep: number;
}

/** Largest footprint enlargement for thinned splats (must match the shader decode). */
export const LOD_MAX_SCALE = 4;
/** Order entries carry the splat index in the low 24 bits and the LOD scale in the top 8. */
export const LOD_INDEX_BITS = 24;
export const REVEAL_QUANTILE_STEPS = 128;
export const LOD_MAX_PACKED_SPLATS = (1 << LOD_INDEX_BITS) - 1;

export type WorkerToMain =
  /** `capacity` is an upper bound (file size / 32) or 0 when unknown. */
  | { type: 'begin'; capacity: number }
  | { type: 'progress'; loadedBytes: number; totalBytes: number }
  /** Packed splats `[first, first + count)` ready to upload. */
  /**
   * `revealQuantiles[i]`: distance from the origin within which `i / REVEAL_QUANTILE_STEPS`
   * of the splats loaded so far lie, so the reveal waves can advance by splat count.
   */
  | { type: 'chunk'; first: number; count: number; data: Uint32Array; revealQuantiles: Float32Array }
  | { type: 'done'; count: number }
  | {
      type: 'sorted';
      order: Uint32Array;
      visible: number;
      sortMs: number;
      /** True when entries are LOD-packed (index | scale << 24). */
      packed: boolean;
      /** Splats skipped by distance LOD this sort. */
      lodCulled: number;
    }
  | { type: 'picked'; id: number; point: [number, number, number] | null }
  | { type: 'error'; message: string };
