/**
 * Autoverificación de la oclusión (occlusion.ts): una pared densa delante de la cámara tapa un grupo de
 * splats que está detrás; un grupo al lado de la pared, uno detrás de una nube rala de flotantes y la propia
 * pared se siguen dibujando. Con la cámara moviéndose, el margen de desplazamiento nunca oculta más. Una pared
 * borrosa de splats grandes y separados (el exterior de un escaneo) también tapa lo que tiene detrás, y un suelo
 * visto desde arriba oculta los manchones grandes de ruido que hay debajo, salvo el que asoma por su borde. Junto a un
 * pilar fino visto de cerca (unos vóxeles de ancho) no se oculta nada del fondo que quede fuera de su silueta real.
 * Ejecutar: node src/lib/webgpu-splat/occlusion.check.ts
 */
import { buildVoxelGrid } from './collision.ts';
import { lookAt, perspective } from './math.ts';
import { buildOcclusionGrid, isOccluded, occlusionMap, splatArea } from './occlusion.ts';

let seed = 3;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FALLA: ${what}`);
  console.log(`ok  ${what}`);
};

/** A scene of tagged splats and the share of each tag the worker would hide from one camera. */
function scene() {
  const pos: number[] = [], alpha: number[] = [], area: number[] = [], radius: number[] = [], tag: string[] = [];
  /** Splat de radio `s` (1σ) y opacidad `a` (0–255): plano (normal x, como una pared) o redondo. */
  const add = (x: number, y: number, z: number, s: number, a: number, t: string, flat: 'x' | 'y' | false = false) => {
    pos.push(x, y, z);
    alpha.push(a);
    const [c00, c11] = flat === 'x' ? [1e-8, s * s] : flat === 'y' ? [s * s, 1e-8] : [s * s, s * s];
    area.push(splatArea(c00, 0, 0, c11, 0, flat ? s * s : s * s));
    radius.push(s);
    tag.push(t);
  };
  const hidden = (eye: [number, number, number], target: [number, number, number], travel: number) => {
    const n = alpha.length;
    const positions = Float32Array.from(pos), alphas = Uint8Array.from(alpha);
    const bounds = buildVoxelGrid(positions, alphas, n);
    if (!bounds) throw new Error('sin rejilla');
    const grid = buildOcclusionGrid(bounds, positions, alphas, Float32Array.from(area), n);
    // 90° para ver también los lados; y abajo como en el visor.
    const view = lookAt(eye, target, [0, -1, 0], new Float32Array(16));
    const proj = perspective(Math.PI / 2, 1.5, 0.05, 1000, new Float32Array(16));
    const map = occlusionMap(grid, view, proj[0], proj[5], 1.05, travel);
    const out = new Map<string, [number, number]>();
    const flags = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      // Clip position as in splat.worker.ts (perspective: w is the view depth).
      const cw = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
      const cx = proj[0] * (view[0] * x + view[4] * y + view[8] * z + view[12]);
      const cy = proj[5] * (view[1] * x + view[5] * y + view[9] * z + view[13]);
      const [h, total] = out.get(tag[i]) ?? [0, 0];
      flags[i] = isOccluded(map, cx, cy, cw, radius[i]) ? 1 : 0;
      out.set(tag[i], [h + flags[i], total + 1]);
    }
    const share = (t: string) => out.get(t)![0] / out.get(t)![1];
    return Object.assign(share, { flags });
  };
  return { add, hidden };
}

const a = scene();
// Pared x = 0 de 3 × 3 m: splats planos de 1,5 cm cada 1,5 cm (como una superficie de un escaneo).
for (let y = -1.5; y <= 1.5; y += 0.015) for (let z = -1.5; z <= 1.5; z += 0.015) a.add(0, y, z, 0.015, 200, 'pared', 'x');
// Detrás de la pared, a 1 m y bien dentro de su sombra.
for (let k = 0; k < 2000; k++) a.add(1 + rand() * 0.5, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2, 0.02, 220, 'detrás');
// Al lado de la pared, a la misma distancia: desde la cámara se ve pasado su borde (z = 1,5). Splats diminutos,
// para que el grupo no se tape a sí mismo (uno denso sí oculta su propia parte de atrás, y está bien).
for (let k = 0; k < 2000; k++) a.add(1 + rand() * 0.5, (rand() - 0.5) * 1.2, 3.5 + rand() * 0.5, 0.005, 220, 'al lado');
// Nube rala de flotantes (40 en 1,4 m³, poco opacos) delante de un grupo que asoma por el otro borde: no tapa.
for (let k = 0; k < 40; k++) a.add(-0.5 + rand(), (rand() - 0.5) * 1.2, -3 + rand(), 0.03, 40, 'flotante');
for (let k = 0; k < 2000; k++) a.add(1 + rand() * 0.5, (rand() - 0.5) * 1.2, -4 + rand(), 0.005, 220, 'tras flotantes');

// Cámara a 2 m de la pared mirando hacia +x.
const still = a.hidden([-2, 0, -0.5], [1, 0, -0.5], 0);
check(still('pared') === 0, 'la pared se dibuja entera');
check(still('detrás') > 0.95, `lo que hay detrás de la pared se oculta (${(100 * still('detrás')).toFixed(1)} %)`);
check(still('al lado') === 0, 'lo que se ve por el borde de la pared se dibuja');
check(still('flotante') === 0 && still('tras flotantes') === 0, 'una nube rala de flotantes no tapa nada');
const moving = a.hidden([-2, 0, -0.5], [1, 0, -0.5], 0.3);
check(moving('pared') === 0 && moving('al lado') === 0, 'moviéndose: pared y borde se siguen dibujando');
check(moving('detrás') <= still('detrás'), `moviéndose oculta menos (${(100 * moving('detrás')).toFixed(1)} % detrás)`);

const b = scene();
// Pared borrosa: splats redondos de 6 cm cada 4 cm (opaca, pero con vóxeles vacíos entre centros); un grupo detrás.
for (let y = -1.5; y <= 1.5; y += 0.04) for (let z = -1.5; z <= 1.5; z += 0.04) b.add(0, y, z, 0.06, 200, 'pared borrosa');
for (let k = 0; k < 2000; k++) b.add(1 + rand() * 0.5, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2, 0.02, 220, 'tras pared borrosa');
const blurry = b.hidden([-2, 0, 0], [1, 0, 0], 0);
check(blurry('pared borrosa') === 0, 'la pared borrosa se dibuja entera');
check(blurry('tras pared borrosa') > 0.95, `lo que hay detrás de la pared borrosa se oculta (${(100 * blurry('tras pared borrosa')).toFixed(1)} %)`);

const c = scene();
// Suelo opaco y = 0 de 6 × 6 m (splats de 2 cm cada 1,2 cm; arriba es −y) y, 1 m por debajo, manchones de ruido de 30 cm (σ): su borrón
// asoma por encima del suelo, pero su centro está debajo y el suelo se pinta encima. Uno bajo el borde asoma fuera.
for (let x = -3; x <= 3; x += 0.012) for (let z = -3; z <= 3; z += 0.012) c.add(x, 0, z, 0.02, 220, 'suelo', 'y');
// Una columna en una esquina, para que la escena tenga altura como una real (la rejilla sale de sus cuantiles).
for (let k = 0; k < 3000; k++) c.add(2.5 + rand() * 0.3, -2 * rand(), 2.5 + rand() * 0.3, 0.02, 220, 'columna');
for (let k = 0; k < 200; k++) c.add((rand() - 0.5) * 1, 1, (rand() - 0.5) * 1, 0.3, 150, 'bajo el suelo');
c.add(3, 1, 0, 0.3, 150, 'bajo el borde');
// Cámara a 3 m sobre el suelo, mirando abajo: el suelo llena la pantalla de arriba abajo.
const above = c.hidden([0, -3, -0.3], [0, 0, 0], 0);
check(above('suelo') === 0, 'el suelo se dibuja entero');
check(above('bajo el suelo') > 0.95, `el ruido bajo el suelo se oculta visto desde arriba (${(100 * above('bajo el suelo')).toFixed(1)} %)`);
check(above('bajo el borde') === 0, 'el manchón que asoma por el borde del suelo se dibuja');

const d = scene();
// Pilar de 10 cm de ancho a 60 cm de la cámara y una pared de fondo a 5 m: lo que la cámara ve del fondo junto a los
// bordes del pilar no se oculta, aunque la rejilla (unos 2,5 cm por vóxel) lo dibuje más gordo.
const fondo: number[] = [];
for (let y = -1; y <= 1; y += 0.01) for (let z = -0.05; z <= 0.05; z += 0.01) d.add(0.6, y, z, 0.01, 230, 'pilar');
for (let y = -1.5; y <= 1.5; y += 0.02) for (let z = -2; z <= 2; z += 0.02) { fondo.push(y, z); d.add(5, y, z, 0.01, 230, 'fondo'); }
const pillar = d.hidden([0, 0, 0], [1, 0, 0], 0);
let wrong = 0;
for (let k = 0, i = pillar.flags.length - fondo.length / 2; k < fondo.length; k += 2, i++) {
  // Fuera de la silueta real del pilar (con el borrón de 2√2·σ del propio splat): debe dibujarse.
  if (pillar.flags[i] && Math.abs(fondo[k + 1]) / 5 > (0.05 + 0.03) / 0.6 + 0.04 / 5) wrong++;
}
check(wrong === 0, `junto al pilar no se oculta el fondo que se ve (${wrong} splats de fondo mal ocultos; ${(100 * pillar('fondo')).toFixed(1)} % del fondo tapado por el pilar)`);

