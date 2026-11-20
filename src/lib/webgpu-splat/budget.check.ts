/**
 * Autoverificación de budget.ts con tamaños de splat aleatorios (log-uniformes de 0,05 a 300 px), binados y
 * adelgazados exactamente como en splat.worker.ts: el recuento real cae a ±5 % del presupuesto, el área
 * cubierta se conserva y sin exceso no se adelgaza nada. Ejecutar: node src/lib/webgpu-splat/budget.check.ts
 */
import { budgetThreshold, hash01, PX_BIN_OFFSET, PX_BINS } from './budget.ts';
import { LOD_MAX_SCALE } from './protocol.ts';

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};

const n = 600_000;
const px = Float32Array.from({ length: n }, () => Math.exp(Math.log(0.05) + rand() * Math.log(300 / 0.05)));
const counts = new Uint32Array(PX_BINS);
const bits = new Int32Array(px.buffer);
for (let i = 0; i < n; i++) counts[Math.min(PX_BINS - 1, Math.max(0, (bits[i] >> 21) - PX_BIN_OFFSET))]++;

/** The worker's thinning: kept count and covered area (Σ (px · growth)²). */
function thin(threshold: number, minKeep: number) {
  let kept = 0, area = 0;
  for (let i = 0; i < n; i++) {
    let grow = 1;
    if (px[i] < threshold) {
      const keep = Math.max(minKeep, px[i] / threshold);
      if (hash01(i) >= keep) continue;
      grow = Math.min(LOD_MAX_SCALE, 1 / Math.sqrt(keep));
    }
    kept++;
    area += (px[i] * grow) ** 2;
  }
  return { kept, area };
}

const fullArea = px.reduce((s, v) => s + v * v, 0);
let last = 0;
for (const budget of [50_000, 100_000, 300_000]) {
  const { threshold, minKeep } = budgetThreshold(counts, n, 1.25, 0.12, budget);
  const { kept, area } = thin(threshold, minKeep);
  check(Math.abs(kept - budget) <= budget * 0.05, `presupuesto ${budget}: dibuja ${kept} (umbral ${threshold.toFixed(1)} px)`);
  check(Math.abs(area / fullArea - 1) <= 0.1, `presupuesto ${budget}: conserva el área cubierta (${(100 * area / fullArea).toFixed(1)} %)`);
  check(kept > last, `presupuesto ${budget}: más presupuesto, más splats`);
  last = kept;
}
const tight = budgetThreshold(counts, n, 1.25, 0.12, 10_000);
const floor = thin(tight.threshold, tight.minKeep).kept;
check(Math.abs(floor - n / 16) <= n / 16 * 0.05, `un presupuesto inalcanzable se queda en 1 de cada 16 (${floor}), sin abrir huecos`);
const roomy = budgetThreshold(counts, n, 1.25, 0.12, n + 1);
check(roomy.threshold === 1.25 && roomy.minKeep === 0.12, 'sin exceso solo aplica el LOD del preset');
const none = budgetThreshold(counts, n, 0, 1, 0);
check(none.threshold === 0, 'sin límite ni LOD no adelgaza nada');
console.log('budget.ts: todo bien');
