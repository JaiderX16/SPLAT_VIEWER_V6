import { draw, frameLoop, initFromDevice, surface } from 'vgpu';
import type { Draw, Frame, FrameLoopHandle, Gpu, Surface } from 'vgpu';
import splatShader from './splat.wgsl';
import helpersShader from './helpers.wgsl';
import { cameraRay, intersectPlane, lookAt, multiply, orthographic, perspective, vec3, type Ray, type Vec3 } from './math';
import { EditorView, type PixelRect } from './EditorView';
import { OrbitControls, type OrbitLimits } from './orbitControls';
import { LOD_MAX_SCALE, SPLAT_BYTES, type LodParams, type MainToWorker, type SceneTransform, type WorkerToMain } from './protocol';

/**
 * Distance-LOD presets. `minPx`: projected radius (px) under which splats get
 * thinned; `minKeep`: the smallest fraction kept for sub-pixel splats.
 */
export type LodQuality = 'high' | 'balanced' | 'performance';
const LOD_PRESETS: Record<LodQuality, { minPx: number; minKeep: number }> = {
  high: { minPx: 0, minKeep: 1 },
  balanced: { minPx: 1.25, minKeep: 0.12 },
  performance: { minPx: 2.5, minKeep: 0.06 },
};

export interface SplatRendererOptions {
  up: Vec3;
  limits: OrbitLimits;
  fovDeg?: number;
  background?: string;
  onError?: (error: Error) => void;
  /** Fired when a click starts a camera move; `x`/`y` are CSS px relative to the canvas. */
  onNavigate?: (event: { x: number; y: number; kind: 'scene' | 'map' }) => void;
}

export interface SplatLoadOptions {
  alphaThreshold?: number;
  transform?: SceneTransform;
  /** status: 0 downloading, 1 processing, 2 done (same contract as GaussianSplats3D). */
  onProgress?: (percent: number, label: string, status: number) => void;
  /** Fired once, when the first splats are on the GPU. */
  onFirstSplats?: () => void;
}

export interface SplatRendererStats {
  splatCount: number;
  visibleCount: number;
  /** Splats skipped by distance LOD in the last sort. */
  lodCulled: number;
  fps: number | null;
  frameMs: number;
  sortMs: number;
  drawCalls: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  gpuBufferMB: number;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraUp: Vec3;
}

const GRID_DIVISIONS = 20;
const GRID_HALF_SIZE = 5;
/** Re-sort at most this often while splats are still streaming in. */
const STREAMING_SORT_INTERVAL_MS = 120;
/** View-projection change (max abs element delta) that triggers a re-sort. */
const SORT_EPSILON = 1e-3;
/** A press counts as a click (not a drag) under these thresholds. */
const CLICK_MAX_MOVE_PX = 5;
const CLICK_MAX_MS = 500;
/** Click-to-travel lands at this fraction of the distance to the clicked point. */
const TRAVEL_DISTANCE_FACTOR = 0.45;
const TRAVEL_MS = 900;
const MAP_TRAVEL_MS = 1100;

