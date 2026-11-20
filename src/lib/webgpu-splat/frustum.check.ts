/**
 * Autoverificación de frustum.ts: ningún splat que dibuje algo en pantalla puede descartarse.
 * Para splats aleatorios (posición, escalas y rotación) se calcula el cuadrilátero exacto que dibuja
 * splat.wgsl y se comprueba que todo el que toca la pantalla pasa `reachesScreen`, también si la cámara
 * se ha movido `travel` desde el sort. Ejecutar: node src/lib/webgpu-splat/frustum.check.ts
 */
import { frustumTest, reachesScreen, type FrustumParams } from './frustum.ts';
import { lookAt, multiply, perspective, type Vec3 } from './math.ts';

let seed = 3;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** NDC bounding box of the quad splat.wgsl draws, or null when it draws nothing. */
function drawnBox(pos: Vec3, m: number[], view: Float32Array, proj: Float32Array, w: number, h: number) {
  const [x, y, z] = pos;
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  if (vz > -0.05) return null;
  const d = -vz;
  const nx = (proj[0] * vx) / d, ny = (proj[5] * vy) / d;
  if (Math.abs(nx) > 1.5 || Math.abs(ny) > 1.5) return null;
  const fx = (proj[0] * w) / 2, fy = (proj[5] * h) / 2;
  const lim = 1.3 * (1 / proj[5]) * Math.max(1, w / h);
  const tx = Math.min(Math.max(vx / d, -lim), lim) * d, ty = Math.min(Math.max(vy / d, -lim), lim) * d;
  const J = [[fx / d, 0, (fx * tx) / (d * d)], [0, fy / d, (fy * ty) / (d * d)]];
  const R = [[view[0], view[4], view[8]], [view[1], view[5], view[9]], [view[2], view[6], view[10]]];
  const T = J.map((row) => [0, 1, 2].map((c) => row[0] * R[0][c] + row[1] * R[1][c] + row[2] * R[2][c]));
  const S = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[r * 3] * m[c * 3] + m[r * 3 + 1] * m[c * 3 + 1] + m[r * 3 + 2] * m[c * 3 + 2]));
  const q = (a: number[], b: number[]) => [0, 1, 2].reduce((s, i) => s + a[i] * [0, 1, 2].reduce((t, j) => t + S[i][j] * b[j], 0), 0);
  const ca = q(T[0], T[0]) + 0.3, cb = q(T[0], T[1]), cc = q(T[1], T[1]) + 0.3;
  const mid = (ca + cc) / 2, rad = Math.hypot((ca - cc) / 2, cb), l1 = mid + rad, l2 = mid - rad;
  const dl = Math.hypot(cb, l1 - ca), dg = dl > 1e-8 ? [cb / dl, (l1 - ca) / dl] : [1, 0];
  const a1 = Math.min(Math.sqrt(2 * l1), 1024), a2 = Math.min(Math.sqrt(2 * l2), 1024);
  const ex = 2 * (Math.abs(a1 * dg[0]) + Math.abs(a2 * dg[1])), ey = 2 * (Math.abs(a1 * dg[1]) + Math.abs(a2 * dg[0]));
  return [nx - (2 * ex) / w, ny - (2 * ey) / h, nx + (2 * ex) / w, ny + (2 * ey) / h];
}

let drawn = 0, dropped = 0, wrong = 0, total = 0;
for (const [w, h] of [[1920, 1080], [390, 844]]) {
  const proj = perspective((50 * Math.PI) / 180, w / h, 0.05, 1000, new Float32Array(16));
  for (let cam = 0; cam < 8; cam++) {
    const eye: Vec3 = [rand() * 4 - 2, rand() * 2 - 1, rand() * 4 - 2];
    const target: Vec3 = [eye[0] + rand() * 2 - 1, eye[1] + rand() - 0.5, eye[2] + rand() * 2 - 1];
    // Later pose the list must still cover: still, sideways, forward, backward.
    const travel = cam % 4 ? 0.15 : 0;
    const look = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const ll = Math.hypot(look[0], look[1], look[2]);
    const dir: Vec3 = cam % 4 === 1 ? [1, 0, 0] : [(look[0] / ll) * (cam % 4 === 2 ? 1 : -1), (look[1] / ll) * (cam % 4 === 2 ? 1 : -1), (look[2] / ll) * (cam % 4 === 2 ? 1 : -1)];
    const moved: Vec3 = [eye[0] + dir[0] * travel, eye[1] + dir[1] * travel, eye[2] + dir[2] * travel];
    const view = lookAt(eye, target, [0, 1, 0], new Float32Array(16));
    const later = lookAt(moved, [target[0] + dir[0] * travel, target[1] + dir[1] * travel, target[2] + dir[2] * travel], [0, 1, 0], new Float32Array(16));
    const vp = multiply(proj, view, new Float32Array(16));
    const params: FrustumParams = { margin: 0.05, travel, scaleX: proj[0], scaleY: proj[5] };
    for (let k = 0; k < 20000; k++) {
      const pos: Vec3 = [rand() * 12 - 6, rand() * 6 - 3, rand() * 12 - 6];
      const s = [0.002 + rand() ** 3 * 0.4, 0.002 + rand() ** 3 * 0.4, 0.001 + rand() ** 4 * 0.1];
      let [qw, qx, qy, qz] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
      const l = Math.hypot(qw, qx, qy, qz);
      qw /= l; qx /= l; qy /= l; qz /= l;
      const m = [
        (1 - 2 * (qy * qy + qz * qz)) * s[0], 2 * (qx * qy - qw * qz) * s[1], 2 * (qx * qz + qw * qy) * s[2],
        2 * (qx * qy + qw * qz) * s[0], (1 - 2 * (qx * qx + qz * qz)) * s[1], 2 * (qy * qz - qw * qx) * s[2],
        2 * (qx * qz - qw * qy) * s[0], 2 * (qy * qz + qw * qx) * s[1], (1 - 2 * (qx * qx + qy * qy)) * s[2],
      ];
      // The worker's radius: √ of the covariance's largest diagonal entry.
      const radius = Math.sqrt(Math.max(m[0] ** 2 + m[1] ** 2 + m[2] ** 2, m[3] ** 2 + m[4] ** 2 + m[5] ** 2, m[6] ** 2 + m[7] ** 2 + m[8] ** 2));
      const box = drawnBox(pos, m, travel ? later : view, proj, w, h);
      const onScreen = !!box && box[0] < 1 && box[2] > -1 && box[1] < 1 && box[3] > -1;
      const [x, y, z] = pos;
      if (view[2] * x + view[6] * y + view[10] * z + view[14] > -0.05) continue; // the worker's near cull
      total++;
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const kept = reachesScreen(vp[0] * x + vp[4] * y + vp[8] * z + vp[12], vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw, radius, frustumTest(params));
      if (onScreen) drawn++;
      if (onScreen && !kept) wrong++;
      if (!kept) dropped++;
    }
  }
}
console.log(`splats delante de la cámara ${total}, con píxeles en pantalla ${drawn}, descartados ${dropped}, descartados con píxeles en pantalla ${wrong}`);
if (wrong > 0) throw new Error(`frustum.ts: ${wrong} splats visibles descartados`);
if (dropped === 0) throw new Error('frustum.ts: no descartó nada; la prueba no es sensible');
console.log('frustum.ts: todo bien');
