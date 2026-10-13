import { draw } from 'vgpu';
import type { Draw, Frame, Gpu, Surface } from 'vgpu';
import splatShader from './splat.wgsl';
import helpersShader from './helpers.wgsl';
import overlayShader from './overlay.wgsl';
import { cameraRay, lookAt, multiply, perspective, vec3, type Ray, type Vec3 } from './math';

/** Picture-in-picture layout, shared with the CSS frame drawn by the host page. */
export const EDITOR_VIEW_LAYOUT = {
  /** Fraction of the canvas width/height. */
  FRACTION: 0.3,
  MIN_CSS: 120,
  MARGIN_CSS: 12,
};

const GRID_DIVISIONS = 14;
const GRID_HALF_SIZE = 7;
const OVERVIEW_FOV_DEG = 45;
const MIN_DISTANCE = 3;
const MAX_DISTANCE = 60;

export interface MainCameraState {
  view: Float32Array;
  fovDeg: number;
  aspect: number;
  ortho: boolean;
  /** Orbit distance (frustum depth and ortho half-height scale). */
  distance: number;
  splatScale: number;
  pointCloud: boolean;
  visibleCount: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Editor view ("scene view" of game engines) rendered as a picture-in-picture
 * pass on the same canvas: an overview camera that shows the ground grid, the
 * main camera's frustum and a camera gizmo, plus the splats the main camera is
 * currently drawing (it reuses the main, frustum-culled order — so the culling
 * is visible). Clicks inside it are turned into world-space rays for
 * minimap-style navigation.
 */
export class EditorView {
  visible = false;
  /** Overview camera orbits the world origin at this distance (wheel-adjustable). */
  private distance = 8;
  private readonly up: Vec3;
  private readonly splatDraw: Draw;
  private readonly gridDraw: Draw;
  private readonly backgroundDraw: Draw;
  private readonly frustumDraw: Draw;
  private readonly gizmoDraw: Draw;

  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);
  private aspect = 1;

  constructor(gpu: Gpu, up: Vec3) {
    this.up = up;
    this.splatDraw = draw(gpu, { label: 'editor-splats', shader: splatShader, vertices: 6, instances: 0, blend: 'premultiplied' });
    this.gridDraw = draw(gpu, {
      label: 'editor-grid',
      shader: helpersShader,
      entry: { vertex: 'vs_grid' },
      geometry: { topology: 'line-list', vertexCount: (GRID_DIVISIONS + 1) * 2 * 2 },
      blend: 'premultiplied',
    });
    this.backgroundDraw = draw(gpu, {
      label: 'editor-background',
      shader: overlayShader,
      entry: { vertex: 'vs_fullscreen' },
      vertices: 3,
    });
    this.frustumDraw = draw(gpu, {
      label: 'editor-frustum',
      shader: overlayShader,
      entry: { vertex: 'vs_points' },
      geometry: { topology: 'line-list', vertexCount: 24 },
      blend: 'premultiplied',
    });
    this.gizmoDraw = draw(gpu, {
      label: 'editor-gizmo',
      shader: overlayShader,
      entry: { vertex: 'vs_points' },
      vertices: 18,
      blend: 'premultiplied',
    });
  }

  bindBuffers(splats: GPUBuffer, order: GPUBuffer) {
    this.splatDraw.set({ splats, order });
  }

  compile(surf: Surface) {
    return Promise.all([
      this.splatDraw.compile(surf),
      this.gridDraw.compile(surf),
      this.backgroundDraw.compile(surf),
      this.frustumDraw.compile(surf),
      this.gizmoDraw.compile(surf),
    ]);
  }

  dispose() {
    for (const d of [this.splatDraw, this.gridDraw, this.backgroundDraw, this.frustumDraw, this.gizmoDraw]) d.dispose();
  }

  /** Rectangle in physical pixels, WebGPU convention (origin top-left). */
  rect(width: number, height: number, dpr: number): PixelRect {
    const w = Math.round(Math.max(EDITOR_VIEW_LAYOUT.MIN_CSS * dpr, width * EDITOR_VIEW_LAYOUT.FRACTION));
    const h = Math.round(Math.max(EDITOR_VIEW_LAYOUT.MIN_CSS * dpr, height * EDITOR_VIEW_LAYOUT.FRACTION));
    const m = Math.round(EDITOR_VIEW_LAYOUT.MARGIN_CSS * dpr);
    return { x: Math.max(0, width - w - m), y: Math.max(0, height - h - m), width: Math.min(w, width), height: Math.min(h, height) };
  }

