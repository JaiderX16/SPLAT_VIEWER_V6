import type { Vec3 } from './math';

/**
 * Colisiones de la navegación interior.
 *
 * Gaussian Splatting no trae malla, así que la geometría auxiliar es una rejilla de vóxeles hecha con
 * la opacidad de los splats: un vóxel es sólido cuando sus splats suman al menos la opacidad de un
 * splat que el toque reconoce como superficie (SURFACE_ALPHA). La cámara choca así con lo mismo que
 * el toque detecta, y también con suelos y paredes hechos de muchos splats semitransparentes, que el
 * rayo del toque atraviesa.
 *
 * La rejilla se construye en el worker (que tiene las posiciones) y se consulta en el hilo principal
 * sin esperas: rayos, suelo bajo un punto y el volumen de la cámara.
 */

/** Opacidad (0–255) de un splat que el toque reconoce como superficie. */
export const SURFACE_ALPHA = 100;
/** Vóxeles en el lado más largo de la escena (≈4 cm en una sala de 8 m). */
const GRID_CELLS = 192;
/** Con menos vóxeles sólidos que esto el cuerpo cabe: tolera splats sueltos en el aire. */
const BLOCKING_VOXELS = 3;

export interface VoxelGridData {
  /** Esquina mínima de la rejilla. */
  origin: Vec3;
  /** Lado de un vóxel, en unidades de la escena. */
  voxel: number;
  dims: Vec3;
  /** Un bit por vóxel; índice (z · ny + y) · nx + x. */
  bits: Uint8Array;
}

/** Medidas de quien recorre el interior, en unidades de la escena. */
export interface Body {
  /** Altura de los ojos sobre el suelo. */
  eye: number;
  /** Radio del volumen de la cámara: un cilindro de ±radius alrededor de los ojos. Lo que queda debajo se sobrevuela. */
  radius: number;
  /** Tolerancia de altura del suelo: al buscar dónde aterrizar y para que un toque cuente como suelo. */
  step: number;
}

/** Rejilla de ocupación de la escena (en el worker). Null si no hay splats suficientes. */
export function buildVoxelGrid(positions: Float32Array, alphas: Uint8Array, count: number): VoxelGridData | null {
  // Caja robusta: 0,5–99,5 % de una muestra de splats visibles; los flotantes lejanos quedan fuera (aire).
  const stride = Math.max(1, Math.floor(count / 100_000));
  const sample: number[][] = [[], [], []];
  for (let i = 0; i < count; i += stride) {
    if (alphas[i] < 50) continue;
    for (let a = 0; a < 3; a++) sample[a].push(positions[i * 3 + a]);
  }
  if (sample[0].length < 100) return null;
  const origin: Vec3 = [0, 0, 0];
  const size: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const s = Float32Array.from(sample[a]).sort();
    const lo = s[Math.floor(s.length * 0.005)];
    const hi = s[Math.floor(s.length * 0.995)];
    const pad = (hi - lo) * 0.05;
    origin[a] = lo - pad;
    size[a] = hi - lo + 2 * pad;
  }
  const voxel = Math.max(...size) / GRID_CELLS;
  if (!(voxel > 0)) return null;
  const dims: Vec3 = [Math.ceil(size[0] / voxel), Math.ceil(size[1] / voxel), Math.ceil(size[2] / voxel)];
  const [nx, ny, nz] = dims;
  const opacity = new Uint16Array(nx * ny * nz);
  for (let i = 0; i < count; i++) {
    const x = Math.floor((positions[i * 3] - origin[0]) / voxel);
    const y = Math.floor((positions[i * 3 + 1] - origin[1]) / voxel);
    const z = Math.floor((positions[i * 3 + 2] - origin[2]) / voxel);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    const k = (z * ny + y) * nx + x;
    opacity[k] = Math.min(65535, opacity[k] + alphas[i]);
  }
  const bits = new Uint8Array((opacity.length + 7) >> 3);
  for (let k = 0; k < opacity.length; k++) if (opacity[k] >= SURFACE_ALPHA) bits[k >> 3] |= 1 << (k & 7);
  return { origin, voxel, dims, bits };
}

/** Bajo el suelo, lo que queda por debajo de donde la densidad cae a esta fracción del pico del suelo. */
const CUT_DENSITY = 0.002;
/** …y sigue así este número de capas seguidas (un hueco suelto no corta). */
const CUT_RUN = 3;

