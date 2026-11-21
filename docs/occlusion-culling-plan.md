# Visibilidad y cantidad de splats: oclusión por vóxeles, "Ocultar no visibles", poda, formato compacto y LOD

Escena de referencia: `model/scene.splat` (interior, 4,68 M splats). Renderizador WebGPU (`vgpu` 0.6).

## 1. Occlusion culling con los propios splats como oclusores: no compensa (ver §6 para la que sí se usa)
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

### (Retirado, §12) Presupuesto de splats por vista adelgazando (`budget.ts`)
Ahora el presupuesto fusiona splats con el LOD jerárquico (§12): misma cantidad, mejor imagen.

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
- `node src/lib/webgpu-splat/pack.check.ts` y `lod.check.ts`: formato de 20 bytes y árbol LOD (§12).
- En el navegador: A/B de capturas y de tiempos de GPU con cada opción (tablas de arriba).

## 4. "Sin splats grandes": ocultar el ruido del escaneo (`noise.ts`)
Los escaneos dejan manchones gigantes y agujas largas en los bordes y en el aire. Son pocos, pero cada uno
puede cubrir buena parte de la pantalla (manchas y vetas al acercarse o mirar desde fuera).

- **Aguja**: eje mayor > 20 × eje medio (no depende de la escala). **Gigante**: tamaño > 2 × el percentil 99 de la
  propia escena (se calcula al terminar la carga). En la escena interior: 5 067 agujas + 2 625 gigantes
  (el menor de 16,5 cm) = 7 692 de 3,38 M splats (0,23 %).
- Interruptor "Sin splats grandes" en el panel avanzado (desactivado por defecto: también suaviza algún detalle); el benchmark muestra "· N ruido".

Impacto en la imagen (renderizador exacto, sin gigantes > 14 cm ni agujas > 20):

| Vista | Splats quitados | PSNR | Píxeles con error > 8/255 |
|---|---|---|---|
| Interior, escritorio | 557 | 52,6 dB | 0,1 % |
| Interior, pared | 615 | 47,6 dB | 0,4 % |
| Desde fuera de la sala | 3 518 | 32,8 dB | 7,6 % (desaparecen manchones y vetas) |

Un umbral más bajo (todo lo mayor de 7 cm, percentil 99) sí estropea las superficies reales (27 dB): por eso el
límite de gigante es relativo y alto.

Prueba: `node src/lib/webgpu-splat/noise.check.ts`.

## 5. (Retirado, §11) "Ocultar no visibles" también ocultaba lo que da la espalda (backface culling)
Como en los modelos 3D de una sola cara: la parte de un objeto que mira en dirección contraria a la cámara (la
espalda de una estatua vista de frente) no se dibuja. Un splat no tiene cara delantera (es una elipse plana que
se ve igual por ambos lados), así que primero hay que saber hacia dónde mira su superficie:

1. Al cargar, cada splat plano (eje menor < 0,3 × eje medio) guarda la normal de su plano (Int8 ×3).
2. Al terminar, `orientNormals` (collision.ts) mira 2–5 vóxeles a cada lado en la rejilla de ocupación: si un
   lado está vacío y el otro tiene sólido, la normal apunta al vacío (hacia fuera). Si no se distingue
   (objetos finos, ruido, paredes sin nada detrás) se queda en cero y ese splat nunca se oculta por esto.
3. En cada sort, con "Ocultar no visibles" activo, se descarta el splat orientado que mira en sentido contrario
   a la cámara, con un margen (coseno 0,1 más lo que la cámara se puede mover hasta el siguiente sort).

Medido en la escena interior: 51 % de splats planos, 19 % orientados con seguridad (una variante más permisiva
orienta el 29 % pero ya deja 1–3 % de píxeles con error visible, 37–41 dB, y se descartó).

| Vista | Ocultos por estar de espaldas | PSNR | Píxeles con error > 8/255 |
|---|---|---|---|
| Interior, escritorio | 4,6 % de los de pantalla | 47,4 dB | 0,5 % |
| Interior, pared | 3,8 % | 43,3 dB | 0,9 % |
| Desde fuera de la sala | 7,4 % | 52,4 dB | 0,1 % |

