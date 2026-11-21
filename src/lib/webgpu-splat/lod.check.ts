/**
 * Autoverificación de lod.ts: el árbol reparte todos los splats sin perder ni repetir ninguno, y el splat
 * fusionado de un nodo conserva lo que representa (posición media, color, masa y dispersión de sus hijos).
 * Ejecutar: node src/lib/webgpu-splat/lod.check.ts
 */
import { buildLod, LEAF_SPLATS } from './lod.ts';

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};
/** Quaternion bytes of the identity rotation: w = 1 → 255, x = y = z = 0 → 128. */
const QUAT_W1 = (255 | (128 << 8) | (128 << 16) | (128 << 24)) >>> 0;

function scene(n: number) {
  const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), quats = new Uint32Array(n), colors = new Uint32Array(n), radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // A room-like cloud: most splats on six walls, some inside.
    const wall = Math.floor(rand() * 7);
    const p = [rand() * 8 - 4, rand() * 3, rand() * 6 - 3];
    if (wall < 6) p[wall >> 1] = wall & 1 ? [4, 3, 3][wall >> 1] : [-4, 0, -3][wall >> 1];
    positions.set(p, i * 3);
    const s = 0.002 + rand() * 0.02;
    scales.set([s, s, s * 0.2], i * 3);
    quats[i] = QUAT_W1;
    colors[i] = (Math.floor(rand() * 256) | (Math.floor(rand() * 256) << 8) | (Math.floor(rand() * 256) << 16) | ((20 + Math.floor(rand() * 235)) << 24)) >>> 0;
    radii[i] = s;
  }
  return { positions, scales, quats, colors, radii };
}

// 1. Todos los splats, una sola vez, en cualquier corte del árbol.
const n = 200_000;
const s = scene(n);
const t0 = performance.now();
const tree = buildLod(s.positions, s.scales, s.quats, s.colors, s.radii, n, [-4.1, -0.1, -3.1], [8.2, 8.2, 8.2]);
const ms = performance.now() - t0;
console.log(`árbol: ${tree.nodes} nodos para ${n} splats (${((100 * tree.nodes) / n).toFixed(1)} % de splats fusionados extra), ${ms.toFixed(0)} ms`);
let leavesOk = true;
for (let k = 0; k < tree.nodes; k++) if (tree.child[k] < 0 && tree.size[k] > LEAF_SPLATS) leavesOk = false;
check(leavesOk, `ninguna hoja pasa de ${LEAF_SPLATS} splats`);
for (const limit of [0, 0.01, 0.05, 0.2, Infinity]) {
  const seen = new Uint8Array(n);
  let drawn = 0, twice = false;
  const stack = [0];
  while (stack.length) {
    const k = stack.pop()!;
    if (tree.radius[k] < limit) {
      drawn++;
      for (let j = tree.first[k]; j < tree.first[k] + tree.size[k]; j++) twice ||= seen[tree.perm[j]]++ > 0;
    } else if (tree.child[k] < 0) {
      for (let j = tree.first[k]; j < tree.first[k] + tree.size[k]; j++, drawn++) twice ||= seen[tree.perm[j]]++ > 0;
    } else {
      for (let c = tree.child[k]; c < tree.child[k] + tree.children[k]; c++) stack.push(c);
    }
  }
  check(!twice && seen.every((v) => v === 1), `corte con radio < ${limit}: ${drawn} splats dibujados, cada original representado una vez`);
}

// 2. Fusión de dos splats iguales separados 1 m en x: centro en medio, dispersión (0,5 m)² + σ², mismo color.
const two = {
  positions: Float32Array.from([0, 0, 0, 1, 0, 0]), scales: Float32Array.from([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
  quats: Uint32Array.from([QUAT_W1, QUAT_W1]), colors: Uint32Array.from([(200 | (100 << 8) | (50 << 16) | (128 << 24)) >>> 0, (200 | (100 << 8) | (50 << 16) | (128 << 24)) >>> 0]),
  radii: Float32Array.from([0.1, 0.1]),
};
const t2 = buildLod(two.positions, two.scales, two.quats, two.colors, two.radii, 2, [-1, -1, -1], [3, 3, 3]);
const sx = t2.scales[0], sy = t2.scales[1], sz = t2.scales[2];
const big = Math.max(sx, sy, sz), small = Math.min(sx, sy, sz);
check(Math.abs(t2.mean[0] - 0.5) < 1e-6 && Math.abs(t2.mean[1]) < 1e-6, 'el fusionado queda en el centro de masas');
check(Math.abs(big - Math.sqrt(0.25 + 0.01)) < 1e-4 && Math.abs(small - 0.1) < 1e-4, `su forma suma la separación de los hijos (σ ${big.toFixed(3)} × ${small.toFixed(3)})`);
check((t2.colors[0] & 0xffffff) === (two.colors[0] & 0xffffff), 'el color se conserva');
// Same mass (opacity × area): the merged splat is bigger, so it is fainter than the two together.
const a = (t2.colors[0] >>> 24) / 255, area = Math.PI * Math.sqrt(sx * sx * sy * sy + sx * sx * sz * sz + sy * sy * sz * sz);
const children = 2 * (128 / 255) * Math.PI * Math.sqrt(3 * 0.1 ** 4);
check(Math.abs(a * area - children) / children < 0.01, `conserva la masa (opacidad × área): ${(a * area).toFixed(4)} frente a ${children.toFixed(4)}`);