  /** Zooms the overview camera (wheel over the picture-in-picture). */
  zoom(factor: number) {
    this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.distance * factor));
  }

  /** World ray through a point of the overview, in physical pixels of the canvas. */
  ray(px: number, py: number, rect: PixelRect): Ray {
    const ndcX = ((px - rect.x) / rect.width) * 2 - 1;
    const ndcY = 1 - ((py - rect.y) / rect.height) * 2;
    return cameraRay(this.view, ndcX, ndcY, this.aspect, Math.tan((OVERVIEW_FOV_DEG * Math.PI) / 360), false, 6, rect.height);
  }

  render(frame: Frame, surf: Surface, rect: PixelRect, main: MainCameraState) {
    this.updateCamera(rect);
    const main3 = mainBasis(main.view);
    const frustum = frustumLines(main3, main);
    const gizmo = cameraGizmo(main3, this.distance * 0.035);

    this.gridDraw.set({ helpers: { viewProj: this.viewProj, params: [GRID_HALF_SIZE, GRID_DIVISIONS, 1, 0] } });
    this.backgroundDraw.set({ overlay: { viewProj: this.viewProj, color: [0.047, 0.051, 0.071, 1], points: frustum } });
    this.frustumDraw.set({ overlay: { viewProj: this.viewProj, color: [0.133, 0.827, 0.933, 0.95], points: frustum } });
    this.gizmoDraw.set({ overlay: { viewProj: this.viewProj, color: [0.98, 0.8, 0.08, 1], points: gizmo } });
    this.splatDraw.set({
      camera: {
        view: this.view,
        proj: this.proj,
        viewport: [rect.width, rect.height],
        focal: [(this.proj[0] * rect.width) / 2, (this.proj[5] * rect.height) / 2],
        params: [main.splatScale, main.pointCloud ? 1 : 0, 0, Math.tan((OVERVIEW_FOV_DEG * Math.PI) / 360) * Math.max(1, this.aspect)],
      },
    });

    frame.pass(
      {
        target: surf,
        clear: false,
        viewport: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scissor: [rect.x, rect.y, rect.width, rect.height],
      },
      (pass) => {
        pass.draw(this.backgroundDraw);
        pass.draw(this.gridDraw);
        if (main.visibleCount > 0) pass.draw(this.splatDraw, { instances: main.visibleCount });
        pass.draw(this.frustumDraw);
        pass.draw(this.gizmoDraw);
      },
    );
  }

  private updateCamera(rect: PixelRect) {
    this.aspect = rect.width / Math.max(rect.height, 1);
    // Elevated three-quarter vantage point, "above" according to the scene's up.
    const horizontal = vec3.normalize(vec3.sub([1, 0, 1], vec3.scale(this.up, vec3.dot([1, 0, 1], this.up))));
    const dir = vec3.normalize(vec3.add(vec3.scale(horizontal, 0.8), vec3.scale(this.up, 1.0)));
    lookAt(vec3.scale(dir, this.distance), [0, 0, 0], this.up, this.view);
    perspective((OVERVIEW_FOV_DEG * Math.PI) / 180, this.aspect, 0.1, 500, this.proj);
    multiply(this.proj, this.view, this.viewProj);
  }
}

interface Basis {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

function mainBasis(view: Float32Array): Basis {
  const right: Vec3 = [view[0], view[4], view[8]];
  const up: Vec3 = [view[1], view[5], view[9]];
  const back: Vec3 = [view[2], view[6], view[10]];
  const t: Vec3 = [view[12], view[13], view[14]];
  const eye: Vec3 = [
    -(right[0] * t[0] + up[0] * t[1] + back[0] * t[2]),
    -(right[1] * t[0] + up[1] * t[1] + back[1] * t[2]),
    -(right[2] * t[0] + up[2] * t[1] + back[2] * t[2]),
  ];
  return { eye, right, up, forward: vec3.scale(back, -1) };
}

type Point4 = [number, number, number, number];

/** 12 frustum edges as 24 line-list points. */
function frustumLines(b: Basis, main: MainCameraState): Point4[] {
  const near = 0.1;
  const far = Math.max(2, main.distance * 1.25);
  const tan = Math.tan((main.fovDeg * Math.PI) / 360);
  const half = (d: number): [number, number] => {
    const h = main.ortho ? main.distance * tan : d * tan;
    return [h * main.aspect, h];
  };
  const corner = (d: number, sx: number, sy: number): Point4 => {
    const [hw, hh] = half(d);
    const p = vec3.add(b.eye, vec3.add(vec3.scale(b.forward, d), vec3.add(vec3.scale(b.right, sx * hw), vec3.scale(b.up, sy * hh))));
    return [p[0], p[1], p[2], 1];
  };
  const n = [corner(near, -1, -1), corner(near, 1, -1), corner(near, 1, 1), corner(near, -1, 1)];
  const f = [corner(far, -1, -1), corner(far, 1, -1), corner(far, 1, 1), corner(far, -1, 1)];
  const out: Point4[] = [];
  for (let i = 0; i < 4; i++) out.push(n[i], n[(i + 1) % 4]);
  for (let i = 0; i < 4; i++) out.push(f[i], f[(i + 1) % 4]);
  for (let i = 0; i < 4; i++) out.push(n[i], f[i]);
  return out;
}

/** Pyramid pointing along the view direction (18 triangle-list points, padded to 24). */
function cameraGizmo(b: Basis, size: number): Point4[] {
  const p = (v: Vec3): Point4 => [v[0], v[1], v[2], 1];
  const apex = vec3.add(b.eye, vec3.scale(b.forward, size * 1.6));
  const c = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => vec3.add(b.eye, vec3.add(vec3.scale(b.right, sx * size * 0.5), vec3.scale(b.up, sy * size * 0.5))));
  const out: Point4[] = [];
  for (let i = 0; i < 4; i++) out.push(p(apex), p(c[i]), p(c[(i + 1) % 4]));
  out.push(p(c[0]), p(c[1]), p(c[2]), p(c[0]), p(c[2]), p(c[3]));
  while (out.length < 24) out.push(p(b.eye));
  return out;
}