En el navegador (interior, misma pose): el botón pasa de 705 K a 463 K splats dibujados (240 K fuera de
pantalla + 22 K de espaldas), 48,2 dB, 0,26 % de píxeles con error > 8/255. El efecto de "estar de espaldas" es
modesto en un interior (casi todo mira a la cámara) y mayor al mirar objetos desde fuera.

La vista editor (picture-in-picture) dibuja la misma lista que la cámara principal y ahora tiene cámara libre:
arrastrar dentro gira la vista, la rueda acerca y un clic corto sigue navegando. Sirve para comprobar desde otro
ángulo que la cara oculta no se dibuja.

Prueba: `node src/lib/webgpu-splat/orientation.check.ts` (caja maciza: 100 % de normales hacia fuera; lámina fina
flotando: sin orientar).

## 6. "Ocultar no visibles" también oculta lo tapado: solo se dibuja la primera capa (`occlusion.ts`)
Como el occlusion culling de los juegos: el oclusor no es la geometría que se dibuja (los splats, porosos uno a uno,
§1) sino una versión gruesa de la escena, la rejilla de vóxeles de las colisiones (~4 cm) con la opacidad de sus splats.

1. Al cargar, cada vóxel guarda su profundidad óptica: cada splat centrado en él suma α × su área media en pantalla /
   vóxel² (π·√(suma de los menores 2×2 de Σ), exacta para splats planos), sin pasar de lo que absorbe un rayo por su
   centro (−ln(1 − α)), y × 4: la rejilla ve una cuarta parte de la opacidad real (las paredes miran a la cámara y los
   splats se salen de su vóxel). 4 es la ganancia más alta sin cambio visible; con 8 ya se comen superficies de cerca.
2. En cada sort, 2048 tiles de pantalla: un rayo por cada esquina recorre la rejilla hasta que la luz que pasa baja de
   1/255. La profundidad de un tile es la mayor de sus 4 esquinas + 2 vóxeles (los splats de la propia pared).
   Los rayos que salen de la escena no tapan nada.
3. Un splat se oculta si su punto más cercano (profundidad − 4,9·radio) queda detrás del oclusor de todos los tiles
   que toca su huella. Para las huellas de menos de medio tile basta una lectura (máximo de los 4 tiles alrededor de
   la esquina más cercana).
4. Cámara en movimiento: al desplazarse, una pared cercana se desliza sobre lo que tiene detrás, así que cada tile
   toma el oclusor más lejano a esa distancia (travel·escala/profundidad; más de 8 tiles: no tapa). Al pararse, un sort
   más sin márgenes recupera toda la oclusión.

Se mide en el benchmark como "· N tapados".

Calidad (renderizador exacto en node, 480×218, frente a la lista de hoy con frustum y espaldas; ninguna vista empeora
más de 0,03 % de píxeles con error > 8/255):

| Vista | Tapados (de los de pantalla) | PSNR negro / gris |
|---|---|---|
| Fuera, pegado al muro (la captura del aviso) | 61 % | 56,3 / 56,3 dB (igual) |
| Fuera, a 2 m del muro | 32 % | 58,5 / 58,5 dB (igual) |
| Órbita inicial / fuera por z | 21 % / 19 % | sin cambio |
| Interior, mirando a una pared / al fondo | 2,7 % / 3,3 % | sin cambio |
| Interior, pegado a una pared | 0,4 % | 39,6 dB (39,7 sin oclusión) |
| Cámara movida 25 cm tras el sort | margen de desplazamiento | sin error (sin margen: hasta 0,76 % de píxeles en el interior) |

En el navegador (1095×1158, Intel Gen12, presupuesto 1 M; "sin" = "Ocultar no visibles" apagado, así que incluye
también frustum y espaldas):