/**
 * Altura del corte "bajo el suelo" (a lo largo de `up`: sign × position[axis]). Un suelo de escaneo no es una
 * lámina: tiene grosor y, si brilla, su reflejo vive en splats por debajo (en una sala medida, hasta ~40 cm).
 * Se recorre hacia abajo el histograma de alturas (capas de ¼ de vóxel) desde el pico del suelo hasta que la
 * densidad cae a CUT_DENSITY del pico durante CUT_RUN capas: lo de más abajo es ruido suelto. En la sala medida
 * corta a 44 cm (la imagen no cambia); un margen fijo de 2 vóxeles (9 cm) se comía el reflejo del suelo.
 */
export function floorCutHeight(positions: Float32Array, count: number, axis: number, sign: number, floor: number, voxel: number) {
  const bin = voxel / 4;
  const bottom = floor - 40 * voxel;
  const counts = new Uint32Array(Math.ceil((42 * voxel) / bin));
  for (let i = 0; i < count; i++) {
    const k = Math.floor((sign * positions[i * 3 + axis] - bottom) / bin);
    if (k >= 0 && k < counts.length) counts[k]++;
  }
  // El pico del suelo, cerca de la cara de arriba de la capa detectada.
  let peak = 0, at = counts.length - 1;
  for (let k = Math.floor((36 * voxel) / bin); k < counts.length; k++) if (counts[k] > peak) [peak, at] = [counts[k], k];
  let run = 0;
  for (let k = at; k >= 0; k--) {
    run = counts[k] < peak * CUT_DENSITY ? run + 1 : 0;
    if (run === CUT_RUN) return bottom + (k + CUT_RUN) * bin;
  }
  return bottom;
}

/**
 * Consultas de colisión sobre la rejilla. Las alturas se miden a lo largo de `up`, que debe seguir un
 * eje de la escena (la rejilla está alineada con los ejes).
 */
export class CollisionGrid {
  /** Altura del suelo y del techo de la planta principal (las capas más llenas); null si no destacan. */
  readonly floor: number | null;
  readonly ceiling: number | null;
  readonly voxel: number;
  private readonly origin: Vec3;
  private readonly dims: Vec3;
  private readonly bits: Uint8Array;
  private readonly stride: Vec3;
  /** Eje vertical, su signo respecto a `up` y los dos ejes horizontales. */
  readonly axis: number;
  readonly sign: number;
  private readonly f0: number;
  private readonly f1: number;

  /** Null si `up` no sigue un eje de la escena. */
  static create(data: VoxelGridData, up: Vec3): CollisionGrid | null {
    const axis = up.findIndex((c) => Math.abs(c) > 0.99);
    return axis < 0 ? null : new CollisionGrid(data, axis, Math.sign(up[axis]));
  }

  private constructor(data: VoxelGridData, axis: number, sign: number) {
    this.origin = data.origin;
    this.voxel = data.voxel;
    this.dims = data.dims;
    this.bits = data.bits;
    this.stride = [1, data.dims[0], data.dims[0] * data.dims[1]];
    this.axis = axis;
    this.sign = sign;
    [this.f0, this.f1] = [0, 1, 2].filter((a) => a !== axis);
    const storey = this.storey();
    this.floor = storey[0];
    this.ceiling = storey[1];
  }

  /**
   * Unidades de la escena por metro, por la altura de la planta: entre 2,2 y 3,6 la escena ya está en
   * metros (la mayoría de escaneos de móvil); si no, se supone una sala de 2,7 m. Null sin techo.
   */
  get unitsPerMeter(): number | null {
    if (this.floor === null || this.ceiling === null) return null;
    const h = this.ceiling - this.floor;
    return h >= 2.2 && h <= 3.6 ? 1 : h / 2.7;
  }

  /** Altura de `p` a lo largo de `up`. */
  height(p: Vec3) {
    return this.sign * p[this.axis];
  }

  /** Suelo bajo `p`: la cara de arriba del vóxel sólido más alto en `near ± reach`, con las columnas vecinas para saltar huecos del escaneo. */
  groundAt(p: Vec3, near: number, reach: number): number | null {
    const u = this.cell(p[this.f0], this.f0);
    const w = this.cell(p[this.f1], this.f1);
    const [lo, hi] = this.layers(near - reach, near + reach);
    for (let s = 0; s <= hi - lo; s++) {
      const i = this.sign > 0 ? hi - s : lo + s; // de arriba abajo
      for (let du = -1; du <= 1; du++) {
        for (let dw = -1; dw <= 1; dw++) if (this.test(i, u + du, w + dw)) return this.layerTop(i);
      }
    }
    return null;
  }

