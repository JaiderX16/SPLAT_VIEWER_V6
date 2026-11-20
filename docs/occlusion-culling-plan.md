# Visibilidad y cantidad de splats: oclusión (descartada), "Ocultar no visibles", poda y presupuesto

Escena de referencia: `model/scene.splat` (interior, 4,68 M splats). Renderizador WebGPU (`vgpu` 0.6).

## 1. Occlusion culling (splats detrás de otros splats): no compensa en esta escena
Medido en node con un rasterizador por software que reproduce `splat.wgsl` (EWA, filtro 0,3 px, corte |uv|² ≤ 4,
descarte α < 1/255, mezcla atrás→adelante).

| Vista interior | Splats en frustum | Ideal con error < 1/255 | < 4/255 | < 16/255 | Método por tiles (garantizado) |
|---|---|---|---|---|---|
| Escritorio | 975 522 | 9,8 % splats · 9,5 % fragmentos | 11,5 % · 14,5 % | 14,0 % · 22,4 % | ≈ 0 % (tiles de 16/8/4/2 px) |
| Pared | 959 040 | 8,8 % · 7,2 % | 11,9 % · 13,5 % | 16,5 % · 23,1 % | 0 % |

- "Ideal" = splats con transmitancia < ε en todos sus píxeles conociendo la de cada píxel; ningún método
  garantizado lo supera. Casi todos los píxeles acaban opacos, pero solo al acumular toda la pila: las
  superficies del escaneo son splats semitransparentes y lo de detrás casi siempre aporta algo de luz.
- El método implementable (cobertura garantizada por tiles en el worker, en el orden real de dibujo) no descartó
  casi nada y costaba 70–900 ms por sort; una variante por muestreo descartaba 3–7 % con errores de hasta
  140/255 en algunos píxeles. Por eso no se integró.
- Sin early termination posible: con mezcla atrás→adelante el fragmento no conoce la transmitancia de delante y
  WebGPU no tiene framebuffer fetch; un depth buffer no sirve con splats semitransparentes.

## 2. Lo implementado: "Ocultar no visibles" (frustum ajustado a cada splat)
Antes el worker conservaba todo splat centrado hasta un 40 % más allá de cada borde (margen 1,4 en clip).
Medido en la escena: entre el 14 y el 40 % de ellos no tienen ni un píxel en pantalla, pero se ordenaban,
se subían a la GPU y pasaban por el vertex shader.

- `frustum.ts` (`reachesScreen`): un splat se queda si su propia huella (2√2·σ, con σ ≤ √3·radio y el estiramiento
  fuera del eje) llega a la pantalla, más un margen para el movimiento de cámara hasta el siguiente sort.
- Margen adaptativo (`SplatRenderer.frustumParams`): 5 % con la cámara quieta; al girar, al cambiar el FOV o
  al desplazarse crece según lo que se movió desde el sort anterior (×2, tope el 40 % antiguo). En ortográfica
  se usa la regla antigua.
- El rango de profundidades del counting sort se calcula siempre sobre el conjunto amplio, así que el botón no
  reordena lo que queda.
- Botón "Ocultar no visibles" en el panel de controles avanzados (activado por defecto). El benchmark muestra
  cuántos splats oculta ("· N ocultos") y el tiempo real de GPU del pase de splats (chip "GPU", timestamp queries).

### Resultados (vista interior, 662×1158, GPU Intel Gen12 integrada)
| | Apagado | Encendido |
|---|---|---|
| Splats dibujados | 648–731 K | 552–554 K (−15 a −24 %) |
| GPU por fotograma (mediana de ~540) | 13,63 ms | 13,30 ms (−2,4 %) |
| Sort en el worker (mediana de 6) | 45,0 ms | 52,6 ms (+17 %) |
| Imagen | — | idéntica salvo 0,07–0,2 % de píxeles a < 63 px del borde (máx. 2/255): splats grandes que la regla antigua perdía en los bordes |

La ganancia en GPU es pequeña en escritorio: los splats fuera de pantalla solo cuestan trabajo de vértices.
Se espera más en GPUs móviles con poco rendimiento de vértices (no medido).

## 3. Menos splats en total y por vista
### Poda al cargar (`DEFAULT_ALPHA_THRESHOLD = 8`)
Casi la mitad de los splats del escaneo tiene α < 16/255. Quitar los de α < 8 al cargar (umbral que ya existía,
antes 1) deja 3,38 M de 4,68 M (−28 %) y reduce en proporción la memoria de GPU, la del worker y el sort.
Medido contra la imagen completa: 46–47 dB de PSNR, 0,4–0,8 % de píxeles con error > 8/255 (no se aprecia).
Los búferes se recortan al terminar la carga (`shrinkToFit` en el renderer y en el worker): GPU 169 → 116 MB.

| Poda | Escritorio | Pared |
|---|---|---|
| α < 4 | −15 %, 58 dB | −12 %, 58 dB |
| α < 8 (por defecto) | −30 %, 46 dB | −26 %, 47 dB |
| α < 16 | −47 %, 37 dB | −45 %, 38 dB |

### Presupuesto de splats por vista (`budget.ts`)
"Máx." en el panel avanzado: 100 K (por defecto en móvil) · 300 K · 1 M (por defecto en escritorio) · Todos.
El worker hace el frustum, histograma el tamaño en pantalla de los candidatos y sube el umbral del LOD hasta
que el recuento esperado cabe; luego adelgaza (los más pequeños primero, elección estable por hash) y agranda
los que quedan para cubrir la misma área. Nunca baja de 1 de cada 16 por clase de tamaño (crecimiento máx. 4×),
para no abrir huecos. El recuento real queda a ±1 % del presupuesto.

Calidad medida (sobre la escena ya podada, imagen de referencia sin presupuesto):

| Presupuesto | Escritorio (360 K en pantalla) | Pared (568 K) |
|---|---|---|
| 300 K | 39,9 dB | 31,1 dB |
| 150 K | 32,9 dB | 26,6 dB |
| 100 K | 30,6 dB (más suave, sin huecos) | 24,8 dB |

En el navegador (misma pose, 662×1158, Intel Gen12): 606 K activos → 11,3 ms de GPU; 100 K → 8,2 ms. La GPU no
baja en proporción porque el área cubierta se conserva; el ahorro por splat (vértices, memoria, sort, subida
del orden) pesa más en móviles. Quitar primero los más transparentes se probó y no mejora de forma consistente.

## Pruebas
- `node src/lib/webgpu-splat/frustum.check.ts`: 157 K splats aleatorios contra el cuadrilátero exacto de
  `splat.wgsl`, con cámara quieta y movida (lateral, adelante, atrás): 0 splats con píxeles en pantalla descartados.
- `node src/lib/webgpu-splat/budget.check.ts`: recuento a ±5 % del presupuesto, área conservada, suelo de 1/16.
- En el navegador: A/B de capturas y de tiempos de GPU con cada opción (tablas de arriba).
