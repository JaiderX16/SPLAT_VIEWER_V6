/**
 * Message protocol between the main thread and `splat.worker.ts`. The GPU layout of a splat (20 bytes,
 * positions quantized per block of 256 splats) is in pack.ts. The LOD tree's merged splats follow the
 * originals in the same buffer, from the first whole block after them.
 */
import type { VoxelGridData } from './collision';
import type { FrustumParams } from './frustum';

/** Size of one record in the antimatter15 `.splat` format. */
export const SPLAT_FILE_RECORD_BYTES = 32;

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
      /** Tight frustum culling (see frustum.ts); null keeps every splat centred within the loose margin. */
      frustum: FrustumParams | null;
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
 * LOD (lod.ts): a tree node whose merged splat is under `minPx` pixels on screen is drawn as that one splat
 * instead of the splats under it; a budget raises that size until what is drawn fits.
 */
export interface LodParams {
  /** Pixels per world unit at depth 1 (perspective) or per world unit (orthographic). */
  focalPx: number;
  ortho: boolean;
  /** Merge size: radius (px) under which a node's merged splat stands in for it; 0 merges only for the budget. */
  minPx: number;
  /** Most splats to draw (0 = no limit). */
  budget: number;
  /** Skip giant and needle splats (noise.ts). */
  hideNoise: boolean;
  /** Skip what lies under the floor (collision.ts floorCutHeight: height along up = sign × position[axis]); null keeps it. */
  cutBelow: { axis: number; sign: number; floor: number; voxel: number } | null;
}

export const REVEAL_QUANTILE_STEPS = 128;

export type WorkerToMain =
  /** `capacity` is an upper bound (file size / 32) or 0 when unknown. */
  | { type: 'begin'; capacity: number }
  | { type: 'progress'; loadedBytes: number; totalBytes: number }
  /**
   * Packed splats `[first, first + count)` ready to upload (pack.ts), `first` a whole block, with the boxes of
   * their blocks. `revealQuantiles[i]`: distance from the origin within which `i / REVEAL_QUANTILE_STEPS` of
   * the splats loaded so far lie, so the reveal waves can advance by splat count (absent for merged splats).
   */
  | { type: 'chunk'; first: number; count: number; data: Uint32Array; boxes: Float32Array; revealQuantiles?: Float32Array }
  /** `count` splats in the scene; `total` GPU splats with the merged ones. */
  | { type: 'done'; count: number; total: number }
  | {
      type: 'sorted';
      order: Uint32Array;
      visible: number;
      sortMs: number;
      /** Splats saved by the LOD this sort: drawn as part of merged splats (while streaming: left out by the budget). */
      lodCulled: number;
      /** Splats ahead of the camera that tight culling dropped, whole tree nodes at a time, as they cannot reach the screen (0 when it is off). */
      offscreen: number;
      /** In-view giant and needle splats skipped (0 when that is off). */
      noisy: number;
      /** Splats hidden behind the first layer the camera sees, dropped by hide-unseen (occlusion.ts). */
      occluded: number;
      /** In-view splats under the floor, dropped by the floor cut (0 when it is off). */
      underground: number;
    }
  | { type: 'picked'; id: number; point: [number, number, number] | null }
  /** Rejilla de colisión de la escena completa; llega justo antes de 'done'. */
  | { type: 'grid'; grid: VoxelGridData }
  | { type: 'error'; message: string };