  /**
   * Si la cámara cabe a la altura de los ojos de alguien de pie en `feet`: un cilindro de ±radius
   * alrededor de los ojos. Lo que hay más abajo (muebles, cosas en el suelo) no la frena.
   */
  bodyFree(feet: Vec3, body: Body): boolean {
    const g = this.height(feet);
    const [lo, hi] = this.layers(g + body.eye - body.radius, g + body.eye + body.radius);
    const r = body.radius;
    const u0 = this.cell(feet[this.f0] - r, this.f0), u1 = this.cell(feet[this.f0] + r, this.f0);
    const w0 = this.cell(feet[this.f1] - r, this.f1), w1 = this.cell(feet[this.f1] + r, this.f1);
    let solid = 0;
    for (let u = u0; u <= u1; u++) {
      const du = this.origin[this.f0] + (u + 0.5) * this.voxel - feet[this.f0];
      for (let w = w0; w <= w1; w++) {
        const dw = this.origin[this.f1] + (w + 0.5) * this.voxel - feet[this.f1];
        if (du * du + dw * dw > r * r) continue;
        for (let i = lo; i <= hi; i++) if (this.test(i, u, w) && ++solid >= BLOCKING_VOXELS) return false;
      }
    }
    return true;
  }

  /**
   * Camina en línea recta de `from` a `to` a la altura de `from` (pies) y devuelve dónde se para:
   * antes del primer obstáculo a la altura de la cámara, o en `to`. No sigue lo que hay debajo: la
   * cámara no se sube a los muebles. Si empieza atascada dentro de algo, avanza libre hasta salir.
   * shortcut: altura fija, sin escaleras entre plantas; seguir el suelo pediría distinguir escalones de muebles.
   */
  walk(from: Vec3, to: Vec3, body: Body): Vec3 {
    const steps = Math.ceil(Math.hypot(to[this.f0] - from[this.f0], to[this.f1] - from[this.f1]) / this.voxel);
    const h = this.height(from);
    let pos = from;
    let free = this.bodyFree(from, body);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const feet = this.withHeight([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], h);
      const fits = this.bodyFree(feet, body);
      if (free && !fits) break;
      free ||= fits;
      pos = feet;
    }
    return pos;
  }

  /** Como `walk`, pero al chocar conserva la parte del paso que va a lo largo de cada eje horizontal: se desliza por las paredes. */
  slide(from: Vec3, to: Vec3, body: Body): Vec3 {
    let p = this.walk(from, to, body);
    for (const a of [this.f0, this.f1]) {
      if (Math.abs(to[a] - p[a]) < 1e-9) continue;
      const q: Vec3 = [p[0], p[1], p[2]];
      q[a] = to[a];
      p = this.walk(p, q, body);
    }
    return p;
  }

  /**
   * El sitio más cercano a `near` (buscando en anillos hasta `maxRadius`) con suelo cerca de `ground`,
   * donde cabe la cámara y, si la escena tiene techo, bajo techo: no aterriza fuera de las salas.
   */
  findStand(near: Vec3, ground: number, body: Body, maxRadius: number): Vec3 | null {
    const step = Math.max(this.voxel * 2, body.radius / 2);
    for (let r = 0; r <= maxRadius; r += step) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / step);
      for (let k = 0; k < n; k++) {
        const angle = (k / n) * 2 * Math.PI;
        const p: Vec3 = [near[0], near[1], near[2]];
        p[this.f0] += Math.cos(angle) * r;
        p[this.f1] += Math.sin(angle) * r;
        // Sin suelo debajo no se aterriza: sería el vacío fuera del escaneo.
        const g = this.groundAt(p, ground, body.step);
        if (g === null) continue;
        const feet = this.withHeight(p, g);
        if (this.bodyFree(feet, body) && this.roofed(feet, body)) return feet;
      }
    }
    return null;
  }

  /** Hay algo sólido sobre la cabeza, hasta dos alturas de planta (siempre cierto en escenas sin techo). */
  private roofed(feet: Vec3, body: Body): boolean {
    if (this.floor === null || this.ceiling === null) return true;
    const g = this.height(feet);
    const [lo, hi] = this.layers(g + body.eye + body.radius, g + 2 * (this.ceiling - this.floor));
    const u = this.cell(feet[this.f0], this.f0);
    const w = this.cell(feet[this.f1], this.f1);
    for (let i = lo; i <= hi; i++) {
      for (let du = -1; du <= 1; du++) {
        for (let dw = -1; dw <= 1; dw++) if (this.test(i, u + du, w + dw)) return true;
      }
    }
    return false;
  }

  /**
   * Primer vóxel sólido que cruza el rayo (punto de entrada), o null. `dir` unitario. Los vóxeles
   * sólidos del principio se saltan: un rayo que nace dentro de algo no se queda pegado.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist = Infinity): Vec3 | null {
    const o = this.origin, v = this.voxel, d = this.dims;
    let t0 = 0;
    let t1 = maxDist;
    for (let a = 0; a < 3; a++) {
      const lo = o[a], hi = o[a] + d[a] * v;
      if (Math.abs(dir[a]) < 1e-12) {
        if (origin[a] < lo || origin[a] > hi) return null;
        continue;
      }
      const ta = (lo - origin[a]) / dir[a], tb = (hi - origin[a]) / dir[a];
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) return null;
    }
    const c: Vec3 = [0, 0, 0], step: Vec3 = [0, 0, 0], next: Vec3 = [0, 0, 0], delta: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      c[a] = Math.min(d[a] - 1, Math.max(0, Math.floor((origin[a] + dir[a] * t0 - o[a]) / v)));
      step[a] = dir[a] > 0 ? 1 : dir[a] < 0 ? -1 : 0;
      next[a] = step[a] === 0 ? Infinity : (o[a] + (c[a] + (step[a] > 0 ? 1 : 0)) * v - origin[a]) / dir[a];
      delta[a] = step[a] === 0 ? Infinity : v / Math.abs(dir[a]);
    }
    let t = t0;
    let leftSolid = false;
    while (t <= t1) {
      const k = c[0] * this.stride[0] + c[1] * this.stride[1] + c[2] * this.stride[2];
      if (this.bits[k >> 3] & (1 << (k & 7))) {
        if (leftSolid) return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      } else {
        leftSolid = true;
      }
      const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
      t = next[a];
      c[a] += step[a];
      if (c[a] < 0 || c[a] >= d[a]) return null;
      next[a] += delta[a];
    }
    return null;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────
  /** Suelo y techo: las capas horizontales con más vóxeles sólidos de la mitad baja y de la alta. */
  private storey(): [number | null, number | null] {
    const [nx, ny, nz] = this.dims;
    const counts = new Uint32Array(this.dims[this.axis]);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const k = (z * ny + y) * nx + x;
          if (this.bits[k >> 3] & (1 << (k & 7))) counts[this.axis === 0 ? x : this.axis === 1 ? y : z]++;
        }
      }
    }
    const used = [...counts.keys()].filter((i) => counts[i] > 0);
    if (used.length < 3) return [null, null];
    const mid = (this.layerTop(used[0]) + this.layerTop(used[used.length - 1])) / 2;
    const busy = used.map((i) => counts[i]).sort((a, b) => a - b);
    const prominent = 2 * busy[busy.length >> 1];
    let floor = -1, ceiling = -1;
    for (const i of used) {
      const low = this.layerTop(i) < mid;
      if (low && (floor < 0 || counts[i] > counts[floor])) floor = i;
      if (!low && (ceiling < 0 || counts[i] > counts[ceiling])) ceiling = i;
    }
    return [
      floor >= 0 && counts[floor] >= prominent ? this.layerTop(floor) : null,
      ceiling >= 0 && counts[ceiling] >= prominent ? this.layerTop(ceiling) - this.voxel : null,
    ];
  }

  private cell(coord: number, a: number) {
    return Math.floor((coord - this.origin[a]) / this.voxel);
  }

  /** Capas (índices a lo largo del eje vertical) que cubren las alturas de `a` a `b`. */
  private layers(a: number, b: number): [number, number] {
    const i = this.cell(a * this.sign, this.axis), j = this.cell(b * this.sign, this.axis);
    return [Math.max(0, Math.min(i, j)), Math.min(this.dims[this.axis] - 1, Math.max(i, j))];
  }

  /** Altura de la cara de arriba de la capa `i`. */
  private layerTop(i: number) {
    const c = this.origin[this.axis] + i * this.voxel;
    return Math.max(this.sign * c, this.sign * (c + this.voxel));
  }

  private withHeight(p: Vec3, h: number): Vec3 {
    const out: Vec3 = [p[0], p[1], p[2]];
    out[this.axis] = h * this.sign;
    return out;
  }

  /** Vóxel sólido en la capa `i` y las columnas horizontales `u`, `w`. Fuera de la rejilla es aire. */
  private test(i: number, u: number, w: number) {
    if (i < 0 || u < 0 || w < 0 || i >= this.dims[this.axis] || u >= this.dims[this.f0] || w >= this.dims[this.f1]) return false;
    const k = i * this.stride[this.axis] + u * this.stride[this.f0] + w * this.stride[this.f1];
    return (this.bits[k >> 3] & (1 << (k & 7))) !== 0;
  }
}