| Vista | Dibujados | Tapados | GPU | Sort |
|---|---|---|---|---|
| Fuera, pegado al muro | 998 K → 512 K | 1,61 M | 36,4 → 21,4 ms | 82 → 92 ms |
| Fuera, a 2 m | 996 K → 998 K (aligerados 2,36 M → 0,95 M: el presupuesto se gasta en lo visible) | 1,08 M | 37,9 → 32,4 ms | 100 → 151 ms |
| Órbita inicial | 998 K → 892 K | 443 K | 25,2 → 21,8 ms | 75 → 88 ms |
| Interior | 748 K → 470 K | 33 K | 15,9 → 14,0 ms | 36 → 49 ms |

Coste: el mapa de oclusores, 2–8 ms por sort; el test, ~10 ns por splat en pantalla (+30–40 ms con 3 M candidatos).
Límites: dentro de una sala tapa poco (detrás de las paredes de este escaneo casi no hay nada); al moverse cerca de
una pared el margen la desactiva hasta pararse; una pared de una sola capa fina de splats puede no tapar (se queda
del lado seguro); en ortográfica no se usa.

Prueba: `node src/lib/webgpu-splat/occlusion.check.ts` (pared densa: tapa lo de detrás, no lo que asoma por el borde
ni lo que hay tras una nube rala de flotantes; la pared se dibuja entera).

## 7. Qué queda sin tocar la calidad, y el quad ajustado a la opacidad
Medido con el renderizador exacto (548×579) sobre lo que ya se dibuja con §2, §5 y §6:

| Vista | Más splats que la transmitancia real permitiría ocultar (T < 1/255, mapa de 64×68 tiles) |
|---|---|
| Interior, pared / fondo / pegado | 0,3 % / 2,2 % / 0,0 % |
| Fuera, a 2 m / órbita inicial / pegado al muro | 66 % / 73 % / 54 % |

Dentro de la sala ya no queda nada que quitar sin cambiar la imagen: el 25–40 % de lo dibujado aporta menos de
1/255 por splat, pero juntos sí se ven (la pila de semitransparentes, §1). Desde fuera la oclusión por vóxeles se queda
corta frente a la transmitancia real; llegar ahí pide medirla en la GPU (render delante→atrás por tandas y leer de vuelta
un mapa de profundidad de saturación), que no está hecho.

**Quad ajustado a la opacidad** (`splat.wgsl`, `frustum.ts alphaExtent`): el quad de cada splat cubría ±2 (|uv|² ≤ 4),
pero el fragment descarta α·e^-r² < 1/255, así que un splat tenue termina en r² = ln(255 α). El quad se encoge a ese
radio (+1 % por redondeo); puntos y aparición conservan el quad entero. El worker usa el mismo tamaño para "fuera de
pantalla" y la oclusión (0,5 % menos splats, sin cambio de imagen). En el renderizador exacto, ningún píxel visible queda
fuera del quad ajustado; el 15–18 % de los fragmentos que se sombreaban eran de esa franja invisible.

En el navegador (1095×1158, Intel Gen12, misma sesión, quad entero ↔ ajustado alternando 12 veces):

| Vista | GPU quad entero → ajustado | Píxeles distintos (máx.) |
|---|---|---|
| Fuera, pegado al muro | 20,8 → 18,6 ms (−11 %) | 0,07 % (1/255) |
| Fuera, a 2 m | 39,7 → 35,2 ms (−11 %) | 0,6 % (2/255) |
| Órbita inicial | 21,8 → 19,7 ms (−9 %) | 0,08 % (1/255) |
| Interior, al fondo / pared | 14,2 → 12,6 / 12,9 → 11,7 ms (−10 %) | 5,8 / 7,2 % (3/255) |

Las diferencias son redondeo del blending de 8 bits al interpolar las uv de otro triángulo: diferencia media con signo
0,00003 niveles (no falta luz), 99 % de ellas de 1 nivel; con dos renders iguales la diferencia es 0.

Prueba: `node src/lib/webgpu-splat/frustum.check.ts` (ahora con opacidades al azar: ningún splat con píxeles visibles
descartado).

## 8. La oclusión también ve la cáscara borrosa del exterior (splats grandes repartidos)
Diagnóstico frente a la transmitancia real (renderizador exacto, mismo mapa de tiles): desde fuera, los vóxeles sí
veían el muro, pero 1,5–2,8 veces más hondo que el render. El exterior de un escaneo es una cáscara de splats grandes y
borrosos; cada uno sumaba en un solo vóxel (y con tope), así que la cáscara quedaba llena de huecos.

