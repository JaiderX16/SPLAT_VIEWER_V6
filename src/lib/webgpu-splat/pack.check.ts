/**
 * Autoverificación de pack.ts: el formato de 20 bytes devuelve cada splat casi igual (posición a 1/65535 de la caja
 * de su bloque, escalas a precisión de half float, la misma rotación) y `decompose` recupera la forma de una
 * covarianza (la de una transformación de escena o un splat fusionado del LOD).
 * Ejecutar: node src/lib/webgpu-splat/pack.check.ts
 */
import { BLOCK_FLOATS, BLOCK_SPLATS, decompose, packBlock, quatMatrix, SPLAT_WORDS, unpackSplat } from './pack.ts';

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};

/** Σ = R S² Rᵀ from scales and quaternion bytes (as the shader builds it). */
function covariance(s: ArrayLike<number>, quat: number) {
  const r = quatMatrix(quat, new Float64Array(9));
  const out = new Float64Array(6);
  const idx = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  idx.forEach(([i, j], k) => {
    out[k] = r[i * 3] * r[j * 3] * s[0] ** 2 + r[i * 3 + 1] * r[j * 3 + 1] * s[1] ** 2 + r[i * 3 + 2] * r[j * 3 + 2] * s[2] ** 2;
  });
  return out;
}
const relError = (a: Float64Array, b: Float64Array) => {
  let num = 0, den = 0;
  for (let k = 0; k < 6; k++) {
    const w = k === 1 || k === 2 || k === 4 ? 2 : 1; // off-diagonal entries count twice
    num += w * (a[k] - b[k]) ** 2;
    den += w * b[k] ** 2;
  }
  return Math.sqrt(num / den);
};

// Ida y vuelta: un bloque de splats en una escena de 25 m, tamaños de 0,1 mm a 1 m.
const n = BLOCK_SPLATS;
const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), quats = new Uint32Array(n), colors = new Uint32Array(n);
for (let i = 0; i < n; i++) {
  for (let a = 0; a < 3; a++) {
    positions[i * 3 + a] = rand() * 25 - 12.5;
    scales[i * 3 + a] = 10 ** (-4 + 4 * rand());
  }
  quats[i] = (Math.floor(rand() * 256) | (Math.floor(rand() * 256) << 8) | (Math.floor(rand() * 256) << 16) | (Math.floor(rand() * 256) << 24)) >>> 0;
  colors[i] = (rand() * 4294967296) >>> 0;
}
const words = new Uint32Array(n * SPLAT_WORDS), boxes = new Float32Array(BLOCK_FLOATS);
packBlock(positions, scales, quats, colors, 0, n, words, 0, boxes, 0);
let worstPos = 0, worstScale = 0, sameRotation = true, sameColor = true;
for (let i = 0; i < n; i++) {
  const d = unpackSplat(words, i * SPLAT_WORDS, boxes, 0);
  for (let a = 0; a < 3; a++) {
    worstPos = Math.max(worstPos, Math.abs(d.pos[a] - positions[i * 3 + a]));
    worstScale = Math.max(worstScale, Math.abs(d.scales[a] / scales[i * 3 + a] - 1));
  }
  sameRotation &&= d.quat === quats[i];
  sameColor &&= d.rgba === colors[i];
}
check(worstPos <= 25 / 65535, `posición a ${(worstPos * 1000).toFixed(2)} mm como mucho en 25 m (16 bits por bloque)`);
check(worstScale < 1e-3, `escalas con error relativo de ${(worstScale * 100).toFixed(3)} % como mucho (half float)`);
check(sameRotation && sameColor, 'rotación y color idénticos a los bytes del archivo');

// decompose: covarianzas al azar (rotación y escalas cualesquiera) vuelven a escalas + rotación.
let worstCov = 0;
for (let k = 0; k < 2000; k++) {
  let [w, x, y, z] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
  const l = Math.hypot(w, x, y, z);
  [w, x, y, z] = [w / l, x / l, y / l, z / l];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  const s = [10 ** (-3 + 3 * rand()), 10 ** (-3 + 3 * rand()), 10 ** (-3 + 3 * rand())];
  const c = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([i, j]) => r[i * 3] * r[j * 3] * s[0] ** 2 + r[i * 3 + 1] * r[j * 3 + 1] * s[1] ** 2 + r[i * 3 + 2] * r[j * 3 + 2] * s[2] ** 2);
  const out = new Float32Array(3);
  const q = decompose(c[0], c[1], c[2], c[3], c[4], c[5], out, 0);
  worstCov = Math.max(worstCov, relError(covariance(out, q), Float64Array.from(c)));
}
// The quaternion is stored in bytes (1/128 per component, as in the file): a degree or so off at worst.
check(worstCov < 0.06, `decompose recupera la covarianza (error relativo máx. ${(worstCov * 100).toFixed(2)} %, rotación en bytes)`);
