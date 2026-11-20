/**
 * Backend-agnostic contract shared by the WebGPU (vgpu) and WebGL
 * (GaussianSplats3D) viewers. Home and the panels only talk to this interface,
 * so neither renderer leaks into the UI and the WebGL bundle can be lazy-loaded.
 */
export type RenderBackend = 'webgpu' | 'webgl';

/** Named camera viewpoints, mirroring SuperSplat-style view presets. */
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'reset';

export type SceneFormat = 'auto' | 'ply' | 'splat' | 'ksplat' | 'spz';

/**
 * How the user moves through the scene: orbit around it, or explore it in first
 * person (interior at head height with collisions, walk on the ground, panorama
 * look-around, free fly).
 */
export type NavigationMode = 'orbit' | 'interior' | 'walk' | 'look' | 'fly';
/** Order of the navigation panel and of the `V` shortcut. */
export const NAVIGATION_CYCLE: NavigationMode[] = ['interior', 'walk', 'look', 'fly', 'orbit'];

export interface NavigationSettings {
  mode: NavigationMode;
  /** First-person movement speed multiplier. */
  speed: number;
  /** Turn the first-person view with the device's orientation (phones). */
  gyro: boolean;
}

/** Distance level-of-detail preset (WebGPU backend). */
export type LodQuality = 'high' | 'balanced' | 'performance';

/**
 * Splats fainter than this alpha (0–255) are dropped while loading. Measured on an interior scan, 8 removes
 * ~30 % of the splats (and of GPU memory and sort time) at 46–47 dB PSNR: no visible change.
 */
export const DEFAULT_ALPHA_THRESHOLD = 8;

/** Most splats drawn per view (WebGPU backend); 0 = no limit. Phones choke past ~100 K. */
export const SPLAT_BUDGETS = [100_000, 300_000, 1_000_000, 0] as const;

/**
 * Encuadre propio de un modelo. Solo el renderizador WebGPU (.splat) lo aplica; sin él se usa CAMERA/INTRO.
 * - Exterior (órbita): `target` es el punto que rodea la cámara; `distance`, `elevation` y `azimuth`
 *   dicen desde dónde lo mira.
 * - Interior (primera persona): `eye` es dónde está parada la cámara y `target` el punto al que mira.
 * Coordenadas de la escena; el eje vertical es -Y.
 */
export interface CameraFraming {
  target: [number, number, number];
  /** Interior: posición de la cámara. Si está, se ignoran distance/elevation/azimuth. */
  eye?: [number, number, number];
  /** Distancia final al objetivo tras la entrada (por defecto INTRO.END_DISTANCE). */
  distance?: number;
  /** Grados sobre el horizonte desde los que mira (por defecto los del encuadre inicial). */
  elevation?: number;
  /** Grados alrededor del eje vertical (0: desde +Z). */
  azimuth?: number;
  /** Exterior: vueltas por minuto del giro lento tras la entrada (0 = quieta; por defecto INTRO.SPEED_SLOW). */
  speed?: number;
}

export interface SceneLoadOptions {
  /** Encuadre de este modelo (ver CameraFraming). */
  framing?: CameraFraming;
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
  /** Splats hidden because no part of them reaches the screen (null when unsupported). */
  offscreenCulled: number | null;
  /** GPU time of the splat pass, ms (timestamp queries; null when unsupported). */
  gpuMs: number | null;
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
  /** First-person navigation; absent when the backend only orbits. */
  setNavigation?: (settings: NavigationSettings) => void;
  /** Encuadre actual de la cámara (para guardarlo); null si el backend no lo admite. */
  getCameraFraming?: () => CameraFraming | null;
  /** Primera persona: coloca la cámara en `eye` mirando a `target`, sin bajarla al suelo. */
  standAt?: (eye: [number, number, number], target: [number, number, number]) => void;
  /** Giro automático en órbita a `rpm` vueltas por minuto (0 lo para). */
  setSpinSpeed?: (rpm: number) => void;
  /** Entra o sale de una sesión WebXR inmersiva, cuando el backend lo admite. */
  toggleVR?: () => Promise<void>;
  /** Ocultar los splats que la cámara no ve (frustum ajustado a cada splat); ausente si el backend no lo admite. */
  setHideUnseen?: (enabled: boolean) => void;
  getHideUnseen?: () => boolean;
  /** Máximo de splats dibujados por vista (0 = sin límite); ausente si el backend no lo admite. */
  setSplatBudget?: (budget: number) => void;
  getSplatBudget?: () => number;
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

const DEFAULT_ELEVATION = (Math.atan2(-CAMERA.INITIAL_POSITION[1], Math.hypot(CAMERA.INITIAL_POSITION[0], CAMERA.INITIAL_POSITION[2])) * 180) / Math.PI;

/** Posición, objetivo y distancia final de la cámara para un encuadre (o el de por defecto). */
export function framingPose(framing?: CameraFraming | null) {
  if (framing?.eye) {
    const e = framing.eye, t = framing.target;
    const distance = Math.max(Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]), 1e-3);
    return { position: e, target: t, distance, startDistance: distance, initialDistance: distance };
  }
  if (!framing) {
    const p = CAMERA.INITIAL_POSITION;
    return { position: p, target: CAMERA.LOOK_AT, distance: INTRO.END_DISTANCE, startDistance: INTRO.START_DISTANCE, initialDistance: Math.hypot(p[0], p[1], p[2]) };
  }
  const distance = framing.distance ?? INTRO.END_DISTANCE;
  const el = ((framing.elevation ?? DEFAULT_ELEVATION) * Math.PI) / 180;
  const az = ((framing.azimuth ?? 0) * Math.PI) / 180;
  // Arriba es -Y (CAMERA.UP).
  const dir: [number, number, number] = [Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)];
  const t = framing.target;
  const position: [number, number, number] = [t[0] + dir[0] * distance, t[1] + dir[1] * distance, t[2] + dir[2] * distance];
  // La entrada parte de lejos en la misma proporción que el encuadre por defecto.
  const startDistance = distance * (INTRO.START_DISTANCE / INTRO.END_DISTANCE);
  return { position, target: t, distance, startDistance, initialDistance: distance };
}

/** Encuadre de una pose de cámara: órbita (objetivo + ángulos) o primera persona (ojo + objetivo). */
export function framingFromPose(position: [number, number, number], target: [number, number, number], firstPerson: boolean): CameraFraming {
  const r = (v: number, k = 1e4) => Math.round(v * k) / k;
  const t: [number, number, number] = [r(target[0]), r(target[1]), r(target[2])];
  if (firstPerson) return { target: t, eye: [r(position[0]), r(position[1]), r(position[2])] };
  const d = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const distance = Math.hypot(d[0], d[1], d[2]) || 1;
  // Arriba es -Y: la elevación es el ángulo de la dirección (objetivo → cámara) sobre el horizonte.
  const elevation = (Math.asin(Math.max(-1, Math.min(1, -d[1] / distance))) * 180) / Math.PI;
  const azimuth = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
  return { target: t, distance: r(distance), elevation: r(elevation, 10), azimuth: r(azimuth, 10) };
}

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