Ahora un splat más ancho que un vóxel reparte α × su área por el cubo de vóxeles que cubre (hasta ±2 vóxeles), sin la
ganancia ×4 (un rayo que lo cruza recoge ≈ α, nunca más de lo que el splat da). Con ganancia ×2 oculta más, pero ya
cambia algo la imagen; con ×4 aparecen errores visibles (55,6 dB, máx. 39/255). Repartir hasta 2, 4 u 8 vóxeles da lo
mismo. La rejilla tarda lo mismo en construirse (~85 ms con 3,4 M splats).

Renderizador exacto (480×218), splats ocultos por oclusión de los que hay en pantalla:

| Vista | Antes | Con reparto | Imagen (píxeles con error > 8/255) |
|---|---|---|---|
| Fuera, pegado al muro | 61 % | 75 % | igual (0,00 %) |
| Fuera, a 2 m | 33 % | 51 % | igual (0,03 %) |
| Órbita inicial | 22 % | 44 % | igual (0,00 %) |
| Fuera por z | 20 % | 39 % | igual (0,00 %; 67,5 frente a 68,1 dB) |
| Interior, al fondo / pared / pegado | 3,4 / 2,8 / 0,5 % | 4,1 / 2,8 / 0,5 % | igual |
| Cámara movida 25 cm tras el sort | — | — | sin error con el margen de desplazamiento |

En el navegador (1095×1158, Intel Gen12, sin presupuesto; "Ocultar no visibles" apagado → encendido):

| Vista | Dibujados | Tapados | GPU | Imagen |
|---|---|---|---|---|
| Órbita inicial | 1,79 M → 672 K | 780 K | 32,3 → 20,3 ms | 68,8 dB, 0,00 % > 8 |
| Fuera, pegado al muro | 2,08 M → 288 K | 1,90 M | 46,8 → 17,9 ms | 55,8 dB, 0,00 % > 8 |
| Interior, al fondo | 776 K → 487 K | 36 K | 17,5 → 15,7 ms | 50,3 dB, 0,20 % > 8 (las espaldas, §5) |

Prueba: `node src/lib/webgpu-splat/occlusion.check.ts` (una pared borrosa de splats de 6 cm cada 4 cm tapa lo de detrás;
sin el reparto no tapaba nada).

## 9. El centro decide (la "silueta" de la vista de puntos)
Idea del usuario: en la vista de puntos cada splat es su centro y la capa densa de puntos forma la silueta; lo que
queda detrás de esa silueta no se ve. Es cómo se dibuja: los splats se pintan en el orden de la profundidad de su
centro, así que una capa opaca delante se pinta encima de todo un splat, por mucho que su borrón asome.

- Antes un splat contaba desde su punto más cercano (centro − 4,9 radios) y se rendía si su huella pasaba de 64 tiles:
  casi ningún manchón grande se ocultaba. Ahora cuenta desde su centro − 2 radios (FRONT_RADII), con un margen de
  3,5 vóxeles detrás del oclusor. Con 0 radios y margen 2 aparecían errores (hasta 49/255): los splats anchos de una
  cáscara borrosa reparten opacidad más allá de los vóxeles que la rejilla les da.
- Huellas grandes: pirámide de máximos (cada nivel, el más lejano de 2 × 2 tiles) y prueba celda a celda en el nivel
  más fino donde la huella cabe en 64 celdas; el estiramiento fuera del eje se calcula por splat solo en ese caso.
- Mientras la cámara se mueve se usa el punto más cercano (con el centro, moverse 25 cm daba 0,04 % de píxeles con
  error, máx. 41/255); al parar, el sort final usa el centro.

Renderizador exacto (480×218), cámara quieta: oculta 2,9 / 0,4 / 0,3 / 4,2 % en interiores y 51 / 38 / 43 / 76 % desde
fuera (fuera a 2 m / por z / órbita inicial / pegado al muro), con la misma imagen que antes salvo "fuera por z"
(65,3 frente a 68,1 dB, 0,01 % de píxeles > 8/255). Moviéndose 25 cm: como mucho 0,01 % de píxeles > 8/255 (máx. 16).

