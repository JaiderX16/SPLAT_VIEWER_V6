/**
 * Dynamic Resolution Scaling (DRS) for the Gaussian Splats viewer.
 *
 * Mid/low-end mobile GPUs are almost always *fill-rate* bound: their screens
 * have very high native pixel density (devicePixelRatio 2.5–3.0) and rendering
 * the full native resolution saturates the fragment pipeline. Rendering the
 * scene internally at a lower resolution and letting the compositor upscale is
 * the single most effective win on those devices.
 *
 * This controller adapts the internal pixel ratio in real time:
 *
 *  1. Interactivity LOD — the instant the user starts orbiting/panning, the
 *     internal resolution is dropped so frames stay cheap exactly where FPS
 *     would otherwise tank; it is restored when interaction ends (crisp while
 *     still, fast while moving).
 *
 *  2. FPS-driven adaptation — while idle, sustained FPS below `fpsLow` scales
 *     the resolution down (×`stepDownFactor` per step), and sustained FPS above
 *     `fpsHigh` scales it back up gradually (×`stepUpFactor`).
 *
 * The renderer's internal pixel ratio and the viewer's `devicePixelRatio` are
 * kept in sync, so focal-length math in the splat shader stays correct and the
 * splats keep their apparent on-screen size while the drawing buffer shrinks.
 */

export interface DynamicResolutionOptions {
  /** Minimum internal pixel ratio (floor). */
  minScale?: number;
  /** Maximum internal pixel ratio (never exceeded, even on 3x screens). */
  maxScale?: number;
  /** Scale used right after a scene loads or the controller resets. */
  initialScale?: number;
  /** Immediate scale multiplier applied when interaction starts. */
  interactionDropFactor?: number;
  /** Scale multiplier applied when FPS stays below `fpsLow`. */
  stepDownFactor?: number;
  /** Scale multiplier applied when FPS stays above `fpsHigh`. */
  stepUpFactor?: number;
  /** FPS below which resolution is reduced. */
  fpsLow?: number;
  /** FPS above which resolution is increased. */
  fpsHigh?: number;
  /** FPS sampling cadence in milliseconds. */
  sampleIntervalMs?: number;
  /** How long FPS must stay low before down-scaling. */
  lowSustainMs?: number;
  /** How long FPS must stay high before up-scaling. */
  highSustainMs?: number;
}

/** Minimal surface of the viewer that DRS needs to control. */
export interface DynamicResolutionHost {
  rootElement: { offsetWidth: number; offsetHeight: number } | null;
  renderer: {
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
  } | null;
  /** Kept in sync with the renderer so focal-length math stays correct. */
  devicePixelRatio: number;
  currentFPS: number | null;
  controls: {
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
  } | null;
  forceRenderNextFrame?(): void;
  onDynamicResolutionChange?(scale: number): void;
}

const DEFAULT_OPTIONS: Required<DynamicResolutionOptions> = {
  minScale: 0.55,
  maxScale: 1.2,
  initialScale: 1.0,
  interactionDropFactor: 0.75,
  stepDownFactor: 0.75,
  stepUpFactor: 1.1,
  fpsLow: 24,
  fpsHigh: 55,
  sampleIntervalMs: 300,
  lowSustainMs: 1000,
  highSustainMs: 1500,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DynamicResolutionController {
  private readonly host: DynamicResolutionHost;
  private readonly options: Required<DynamicResolutionOptions>;
  private scale: number;
  private idleScale: number;
  private interacting = false;
  private started = false;
  private lowTimer = 0;
  private highTimer = 0;
  private lastTick = 0;
  private intervalId: number | null = null;

  constructor(host: DynamicResolutionHost, options: DynamicResolutionOptions = {}) {
    this.host = host;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.scale = clamp(this.options.initialScale, this.options.minScale, this.options.maxScale);
    this.idleScale = this.scale;
  }

  getScale(): number {
    return this.scale;
  }

  get isInteracting(): boolean {
    return this.interacting;
  }

  /** Attach control listeners and start the FPS sampling loop. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.host.controls?.addEventListener?.('start', this.handleStart);
    this.host.controls?.addEventListener?.('end', this.handleEnd);

    this.lastTick = performance.now();
    this.intervalId = window.setInterval(this.tick, this.options.sampleIntervalMs);
    this.apply(this.scale);
  }

  /** Detach listeners and stop the sampling loop. Safe to call more than once. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.host.controls?.removeEventListener?.('start', this.handleStart);
    this.host.controls?.removeEventListener?.('end', this.handleEnd);

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Restore the initial (crisp) resolution, e.g. after loading a new scene. */
  reset(): void {
    this.interacting = false;
    this.lowTimer = 0;
    this.highTimer = 0;
    this.idleScale = clamp(this.options.initialScale, this.options.minScale, this.options.maxScale);
    this.apply(this.idleScale);
  }

  private readonly handleStart = () => {
    if (this.interacting) return;
    this.interacting = true;
    this.lowTimer = 0;
    this.highTimer = 0;
    this.idleScale = this.scale;

    const target = clamp(
      this.scale * this.options.interactionDropFactor,
      this.options.minScale,
      this.options.maxScale,
    );
    if (target < this.scale) this.apply(target);
  };

  private readonly handleEnd = () => {
    if (!this.interacting) return;
    this.interacting = false;
    this.lowTimer = 0;
    this.highTimer = 0;
    this.apply(this.idleScale);
  };

  private readonly tick = () => {
    const now = performance.now();
    const dt = Math.min(now - this.lastTick, 2000);
    this.lastTick = now;

    // While the user is interacting, the interaction drop already keeps frames
    // cheap; let the FPS loop resume once they stop moving.
    if (this.interacting) return;

    const fps = this.host.currentFPS;
    if (!fps || fps <= 0) return;

    if (fps < this.options.fpsLow) {
      this.lowTimer += dt;
      this.highTimer = 0;
    } else if (fps > this.options.fpsHigh) {
      this.highTimer += dt;
      this.lowTimer = 0;
    } else {
      this.lowTimer = 0;
      this.highTimer = 0;
    }

    if (this.lowTimer >= this.options.lowSustainMs) {
      this.apply(this.scale * this.options.stepDownFactor);
      this.lowTimer = 0;
    } else if (this.highTimer >= this.options.highSustainMs) {
      this.apply(this.scale * this.options.stepUpFactor);
      this.highTimer = 0;
    }
  };

  private apply(next: number): void {
    const clamped = clamp(next, this.options.minScale, this.options.maxScale);
    if (Math.abs(clamped - this.scale) < 0.001) {
      this.scale = clamped;
      return;
    }
    this.scale = clamped;

    this.host.devicePixelRatio = clamped;
    const renderer = this.host.renderer;
    if (renderer && this.host.rootElement) {
      renderer.setPixelRatio(clamped);
      renderer.setSize(
        this.host.rootElement.offsetWidth,
        this.host.rootElement.offsetHeight,
        false,
      );
    }

    this.host.forceRenderNextFrame?.();
    this.host.onDynamicResolutionChange?.(clamped);
  }
}

/** True when SharedArrayBuffer is available (page is cross-origin isolated). */
export function isSharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';
}
