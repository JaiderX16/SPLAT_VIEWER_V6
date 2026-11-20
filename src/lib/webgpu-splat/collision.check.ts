/**
 * Autoverificación de collision.ts con una sala sintética en metros (arriba = -Y, como CAMERA.UP):
 * suelo en y = 0, techo a 2,8 m, paredes en x = ±3 y z = ±2, una mesa de 75 cm en el centro y una
 * repisa a la altura de los ojos.
 * Ejecutar: node src/lib/webgpu-splat/collision.check.ts
 */
import { buildVoxelGrid, CollisionGrid, type Body } from './collision.ts';
import type { Vec3 } from './math';

const pts: number[] = [];
const add = (x: number, y: number, z: number) => pts.push(x, y, z);
const S = 0.02;
for (let x = -3; x <= 3; x += S) for (let z = -2; z <= 2; z += S) {
  add(x, 0, z); // suelo
  add(x, -2.8, z); // techo
}
for (let h = 0; h <= 2.8; h += S) {
  for (let z = -2; z <= 2; z += S) { add(-3, -h, z); add(3, -h, z); }
  for (let x = -3; x <= 3; x += S) { add(x, -h, -2); add(x, -h, 2); }
}
for (let x = -0.5; x <= 0.5; x += S) for (let z = -0.3; z <= 0.3; z += S) add(x, -0.75, z); // tablero de la mesa
for (let x = 3.1; x <= 4; x += S) for (let z = -1; z <= 1; z += S) add(x, 0, z); // suelo de fuera, sin techo
for (let x = -2.5; x <= -1.5; x += S) for (let z = 1.2; z <= 1.8; z += S) add(x, -1.6, z); // repisa a 1,6 m
for (let x = -2.6; x <= -2.3; x += S) for (let z = -1; z <= -0.7; z += S) add(x, -0.25, z); // caja de 25 cm

const count = pts.length / 3;
const data = buildVoxelGrid(new Float32Array(pts), new Uint8Array(count).fill(255), count);
if (!data) throw new Error('sin rejilla');
const grid = CollisionGrid.create(data, [0, -1, 0]);
if (!grid) throw new Error('sin CollisionGrid');

const body: Body = { eye: 1.65, radius: 0.2, step: 0.3 };
const tol = data.voxel * 1.5;
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};
const near = (a: number, b: number, eps = tol) => Math.abs(a - b) <= eps;

check(near(grid.floor ?? NaN, 0) && near(grid.ceiling ?? NaN, 2.8), `suelo ${grid.floor?.toFixed(3)} y techo ${grid.ceiling?.toFixed(3)}`);
check(grid.unitsPerMeter === 1, 'una sala de 2,8 m se lee en metros');
check(near(grid.groundAt([-2, -1.65, 1], 0, 0.3) ?? NaN, 0), 'suelo bajo los ojos');
check(grid.bodyFree([-2, 0, 1], body), 'cabe en medio de la sala');
check(grid.bodyFree([0, 0, 0], body), 'la cámara pasa por encima de la mesa');
check(!grid.bodyFree([2.95, 0, 0], body), 'no cabe dentro de la pared');

const overTable = grid.walk([-2, 0, 0], [2, 0, 0], body);
check(near(overTable[0], 2, 1e-9) && near(overTable[1], 0), `cruza la mesa sin tropezar ni subirse (x = ${overTable[0].toFixed(3)}, y = ${overTable[1].toFixed(3)})`);
const overBox = grid.walk([-2.45, 0, -1.6], [-2.45, 0, -0.2], body);
check(near(overBox[2], -0.2, 1e-9) && overBox[1] === 0, `pasa sobre una caja baja sin cambiar de altura (y = ${overBox[1].toFixed(3)})`);
const toShelf = grid.walk([-2, 0, 0], [-2, 0, 1.9], body);
check(toShelf[2] < 1.2 - body.radius + tol && toShelf[2] > 1.2 - body.radius - 2 * tol, `se para antes de la repisa a la altura de los ojos (z = ${toShelf[2].toFixed(3)})`);
const toWall = grid.walk([-2, 0, 1], [3.5, 0, 1], body);
check(toWall[0] < 3 - body.radius + tol && toWall[0] > 3 - body.radius - 2 * tol, `se para antes de la pared (x = ${toWall[0].toFixed(3)})`);
const slid = grid.slide([2.6, 0, 0], [3.2, 0, 0.5], body);
check(slid[0] < 3 - body.radius + tol && near(slid[2], 0.5), `se desliza por la pared (x = ${slid[0].toFixed(3)}, z = ${slid[2].toFixed(3)})`);

const dir: Vec3 = [0.6, 0.8, 0]; // desde los ojos hacia el suelo, por delante
const hit = grid.raycast([-2, -1.65, 1], dir);
check(!!hit && near(hit[1], 0) && near(hit[0], -2 + (1.65 / 0.8) * 0.6), `el rayo toca el suelo (${hit?.map((c) => c.toFixed(2)).join(', ')})`);
const spot = grid.findStand([0, -1, 0], 0, body, 3);
check(!!spot && grid.bodyFree(spot, body) && near(spot[1], 0), `aterriza en el suelo aunque haya una mesa debajo (${spot?.map((c) => c.toFixed(2)).join(', ')})`);
const inside = grid.findStand([3.6, -1, 0], 0, body, 3);
check(!!inside && inside[0] < 3, `fuera de la sala aterriza dentro, bajo techo (x = ${inside?.[0].toFixed(2)})`);
console.log('collision.ts: todo bien');