Prueba nueva en `occlusion.check.ts`: un suelo opaco visto desde arriba oculta el 100 % de los manchones de 30 cm que hay
1 m por debajo (antes 0 %) y el que asoma por su borde se sigue dibujando.

## 10. "Recortar bajo el suelo" (interruptor, apagado por defecto)
En la escena de la plaza (parque-constitucion, 589 K splats) la oclusión no oculta nada desde arriba, y con razón: el
suelo del escaneo es semitransparente. Medido splat a splat en verticales junto a la estatua, deja pasar el 5–12 % de la
luz (profundidad óptica 2,1–2,9; hace falta 5,5 para 1/255). Desde arriba, lo de debajo se ve en parte, sobre todo en los
bordes. Son pocos splats pero grandes: 410 de 205 K en pantalla, más de 0,3 bajo el suelo, con ~18 % del área de
quads; solo 3 son "gigantes", así que "Sin splats grandes" no los quita.

El interruptor quita, desde cualquier ángulo, lo que está por debajo de un corte bajo el suelo detectado
(`CollisionGrid.floor`); sin suelo detectado no hace nada. El benchmark muestra "· N bajo el suelo".

**Dónde cortar** (`collision.ts floorCutHeight`): un suelo de escaneo no es una lámina. Tiene grosor y, si brilla, su
reflejo vive en splats por debajo: en la sala de referencia hay 99 K splats a más de 9 cm bajo el suelo, hasta −60 cm.
Un margen fijo de 2 vóxeles (9 cm) se comía ese reflejo y dejaba manchas oscuras en el suelo (18–27 % de píxeles con
error > 8/255). Ahora se recorre hacia abajo el histograma de alturas (capas de ¼ de vóxel) desde el pico del suelo
hasta que la densidad cae al 0,2 % del pico durante 3 capas; lo de más abajo es ruido suelto.

| Escena | Corte | Quitados en la vista | Imagen | GPU |
|---|---|---|---|---|
| Sala (3 vistas mirando al suelo) | 43 cm bajo el suelo | 13 K en total, 402 en la vista de la entrada | 55,7–76,2 dB, ≤ 0,04 % > 8/255 | — |
| Plaza, desde arriba | 0,39 bajo el suelo | 316 | bordes de la plaza (el suelo deja ver lo de debajo) | 3,80 → 3,47 ms |

Recortar más cerca del suelo cambia la sala de forma visible (20 cm: 1,5–13 % de píxeles; 30 cm: hasta 2,3 %).
shortcut: un único plano de suelo; en terreno con pendiente recortaría suelo real del lado bajo (por eso es un
interruptor y no va dentro de "Ocultar no visibles").

## 11. Deformaciones junto a los bordes: sin "de espaldas" y con erosión de la silueta
Con la cámara cerca del pedestal de la plaza, el fondo junto a sus lados salía deformado (árboles, arco y farola
comidos). Medido con el render real ("Ocultar no visibles" apagado frente a encendido): 6,3 % de píxeles con error
> 8/255, hasta 166. Dos causas, separadas con el renderizador exacto:

1. **"De espaldas" (§5): 3,9 % de píxeles, hasta 88/255.** Decidía el lado de fuera de cada superficie con los vóxeles
   (el lado vacío). Un escaneo es hueco por dentro: dentro del pedestal no hay splats y fuera hay cadenas y flores,
   así que daba la vuelta a las caras y ocultaba superficies que se ven. Ni siendo estricto (solo lo que mira a más de
   60° hacia atrás) bajaba del 2,9 %. Se ha quitado entero (normales, `orientNormals`, su prueba y el contador del
   benchmark): en la sala ahorraba un 4–7 % de splats y ya dejaba 0,2–1 % de píxeles mal.
