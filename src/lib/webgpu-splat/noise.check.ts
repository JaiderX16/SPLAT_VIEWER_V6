/**
 * Autoverificación de noise.ts: una escena sintética de 200 K splats de tamaño normal (log-normal) más 50
 * gigantes; solo los gigantes superan `giantSize`, y las agujas se reconocen sin depender de la escala.
 * Ejecutar: node src/lib/webgpu-splat/noise.check.ts
 */
import { giantSize, isNeedle, NEEDLE_RATIO } from './noise.ts';

let seed = 5;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};

const n = 200_000, giants = 50;
const sizes = new Float32Array(n + giants);
for (let i = 0; i < n; i++) sizes[i] = 0.006 * Math.exp(0.7 * gauss()); // mediana 6 mm, como el escaneo (máx. ≈ 15 cm)
for (let i = n; i < n + giants; i++) sizes[i] = 0.3 + rand() * 0.2; // 30–50 cm
// Barajar para que el muestreo por saltos no dependa del orden.
for (let i = sizes.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
}
const limit = giantSize(sizes, sizes.length);
let flagged = 0, flaggedGiants = 0;
for (const s of sizes) {
  if (s > limit) {
    flagged++;
    if (s >= 0.3) flaggedGiants++;
  }
}
check(flaggedGiants === giants, `marca los ${giants} gigantes (límite ${(limit * 100).toFixed(1)} cm)`);
check(flagged - flaggedGiants < n * 0.001, `casi ningún splat normal pasa el límite (${flagged - flaggedGiants} de ${n})`);
check(isNeedle(0.5, 0.01, 0.001) && isNeedle(-0.002, 0.00005, -0.0001), 'reconoce agujas a cualquier escala y signo');
check(!isNeedle(0.05, 0.04, 0.001), 'un splat plano (disco) no es una aguja');
check(!isNeedle(0.01 * NEEDLE_RATIO * 0.99, 0.01, 0.002), 'justo por debajo del límite no es aguja');
console.log('noise.ts: todo bien');
