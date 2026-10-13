/**
 * Backend-agnostic contract shared by the WebGPU (vgpu) and WebGL
 * (GaussianSplats3D) viewers. Home and the panels only talk to this interface,
 * so neither renderer leaks into the UI and the WebGL bundle can be lazy-loaded.
 */
export type RenderBackend = 'webgpu' | 'webgl';

/** Named camera viewpoints, mirroring SuperSplat-style view presets. */
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'reset';

export type SceneFormat = 'auto' | 'ply' | 'splat' | 'ksplat' | 'spz';

/** Distance level-of-detail preset (WebGPU backend). */
export type LodQuality = 'high' | 'balanced' | 'performance';

export interface SceneLoadOptions {
  format?: SceneFormat;
  splatAlphaRemovalThreshold?: number;
  progressiveLoad?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export interface ViewerStats {
  backend: RenderBackend;
  splatCount: number;
  /** Splats submitted to the GPU last frame (after culling). */
  renderCount: number;
  /** Splats skipped by distance LOD (0 when unsupported). */
  lodCulled: number;
  fps: number | null;
  sortTimeMs: number;
  drawCalls: number | null;
  renderWidth: number | null;
  renderHeight: number | null;
  renderPixelRatio: number | null;
  /** Exact bytes held by splat/order GPU buffers when the backend knows them. */
  gpuBufferMB: number | null;
  cameraPosition: [number, number, number] | null;
  cameraTarget: [number, number, number] | null;
  cameraUp: [number, number, number] | null;
  splatScale: number;
  pointCloudMode: boolean;
}

export interface SplatViewerHandle {
  readonly backend: RenderBackend;
  addSplatScene: (path: string, options?: SceneLoadOptions) => Promise<void>;
  removeSplatScene: (index: number) => Promise<void>;
  getSceneCount: () => number;
  getStats: () => ViewerStats | null;
  setPointCloudMode: (enabled: boolean) => void;
  setSplatScale: (scale: number) => void;
  setActiveSphericalHarmonicsDegrees: (degree: number) => void;
  /** False when the backend cannot honour SH degrees (e.g. `.splat` has none). */
  readonly supportsSphericalHarmonics: boolean;
  resetCamera: () => void;
  setOrthographicMode: (enabled: boolean) => void;
  getOrthographicMode: () => boolean;
  setFov: (fov: number) => void;
  getFov: () => number;
  setBackgroundColor: (color: string) => void;
  setGridVisible: (visible: boolean) => void;
  setAxesVisible: (visible: boolean) => void;
  setCameraView: (view: CameraView) => void;
  /** Distance LOD: far splats are thinned/enlarged to save GPU time. */
  readonly supportsLod: boolean;
  setLodQuality: (quality: LodQuality) => void;
  getLodQuality: () => LodQuality;
  setEditorViewVisible: (visible: boolean) => void;
}

export interface SplatViewerProps {
  className?: string;
  onProgress?: (percent: number, percentLabel: string, status: number) => void;
  onLoadStart?: () => void;
  onLoadComplete?: () => void;
  onError?: (error: Error) => void;
  /** Scene clear color (hex). Follows the UI theme unless the user overrides it. */
  background?: string;
  /** UI theme, for chrome the renderer draws itself (editor picture-in-picture). */
  theme?: 'light' | 'dark';
}

/** Shared camera framing so both backends open the scene the same way. */
export const CAMERA = {
  UP: [0, -1, 0] as [number, number, number],
  INITIAL_POSITION: [0, -2.4, 4.4] as [number, number, number],
  LOOK_AT: [0, 0, 0] as [number, number, number],
  MIN_DISTANCE: 0.5,
  MAX_DISTANCE: 20,
  // Keep the camera from going too far above/below the model (which put it at
  // "ground level" and made navigation disorienting).
  MIN_POLAR_ANGLE: Math.PI * 0.1,
  MAX_POLAR_ANGLE: Math.PI * 0.82,
};

export const INTRO = {
  DURATION_MS: 6000,
  START_DISTANCE: 9.0,
  END_DISTANCE: 2.6,
  SPEED_INTRO: 2.2,
  SPEED_SLOW: 0.8,
};

export const VIEW_DIRECTIONS: Record<Exclude<CameraView, 'reset'>, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Resolves 'auto' from the URL / file name. */
export function resolveFormat(format: SceneFormat | undefined, nameOrUrl: string): SceneFormat {
  if (format && format !== 'auto') return format;
  const clean = nameOrUrl.split(/[?#]/)[0].toLowerCase();
  const ext = clean.split('.').pop();
  if (ext === 'ply' || ext === 'splat' || ext === 'ksplat' || ext === 'spz') return ext;
  return 'auto';
}
