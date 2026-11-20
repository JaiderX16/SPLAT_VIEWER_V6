# Occlusion culling: análisis y diseño (pendiente de implementar)

## Pipeline actual (verificado en el código)
- Motor: WebGPU vía `vgpu` 0.6 (`SplatRenderer.ts`), fallback WebGL (GaussianSplats3D) sin cambios.
- Splats: 32 B/splat en un storage buffer; el worker (`splat.worker.ts`) guarda posiciones, alphas y `radii`.
- Por cada cambio de vista el worker recorre los N splats: frustum (clip con margen 1.4), LOD por tamaño en pantalla,
  counting sort de 16 bits atrás→adelante y envía `order` (índices visibles). La GPU dibuja 6 vértices × visibles
  con blending premultiplicado atrás→adelante (`splat.wgsl`, cuad ±2√2σ, corte r²≤4, descarte α<1/255).
- No hay early termination posible: con blending atrás→adelante el fragmento no conoce la transmitancia acumulada
  delante, y WebGPU no tiene framebuffer fetch. Un depth buffer de GPU tampoco sirve: los splats son semitransparentes
  (solo 8,9 % de la escena por defecto tiene α≥100/255) y la opacidad se alcanza por acumulación.

## Algoritmo elegido: oclusión por tiles en el worker, en el orden real de dibujo
Se integra tras el counting sort (el orden ya existe; no hay readback CPU↔GPU ni sort en GPU):
1. Pasada adelante→atrás sobre los visibles (inverso de `order`): cada splat añade a los tiles de pantalla que
   cubre por completo una opacidad mínima garantizada `α·exp(-k²)`, con k² = (distancia a la esquina más lejana
   del tile / ρ1)², ρ1 = √2·σ_mid·|n·rayo|·f/z (disco inscrito del plano de los dos ejes mayores; acotado a 1024 px).
   T_tile *= (1 − a). Cuando T_tile < ε se guarda `satRank` (posición en el orden) y `minZ` del primer oclusor.
2. Pirámides Hi-Z: máx. de `satRank` y mín. de `minZ` (consultas de ≤4 celdas).
3. Pasada de prueba + compactación en el sitio: un splat se descarta si toda su huella (radio 2√2·√(σ_max²·f²·
   (1+(x²+y²)/z²)/z² + 0.3)·lodScale) dilatada por el paralaje `f·travel/minZ` tiene `satRank` < su rango.
   Huella fuera de pantalla o paralaje > tope ⇒ se conserva.
- Garantía: el error por píxel es < ε (1/255 por defecto, < 1 nivel de 8 bits), porque la luz total detrás del
  punto de saturación está acotada por T. Es exacto respecto al orden que dibuja la GPU.
- `travel` = factor × desplazamiento del ojo desde el sort anterior (cubre la latencia del sort al moverse).
- Desactivado en ortográfica, nube de puntos y durante la animación de revelado (forzar re-sort al terminar).

## Datos nuevos en el worker (11 B/splat ≈ 52 MB con 4,7 M)
`σ_max` exacto (Float32), `σ_mid` inscrito (Float32, menor valor singular de [u v] tras la transformación),
normal del plano (Int8×3). Calcularlos en `parseRecords` desde M = R·S (y A·M si hay transformación).

## Configuración
UI (panel avanzado): activar/desactivar, agresividad (ε 0,25/255·travel×3 | 1/255·×2 | 4/255·×1,5),
depuración (`off` | `tiles` superpuestos | `hidden` = dibujar solo lo descartado). API: tamaño de tile (8/16).

## Métricas
`candidates` (tras frustum+LOD), `occluded`, % de reducción, ms de visibilidad (worker), ms GPU reales con
`timer(gpu)` de vgpu (pedir la feature `timestamp-query` en `requestDevice` si el adaptador la tiene).

## Pruebas (`occlusion.check.ts`, node, con oráculo rasterizador por software)
Pared ante objetos, ocultos, parciales, varias capas, niebla de muchos splats con α bajo, hueco pequeño,
cámara movida (culling con travel en P0, oráculo en P1), rotación 360°, densidades distintas, cristal α=0,1.
El oráculo exige que ningún splat descartado aporte ≥ ε en ningún píxel.
En el navegador: comparar capturas con/sin oclusión en varias poses y tiempos GPU con `timer`.
