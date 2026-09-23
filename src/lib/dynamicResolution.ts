/**
 * Dynamic Resolution Scaling (DRS) for the Gaussian Splats viewer.
 *
 * Quality-first design. The dominant fill-rate win on high-DPR phones is already
 * `ignoreDevicePixelRatio` (render at 1x instead of the native 2.5–3x). This
 * controller is only a gentle safety net for the rare case where even 1x is too
 * heavy for the GPU:
 *
 *  - It never changes resolution while the user is orbiting/panning, so there is
 *    no visible "blur for a second" when you grab the scene.
 *  - Its floor (0.85) is high enough that the scene never looks noticeably soft.
 *  - It only steps down after a *sustained* period of very low FPS, and steps
 *    back up gradually once FPS recovers.
 *
 * The renderer's internal pixel ratio and the viewer's `devicePixelRatio` are
 * kept in sync so the splat shader's focal-length math stays correct while the
 * drawing buffer shrinks/grows.
 */

export interface DynamicResolutionOptions {
  /** Minimum internal pixel ratio (floor). */
  minScale?: number;
  /** Maximum internal pixel ratio (never exceeded, even on 3x screens). */
  maxScale?: number;
  /** Scale used right after a scene loads or the controller resets. */
  initialScale?: number;
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
  minScale: 0.85,
  maxScale: 1.0,
  initialScale: 1.0,
  stepDownFactor: 0.9,
  stepUpFactor: 1.05,
  fpsLow: 20,
  fpsHigh: 50,
  sampleIntervalMs: 500,
  lowSustainMs: 2000,
  highSustainMs: 2000,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DynamicResolutionController {
  private readonly host: DynamicResolutionHost;
  private readonly options: Required<DynamicResolutionOptions>;
  private scale: number;
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
    this.apply(clamp(this.options.initialScale, this.options.minScale, this.options.maxScale));
  }

  private readonly handleStart = () => {
    // No resolution change on interaction: a drop here is what caused the
    // visible "blur for a second" while grabbing the scene. We only pause the
    // FPS-driven loop so it doesn't adapt mid-gesture.
    this.interacting = true;
    this.lowTimer = 0;
    this.highTimer = 0;
  };

  private readonly handleEnd = () => {
    this.interacting = false;
    this.lowTimer = 0;
    this.highTimer = 0;
  };

  private readonly tick = () => {
    const now = performance.now();
    const dt = Math.min(now - this.lastTick, 2000);
    this.lastTick = now;

    // Don't adjust resolution while the user is interacting.
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