/** True when the browser exposes a usable WebGPU adapter. */
export async function isWebGPUAvailable(): Promise<boolean> {
  const nav = navigator as Navigator & { gpu?: GPU };
  if (!nav.gpu) return false;
  try {
    return (await nav.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

function hexToClear(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

/**
 * WebGPU Gaussian-splat renderer built on vgpu.
 *
 * GPU memory: one storage buffer of packed 32-byte splats (half the size of a
 * naive f32 layout) and one u32 order buffer. Both are raw `GPUBuffer`s bound
 * through vgpu's raw-range bindings, so chunks stream in with
 * `queue.writeBuffer` at an offset and the buffers grow geometrically without
 * re-uploading from the CPU (`copyBufferToBuffer`).
 *
 * Frame cost: a single instanced draw (6 vertices × visible splats). The frame
 * loop renders on demand — when the camera, data, sort or settings change —
 * so an idle scene costs ~0 GPU.
 */
export class SplatRenderer {
  readonly controls: OrbitControls;

  private readonly gpu: Gpu;
  private readonly device: GPUDevice;
  private readonly surf: Surface;
  private readonly splatDraw: Draw;
  private readonly gridDraw: Draw;
  private readonly axesDraw: Draw;
  private readonly worker: Worker;
  private readonly editor: EditorView;
  private readonly canvas: HTMLCanvasElement;
  private readonly onNavigate?: SplatRendererOptions['onNavigate'];
  private loop: FrameLoopHandle | null = null;

  private press: { id: number; x: number; y: number; t: number; inMap: boolean } | null = null;
  private activePointers = 0;
  private navToken = 0;
  private pickId = 0;
  private readonly pendingPicks = new Map<number, (point: Vec3 | null) => void>();

  private splatBuffer: GPUBuffer;
  private orderBuffer: GPUBuffer;
  private capacity = 1;
  private loadedCount = 0;
  private visibleCount = 0;
  private generation = 0;
  private sortInFlight = false;
  private sortGeneration = 0;
  private lastSortAt = 0;
  private dataSinceSort = false;
  private lastSortMs = 0;
  private lodQuality: LodQuality = 'balanced';
  private lodPacked = false;
  private lodCulled = 0;
  private forceSort = false;
  private readonly lastSortViewProj = new Float32Array(16);

  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);

  private needsRender = true;
  private lastTick = performance.now();
  private lastRenderAt = 0;
  private framesThisSecond = 0;
  private fpsWindowStart = performance.now();
  private fps: number | null = null;
  private frameMs = 0;

  private fovDeg: number;
  private ortho = false;
  private splatScale = 1;
  private pointCloud = false;
  private gridVisible = false;
  private axesVisible = false;
  private clearColor: [number, number, number, number];
  private flyEndSpeed: number | null = null;

  private pendingLoad: {
    resolve: () => void;
    reject: (e: Error) => void;
    options: SplatLoadOptions;
    firstSplatsSent: boolean;
  } | null = null;

  static async create(canvas: HTMLCanvasElement, options: SplatRendererOptions): Promise<SplatRenderer> {
    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) throw new Error('WebGPU no está disponible en este navegador');
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No se encontró un adaptador WebGPU');
    // Ask for the adapter's real buffer limits: the defaults (128 MB binding /
    // 256 MB buffer) cap scenes at ~4M splats.
    const device = await adapter.requestDevice({
      label: 'splat-viewer',
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const gpu = await initFromDevice(device);
    return new SplatRenderer(canvas, gpu, device, options);
  }

  private constructor(canvas: HTMLCanvasElement, gpu: Gpu, device: GPUDevice, options: SplatRendererOptions) {
    this.gpu = gpu;
    this.device = device;
    this.canvas = canvas;
    this.onNavigate = options.onNavigate;
    this.fovDeg = options.fovDeg ?? 50;
    this.clearColor = hexToClear(options.background ?? '#000000');

    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    // Splatting is fill-rate bound: cap DPR lower on phones/tablets.
    this.surf = surface(gpu, canvas, { dpr: [1, coarsePointer ? 1.5 : 2], alphaMode: 'opaque' });
    this.surf.onResize(() => {
      this.needsRender = true;
    });

    this.splatBuffer = this.createBuffer('splats', SPLAT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.orderBuffer = this.createBuffer('order', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);

    this.splatDraw = draw(gpu, {
      label: 'splats',
      shader: splatShader,
      vertices: 6,
      instances: 0,
      blend: 'premultiplied',
    });
    this.splatDraw.set({ splats: this.splatBuffer, order: this.orderBuffer });

    this.gridDraw = draw(gpu, {
      label: 'grid',
      shader: helpersShader,
      entry: { vertex: 'vs_grid' },
      geometry: { topology: 'line-list', vertexCount: (GRID_DIVISIONS + 1) * 2 * 2 },
      blend: 'premultiplied',
    });
    this.axesDraw = draw(gpu, {
      label: 'axes',
      shader: helpersShader,
      entry: { vertex: 'vs_axes' },
      geometry: { topology: 'line-list', vertexCount: 6 },
      blend: 'premultiplied',
    });

    this.editor = new EditorView(gpu, options.up);
    this.editor.bindBuffers(this.splatBuffer, this.orderBuffer);

    // Click navigation listens in the capture phase and is registered before
    // the orbit controls, so presses inside the editor view never orbit.
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove, { capture: true });
    canvas.addEventListener('pointerup', this.onPointerUp, { capture: true });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { capture: true });
    canvas.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    canvas.style.cursor = 'grab';

    this.controls = new OrbitControls(options.up, options.limits);
    this.controls.fovY = (this.fovDeg * Math.PI) / 180;
    this.controls.attach(canvas);
    this.controls.onStart(() => {
      this.flyEndSpeed = null;
    });

    this.worker = new Worker(new URL('./splat.worker.ts', import.meta.url), { type: 'module', name: 'splat-worker' });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.onWorkerMessage(e.data);
    this.worker.onerror = (e) => this.failLoad(new Error(e.message || 'Error en el worker de splats'));

    gpu.onError((error) => options.onError?.(error instanceof Error ? error : new Error(String(error))));
    void gpu.lost.then(() => options.onError?.(new Error('Se perdió el dispositivo WebGPU')));
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  async start() {
    if (this.loop) return;
    await Promise.all([
      this.splatDraw.compile(this.surf),
      this.gridDraw.compile(this.surf),
      this.axesDraw.compile(this.surf),
      this.editor.compile(this.surf),
    ]);
    if (this.gpu.disposed || this.loop) return;
    this.lastTick = performance.now();
    this.loop = frameLoop(this.gpu, (frame) => this.tick(frame));
  }

  stop() {
    this.loop?.stop();
    this.loop = null;
  }

  dispose() {
    this.stop();
    this.failLoad(new DOMException('Visor destruido', 'AbortError'));
    this.worker.terminate();
    this.pendingPicks.forEach((resolve) => resolve(null));
    this.pendingPicks.clear();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.canvas.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    this.canvas.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
    this.canvas.removeEventListener('wheel', this.onWheel, { capture: true });
    this.controls.detach();
    this.editor.dispose();
    this.splatDraw.dispose();
    this.gridDraw.dispose();
    this.axesDraw.dispose();
    this.gpu.dispose();
    this.splatBuffer.destroy();
    this.orderBuffer.destroy();
    // initFromDevice never destroys a borrowed device; we created it.
    this.device.destroy();
  }

  // ─── Scene loading ─────────────────────────────────────────────────────────
  load(url: string, options: SplatLoadOptions = {}): Promise<void> {
    this.clear();
    return new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject, options, firstSplatsSent: false };
      options.onProgress?.(0, '0%', 0);
      this.post({
        type: 'load',
        url: new URL(url, window.location.href).href,
        alphaThreshold: options.alphaThreshold ?? 1,
        transform: options.transform,
      });
    });
  }

  clear() {
    this.failLoad(new DOMException('Carga cancelada', 'AbortError'));
    this.post({ type: 'abort' });
    this.generation++;
    this.loadedCount = 0;
    this.visibleCount = 0;
    this.dataSinceSort = false;
    this.needsRender = true;
  }

  get splatCount() {
    return this.loadedCount;
  }

  // ─── Settings ──────────────────────────────────────────────────────────────
  setSplatScale(scale: number) {
    this.splatScale = scale;
    this.needsRender = true;
  }

  getSplatScale() {
    return this.splatScale;
  }

  setPointCloud(enabled: boolean) {
    this.pointCloud = enabled;
    this.forceSort = true;
    this.needsRender = true;
  }

  getPointCloud() {
    return this.pointCloud;
  }

  setFov(fovDeg: number) {
    this.fovDeg = Math.max(10, Math.min(120, fovDeg));
    this.controls.fovY = (this.fovDeg * Math.PI) / 180;
    this.needsRender = true;
  }

  getFov() {
    return this.fovDeg;
  }

  setOrthographic(enabled: boolean) {
    this.ortho = enabled;
    this.needsRender = true;
  }

  getOrthographic() {
    return this.ortho;
  }

  setBackground(hex: string) {
    this.clearColor = hexToClear(hex);
    this.needsRender = true;
  }

  setGridVisible(visible: boolean) {
    this.gridVisible = visible;
    this.needsRender = true;
  }

  setAxesVisible(visible: boolean) {
    this.axesVisible = visible;
    this.needsRender = true;
  }

  setLodQuality(quality: LodQuality) {
    this.lodQuality = quality;
    this.forceSort = true;
    this.needsRender = true;
  }

  getLodQuality() {
    return this.lodQuality;
  }

  /** UI theme for chrome drawn by the renderer (editor picture-in-picture). */
  setTheme(theme: 'light' | 'dark') {
    this.editor.theme = theme;
    this.needsRender = true;
  }

  setEditorViewVisible(visible: boolean) {
    this.editor.visible = visible;
    this.needsRender = true;
  }

  getEditorViewVisible() {
    return this.editor.visible;
  }

  /** Auto-rotate at `speed` during a dolly fly-in, then settle to `endSpeed`. */
  playIntro(position: Vec3, target: Vec3, fromDistance: number, toDistance: number, durationMs: number, introSpeed: number, endSpeed: number) {
    const dir = [position[0] - target[0], position[1] - target[1], position[2] - target[2]] as Vec3;
    const len = Math.hypot(...dir) || 1;
    this.controls.setPose(
      [target[0] + (dir[0] / len) * fromDistance, target[1] + (dir[1] / len) * fromDistance, target[2] + (dir[2] / len) * fromDistance],
      target,
    );
    this.controls.flyRadius(fromDistance, toDistance, durationMs);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = introSpeed;
    this.flyEndSpeed = endSpeed;
  }

  getStats(): SplatRendererStats {
    const [w, h] = this.surf.size;
    return {
      splatCount: this.loadedCount,
      visibleCount: this.visibleCount,
      lodCulled: this.lodCulled,
      fps: this.fps,
      frameMs: this.frameMs,
      sortMs: this.lastSortMs,
      drawCalls:
        (this.visibleCount > 0 ? 1 : 0) + (this.gridVisible ? 1 : 0) + (this.axesVisible ? 1 : 0) +
        (this.editor.visible ? 4 + (this.visibleCount > 0 ? 1 : 0) : 0),
      canvasWidth: w,
      canvasHeight: h,
      dpr: this.surf.dpr,
      gpuBufferMB: (this.splatBuffer.size + this.orderBuffer.size) / (1024 * 1024),
      cameraPosition: this.controls.getPosition(),
      cameraTarget: this.controls.getTarget(),
      cameraUp: [...this.controls.up],
    };
  }

  // ─── Frame ─────────────────────────────────────────────────────────────────
  private tick(frame: Frame) {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    const wasFlying = this.controls.isFlying;
    const moved = this.controls.update(dt);
    if (wasFlying && !this.controls.isFlying && this.flyEndSpeed !== null) {
      this.controls.autoRotateSpeed = this.flyEndSpeed;
      this.flyEndSpeed = null;
    }

    this.updateMatrices();
    this.maybeSort(now);

    if (!moved && !this.needsRender) {
      return; // nothing changed: the canvas keeps showing the last frame
    }
    this.needsRender = false;
    // FPS is measured over consecutive rendered frames only; after an idle gap
    // start a new window and keep reporting the last active rate.
    if (now - this.lastRenderAt > 250) {
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
    }
    this.lastRenderAt = now;

    const [w, h] = this.surf.size;
    const tanHalf = Math.tan((this.fovDeg * Math.PI) / 360);
    this.splatDraw.set({
      camera: {
        view: this.view,
        proj: this.proj,
        viewport: [w, h],
        focal: [(this.proj[0] * w) / 2, (this.proj[5] * h) / 2],
        params: [this.splatScale, this.pointCloud ? 1 : 0, this.ortho ? 1 : 0, tanHalf * Math.max(1, w / Math.max(h, 1))],
        lod: [this.lodPacked ? 1 : 0, LOD_MAX_SCALE, 0, 0],
      },
    });
    // Dark grid lines on a light scene background, light lines on a dark one.
    const [cr, cg, cb] = this.clearColor;
    const lightScene = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb > 0.5 ? 1 : 0;
    const helperParams = { viewProj: this.viewProj, params: [GRID_HALF_SIZE, GRID_DIVISIONS, 1, lightScene] };
    if (this.gridVisible) this.gridDraw.set({ helpers: helperParams });
    if (this.axesVisible) this.axesDraw.set({ helpers: helperParams });

    frame.pass({ target: this.surf, clear: this.clearColor }, (pass) => {
      if (this.gridVisible) pass.draw(this.gridDraw);
      if (this.axesVisible) pass.draw(this.axesDraw);
      if (this.visibleCount > 0) pass.draw(this.splatDraw, { instances: this.visibleCount });
    });

    if (this.editor.visible) {
      this.editor.render(frame, this.surf, this.editorRect(), {
        view: this.view,
        fovDeg: this.fovDeg,
        aspect: w / Math.max(h, 1),
        ortho: this.ortho,
        distance: this.controls.distance,
        splatScale: this.splatScale,
        pointCloud: this.pointCloud,
        visibleCount: this.visibleCount,
        lodPacked: this.lodPacked,
      });
    }

    this.frameMs = performance.now() - now;
    this.framesThisSecond++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 500) {
      this.fps = Math.round((this.framesThisSecond * 1000) / elapsed);
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
    }
  }

  private updateMatrices() {
    const [w, h] = this.surf.size;
    const aspect = w / Math.max(h, 1);
    const eye = this.controls.getPosition();
    lookAt(eye, this.controls.getTarget(), this.controls.up, this.view);
    if (this.ortho) {
      orthographic(this.controls.distance * Math.tan((this.fovDeg * Math.PI) / 360), aspect, 0.05, 1000, this.proj);
    } else {
      perspective((this.fovDeg * Math.PI) / 180, aspect, 0.05, 1000, this.proj);
    }
    multiply(this.proj, this.view, this.viewProj);
  }

  private maybeSort(now: number) {
    if (this.sortInFlight || this.loadedCount === 0) return;
    let viewChanged = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(this.viewProj[i] - this.lastSortViewProj[i]) > SORT_EPSILON) {
        viewChanged = true;
        break;
      }
    }
    const streamingDue = this.dataSinceSort && now - this.lastSortAt > STREAMING_SORT_INTERVAL_MS;
    if (!viewChanged && !streamingDue && !this.forceSort) return;
    this.forceSort = false;
    this.lastSortViewProj.set(this.viewProj);
    this.lastSortAt = now;
    this.dataSinceSort = false;
    this.sortInFlight = true;
    this.sortGeneration = this.generation;
    const [, h] = this.surf.size;
    const preset = LOD_PRESETS[this.lodQuality];
    const lod: LodParams = {
      focalPx: (this.proj[5] * h) / 2,
      ortho: this.ortho,
      // Point-cloud dots have a fixed size, so thinning would only lose points.
      minPx: this.pointCloud ? 0 : preset.minPx,
      minKeep: preset.minKeep,
    };
    this.post({ type: 'sort', viewProj: this.viewProj.slice(), view: this.view.slice(), lod });
  }

  // ─── Worker / GPU memory ───────────────────────────────────────────────────
  private post(msg: MainToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  private onWorkerMessage(msg: WorkerToMain) {
    switch (msg.type) {
      case 'begin':
        if (msg.capacity > 0) this.ensureCapacity(msg.capacity);
        break;
      case 'progress': {
        const total = msg.totalBytes;
        const percent = total > 0 ? Math.min(99, Math.round((msg.loadedBytes / total) * 100)) : 0;
        const label = total > 0 ? `${percent}%` : `${(msg.loadedBytes / 1048576).toFixed(1)} MB`;
        this.pendingLoad?.options.onProgress?.(percent, label, 0);
        break;
      }
      case 'chunk': {
        this.ensureCapacity(msg.first + msg.count);
        this.device.queue.writeBuffer(this.splatBuffer, msg.first * SPLAT_BYTES, msg.data.buffer, msg.data.byteOffset, msg.data.byteLength);
        this.loadedCount = Math.max(this.loadedCount, msg.first + msg.count);
        this.dataSinceSort = true;
        const pending = this.pendingLoad;
        if (pending && !pending.firstSplatsSent) {
          pending.firstSplatsSent = true;
          pending.options.onFirstSplats?.();
        }
        break;
      }
      case 'done': {
        this.loadedCount = msg.count;
        this.dataSinceSort = true;
        const pending = this.pendingLoad;
        this.pendingLoad = null;
        pending?.options.onProgress?.(100, '100%', 2);
        pending?.resolve();
        break;
      }
      case 'sorted': {
        this.sortInFlight = false;
        if (this.sortGeneration === this.generation) {
          const visible = Math.min(msg.visible, this.loadedCount);
          this.ensureOrderCapacity(visible);
          if (visible > 0) this.device.queue.writeBuffer(this.orderBuffer, 0, msg.order.buffer, msg.order.byteOffset, visible * 4);
          this.visibleCount = visible;
          this.lodPacked = msg.packed;
          this.lodCulled = msg.lodCulled;
          this.lastSortMs = msg.sortMs;
          this.needsRender = true;
        }
        this.post({ type: 'recycle', order: msg.order }, [msg.order.buffer]);
        break;
      }
      case 'picked': {
        const resolve = this.pendingPicks.get(msg.id);
        this.pendingPicks.delete(msg.id);
        resolve?.(msg.point);
        break;
      }
      case 'error':
        this.failLoad(new Error(msg.message));
        break;
    }
  }

  // ─── Click navigation ──────────────────────────────────────────────────────
  private pick(ray: Ray): Promise<Vec3 | null> {
    if (this.loadedCount === 0) return Promise.resolve(null);
    const id = ++this.pickId;
    return new Promise((resolve) => {
      this.pendingPicks.set(id, resolve);
      this.post({ type: 'pick', id, origin: ray.origin, dir: ray.dir, coneTan: ray.coneTan, coneRadius: ray.coneRadius });
    });
  }

  private editorRect(): PixelRect {
    const [w, h] = this.surf.size;
    return this.editor.rect(w, h, this.surf.dpr);
  }

  /** CSS client coordinates -> physical canvas pixels. */
  private toCanvasPx(e: { clientX: number; clientY: number }) {
    const bounds = this.canvas.getBoundingClientRect();
    const [w, h] = this.surf.size;
    return {
      cssX: e.clientX - bounds.left,
      cssY: e.clientY - bounds.top,
      px: ((e.clientX - bounds.left) / Math.max(bounds.width, 1)) * w,
      py: ((e.clientY - bounds.top) / Math.max(bounds.height, 1)) * h,
    };
  }

  private inEditor(e: { clientX: number; clientY: number }) {
    if (!this.editor.visible) return false;
    const { px, py } = this.toCanvasPx(e);
    const r = this.editorRect();
    return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.activePointers++;
    this.navToken++; // any new press supersedes a pending click-pick
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.press = null;
      return;
    }
    const inMap = this.inEditor(e);
    this.press = this.activePointers === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), inMap } : null;
    if (inMap) {
      e.stopImmediatePropagation(); // the editor view is a minimap, not an orbit surface
      e.preventDefault();
    } else {
      this.canvas.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.press?.inMap && this.press.id === e.pointerId) {
      e.stopImmediatePropagation();
      return;
    }
    if (this.activePointers === 0 && e.pointerType === 'mouse') {
      this.canvas.style.cursor = this.inEditor(e) ? 'crosshair' : 'grab';
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.activePointers = Math.max(0, this.activePointers - 1);
    const press = this.press;
    this.press = null;
    this.canvas.style.cursor = this.inEditor(e) ? 'crosshair' : 'grab';
    if (!press || press.id !== e.pointerId) return;
    if (press.inMap) e.stopImmediatePropagation();
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > CLICK_MAX_MOVE_PX || performance.now() - press.t > CLICK_MAX_MS) return;
    if (press.inMap) void this.navigateFromMap(e);
    else void this.navigateFromScene(e);
  };

  private onPointerCancel = () => {
    this.activePointers = Math.max(0, this.activePointers - 1);
    this.press = null;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.inEditor(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.editor.zoom(Math.exp(Math.max(-200, Math.min(200, e.deltaY * unit)) * 0.0015));
    this.needsRender = true;
  };

  /** Click in the scene: fly toward the clicked surface, like the WebGL viewer. */
  private async navigateFromScene(e: PointerEvent) {
    const token = this.navToken;
    const { cssX, cssY, px, py } = this.toCanvasPx(e);
    const [w, h] = this.surf.size;
    const aspect = w / Math.max(h, 1);
    const tan = Math.tan((this.fovDeg * Math.PI) / 360);
    const ray = cameraRay(
      this.view,
      (px / w) * 2 - 1,
      1 - (py / h) * 2,
      aspect,
      this.ortho ? this.controls.distance * tan : tan,
      this.ortho,
      8,
      h,
    );
    const point = await this.pick(ray);
    if (!point || token !== this.navToken) return;
    const eye = this.controls.getPosition();
    const toEye = vec3.sub(eye, point);
    const dist = vec3.length(toEye);
    if (dist < 0.2) return;
    const end = Math.max(dist * TRAVEL_DISTANCE_FACTOR, this.controls.limits.minDistance);
    this.controls.travelTo(point, vec3.add(point, vec3.scale(toEye, end / dist)), TRAVEL_MS);
    this.onNavigate?.({ x: cssX, y: cssY, kind: 'scene' });
  }

  /** Click in the editor view: glide the orbit pivot there, keeping the view angle. */
  private async navigateFromMap(e: PointerEvent) {
    const token = this.navToken;
    const { cssX, cssY, px, py } = this.toCanvasPx(e);
    const ray = this.editor.ray(px, py, this.editorRect());
    // Prefer the splat under the cursor; over empty space, slide along the
    // horizontal plane at the current pivot height (like a game minimap).
    const point = (await this.pick(ray)) ?? intersectPlane(ray, this.controls.up, this.controls.getTarget());
    if (!point || token !== this.navToken) return;
    this.controls.travelPivotTo(point, MAP_TRAVEL_MS);
    this.onNavigate?.({ x: cssX, y: cssY, kind: 'map' });
  }

  private failLoad(error: Error) {
    const pending = this.pendingLoad;
    this.pendingLoad = null;
    pending?.reject(error);
  }

  private createBuffer(label: string, size: number, usage: number) {
    return this.device.createBuffer({ label, size: Math.max(16, Math.ceil(size / 4) * 4), usage });
  }

  /** Grows the splat buffer geometrically, preserving already-uploaded splats on the GPU. */
  private ensureCapacity(splats: number) {
    if (splats <= this.capacity) return;
    const maxSplats = Math.floor(this.device.limits.maxStorageBufferBindingSize / SPLAT_BYTES);
    if (splats > maxSplats) {
      this.failLoad(new Error(`La escena excede la memoria de la GPU (${maxSplats.toLocaleString()} splats máx.)`));
      this.post({ type: 'abort' });
      return;
    }
    const next = Math.min(maxSplats, Math.max(splats, Math.ceil(this.capacity * 1.5)));
    const grown = this.createBuffer('splats', next * SPLAT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    if (this.loadedCount > 0) {
      const encoder = this.device.createCommandEncoder({ label: 'grow-splats' });
      encoder.copyBufferToBuffer(this.splatBuffer, 0, grown, 0, this.loadedCount * SPLAT_BYTES);
      this.device.queue.submit([encoder.finish()]);
    }
    this.splatBuffer.destroy(); // deferred by WebGPU until the copy has executed
    this.splatBuffer = grown;
    this.capacity = next;
    this.splatDraw.set({ splats: this.splatBuffer });
    this.editor.bindBuffers(this.splatBuffer, this.orderBuffer);
    this.ensureOrderCapacity(next);
  }

  private ensureOrderCapacity(count: number) {
    if (count * 4 <= this.orderBuffer.size) return;
    const grown = this.createBuffer('order', Math.max(count, this.capacity) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    if (this.visibleCount > 0) {
      const encoder = this.device.createCommandEncoder({ label: 'grow-order' });
      encoder.copyBufferToBuffer(this.orderBuffer, 0, grown, 0, this.visibleCount * 4);
      this.device.queue.submit([encoder.finish()]);
    }
    this.orderBuffer.destroy();
    this.orderBuffer = grown;
    this.splatDraw.set({ order: this.orderBuffer });
    this.editor.bindBuffers(this.splatBuffer, this.orderBuffer);
  }
}