2. **Oclusión: 1,4 % de píxeles, hasta 153/255.** La rejilla dibuja cada objeto hasta un vóxel más gordo de lo que es;
   en la plaza un vóxel mide 13 cm y el pedestal unos 2, así que de cerca su silueta se comía el fondo de al lado.
   Ahora cada tile toma el oclusor más lejano dentro de 1 vóxel de lado, proyectado a su profundidad (sumado al margen
   por movimiento, y con la pirámide para radios grandes, sin el tope de 8 tiles de antes). Con medio vóxel quedaban
   errores (0,03 %, hasta 39/255).

Resultado en el navegador, plaza (encendido frente a apagado, sin presupuesto): junto al pedestal 0,07 % de píxeles
> 8/255 (máx. 19); desde arriba y de lejos 0,00 %. Sala (renderizador exacto, 8 vistas): 0,00 % de píxeles > 8/255 en
todas (máx. 2/255) y moviéndose 25 cm, igual. Lo que cuesta: la oclusión dentro de la sala ya casi no oculta nada (los
oclusores cercanos y finos no son fiables con vóxeles de 4 cm); desde fuera oculta 23–59 % de lo que hay en pantalla
(59 % pegado al muro exterior), antes 38–76 % con errores.

## 12. Splats de 20 bytes y LOD jerárquico (fusionar lo lejano)
**Formato** (`pack.ts`, `splat.wgsl`): 32 → 20 bytes por splat. Posición en 3 × 16 bits dentro de la caja de su bloque de
256 splats (las cajas van en un búfer aparte de 32 bytes por bloque; error ≤ 0,2 mm en 25 m), escalas en half float
(× 64, error ≤ 0,05 %), y rotación y color con los mismos bytes del archivo. El shader rehace Σ = R·S²·Rᵀ. Una
transformación de escena (o un splat fusionado) se vuelve a escalas + rotación con Jacobi (`decompose`, error ≤ 1,6 %).

**Árbol** (`lod.ts`, al terminar la carga): los splats ordenados por curva de Morton forman un octree con hojas de ≤ 16.
Cada nodo tiene un splat fusionado que lo sustituye: misma masa (opacidad × área media), centro y color ponderados por
masa y Σ = la de los hijos más su separación. En la sala: 0,80 M nodos para 3,38 M splats (+24 % de splats en la GPU).

**Sort** (worker): recorre el árbol; un nodo fuera de pantalla, tapado o bajo el corte del suelo se salta entero, y uno
cuyo splat fusionado mide menos de `minPx` px (radio 1σ) en pantalla se dibuja como ese único splat. Presets: Alta 0 px,
Equilibrado 1 px (por defecto), Rendimiento 2 px. El presupuesto ("Máx.") ya no adelgaza: en la misma pasada cuenta
cuánto dibujaría cada tamaño de fusión mayor (bins de 1/16 de octava) y recorta la lista al más pequeño que cabe; empieza
cerca del tamaño del sort anterior y, si queda muy por debajo del presupuesto, repite desde el preset. El recuento es
exacto (en desarrollo, el worker lo comprueba en cada sort).

Calidad del LOD (frames exactos 1434×1158, frente al render sin LOD, sala):

| Vista | Equilibrado (1 px) | Rendimiento (2 px) |
|---|---|---|
| Interior, hacia +x | −5 % splats, 49,1 dB, 0,23 % > 8/255 | −22 %, 43,8 dB, 0,88 % |
| Interior, hacia −x | −10 %, 44,0 dB, 0,66 % | −33 %, 37,5 dB, 2,68 % |
| Fuera, lejos | −52 %, 50,5 dB, 0,07 % | −76 %, 48,1 dB, 0,14 % |

Antes (adelgazar, presets 1,25 / 2,5 px) frente a ahora, misma sesión del navegador (Intel Gen12), cada versión contra su
render sin LOD:

| Vista | Presupuesto 1 M (escritorio) | Presupuesto 100 K (móvil) |
|---|---|---|
| Interior, +x | 38,0 → 39,6 dB; GPU 29,8 → 28,4 ms | 22,6 → 25,6 dB (39 → 25 % de píxeles mal); 23,0 → 10,5 ms |
| Interior, −x | 31,8 → 32,7 dB; 30,3 → 29,0 ms | 20,5 → 23,2 dB (53 → 29 %); 23,7 → 11,1 ms |
| Fuera, lejos | 47,4 → 48,5 dB; 11,6 → 10,9 ms | 22,3 → 44,8 dB (28 → 0,4 %); 6,5 → 2,5 ms |

Sin presupuesto, Equilibrado: interior −x 1,79 M splats a 39,6 dB → 2,01 M a 44,0 dB; fuera 1,63 M a 49,9 dB → 1,60 M a
50,5 dB. Memoria de GPU: 116 → 93 MB (con los fusionados).

Sort en el worker (node, mediana de 7, mismas poses, ms):

| Ajuste | Interior +x | Interior −x | Fuera, lejos |
|---|---|---|---|
| Alta, sin presupuesto | igual (sin nada que fusionar se ordena splat a splat, como antes) | | |
| Equilibrado | 128 → 122 | 152 → 159 | 160 → 106 |
| Equilibrado + 1 M | 132 → 122 | 152 → 122 | 154 → 104 |
| Equilibrado + 100 K | 107 → 24 | 127 → 21 | 120 → 13 |

Lo que cuesta: la carga termina ~0,7 s después (árbol y empaquetado; los primeros splats salen igual de pronto); la GPU
del render completo sube un 4–6 % (el vertex shader rehace Σ). Dentro de la sala la GPU baja poco con el LOD: manda el relleno de los splats cercanos.
shortcut: los fusionados incluyen los splats de ruido, así que con "Sin splats grandes" un fusionado lejano conserva algo
del color de un gigante.

Pruebas: `node src/lib/webgpu-splat/pack.check.ts` (posición, escalas, rotación y color tras empaquetar; `decompose`) y
`node src/lib/webgpu-splat/lod.check.ts` (cada splat aparece una sola vez en cualquier corte del árbol; el fusionado
conserva centro, color, masa y dispersión).

## 13. Huecos en los bordes con "Ocultar no visibles" (pruebas por nodo del árbol)
Con el árbol del LOD (§12) el recorrido descartaba nodos enteros con las pruebas de un splat suelto, y en vertical (móvil)
desaparecían trozos junto a los bordes de la pantalla, dejando ver manchas borrosas de detrás:

1. **Fuera de pantalla**: "centro a más de 1,5 × el borde: no se dibuja" vale para un splat (el shader lo descarta), no
   para un nodo de varios metros con parte de sus splats dentro. Tampoco radio / profundidad, que se queda corto para una
   esfera grande cerca de la cámara. Ahora `nodeReachesScreen` (frustum.ts) mide la distancia del centro del nodo a cada
   plano lateral del frustum (su gradiente acota cuánto cambia al moverse a cualquier splat del nodo), con el estiramiento
   fuera del eje y el desplazamiento de la cámara.
2. **Oclusión**: el nodo se juzgaba desde centro − 0,4 de su radio, no desde su splat más cercano. Ahora `nodeOccluded`
   (occlusion.ts) parte de la profundidad más cercana posible y acota la huella de todos sus splats desde ahí.

Sin nada que fusionar (Alta sin presupuesto) ya no se recorre el árbol: se ordena splat a splat como antes (era hasta un
65 % más lento por el recorrido).

Comprobado: en la sala sin LOD salen exactamente los mismos splats que antes del árbol (antes del arreglo faltaban hasta
33 K en una vista); en la plaza, vista móvil 563×1218, 7 ángulos alrededor de la estatua: encendido frente a apagado
52–59 dB (≤ 0,16 % de píxeles > 8/255, lo mismo que la oclusión de siempre) y Equilibrado frente a Alta 46–55 dB (≤ 0,17 %).
Con el presupuesto de 100 K de los móviles la imagen se suaviza (26–35 dB frente a Alta; antes, en la sala, 20–23 dB).

Pruebas: `frustum.check.ts` (17,8 K grupos de 1 cm a 6 m, quieta y moviéndose: ninguno descartado con un splat que se
dibuja; la prueba de un splat descartaba 305) y `occlusion.check.ts` (7 K grupos ocultos, todos con cada splat oculto).
