# ChamVa — Auditoría técnica (v0.2.1)

Revisión hecha el 2026-08-26 sobre el código completo, con foco en **quitar fondo
y transparencias**. Marcas: 🔴 crítico · 🟠 importante · 🟡 mejora · ✅ corregido en v0.2.1.

---

## 1. Quitar fondo (`src/ai/background-removal.ts`, `ai.worker.ts`)

### Lo que está bien
- Dos motores (RMBG-1.4 vía Transformers.js y isnet vía imgly) con selector de
  calidad; RMBG en Web Worker (v0.2.0); la máscara se aplica como canal alfa real
  (no como recorte duro), así que los bordes son suaves.
- El borrador/pincel (`MaskEditor`) permite restaurar desde `originalSrc` — buen
  diseño: el original nunca se pierde.

### Problemas encontrados

1. 🔴 **Licencias de los modelos.** `briaai/RMBG-1.4` es **CC BY-NC 4.0 (no
   comercial)** y `@imgly/background-removal` es **AGPL-3.0** (o licencia de pago).
   ChamVa vende "licencias de apoyo" por PayPal: eso puede leerse como uso
   comercial de RMBG, y AGPL obliga a que el código de ChamVa sea compatible con
   AGPL (no puede ser MIT). Opciones limpias: **BiRefNet-lite** o **RMBG-2.0**
   revisando su licencia (BiRefNet es MIT), o **U²-Net / MODNet** (Apache-2.0).
   Es la decisión más importante antes de crecer: cambiar de modelo luego es
   barato técnicamente (misma interfaz), caro reputacionalmente.

2. 🟠 **El refinado de bordes daña detalles finos.** `refineEdges` hace erosión
   1px + desenfoque 1px **siempre**, a resolución completa. En fotos grandes es
   inocuo, pero en **logos, iconos, texto o imágenes pequeñas** (< 500 px) se come
   el contorno y deja bordes borrosos; en cabello quita hebras. Mejora:
   - Hacerlo opcional y con intensidad (slider "Suavizar bordes" 0–3 px).
   - Detectar imágenes gráficas (histograma de alfa casi binario) y saltarlo.
   - Para halos, lo correcto no es erosionar sino **descontaminar el color** de
     los píxeles semitransparentes (estimar el color de primer plano en el borde
     y quitar la mezcla con el fondo original). Es ~40 líneas y es lo que
     diferencia un recorte "limpio" de uno "con aura".

3. 🟠 **Sin vista previa ni comparación.** El recorte se aplica directo como capa
   nueva. Canva/remove.bg muestran antes/después y permiten elegir. Sugerido:
   panel de resultado con toggle original/recorte, elección de motor, y botón
   "Refinar" que abra el `MaskEditor` en un solo flujo.

4. 🟠 **imgly (calidades Alta/Rápido) sigue en el hilo principal** — congela la
   UI durante 2-10 s. Si se cambia de modelo (punto 1), meter el nuevo en el
   mismo worker y eliminar imgly de una vez.

5. 🟡 **Resolución fija de 1024×1024** en RMBG: para fotos verticales o muy
   grandes la máscara se estira; funciona, pero un tiling en 2×2 para imágenes
   > 2000 px mejora bordes de cabello y objetos pequeños.

6. 🟡 **Mensajes de error sin contexto.** Sin internet la primera vez el error
   es "Failed to fetch". Debería decir "Necesitas internet para descargar el
   modelo la primera vez (o pulsa Preparar offline)".

7. ✅ Quitar fondo ya no sobreescribe el fondo elegido por el usuario (solo el
   blanco por defecto pasa a transparente).

## 2. Transparencias en todo el pipeline

| Punto | Estado |
|---|---|
| Lienzo transparente por defecto + tablero de ajedrez en el editor | ✅ correcto |
| Export PNG/WebP/AVIF conserva alfa | ✅ correcto |
| Export JPG rellena blanco si el lienzo es transparente | ✅ correcto (pero ver 8) |
| Filtros/duotono respetan alfa (`applyOverlayDuotone` salta píxeles alfa 0) | ✅ correcto |
| Sombra sigue la silueta de un PNG transparente | ✅ correcto (canvas shadow) |
| Borrador mágico (inpaint) conserva alfa original | ✅ correcto |
| **Optimizar HD (Swin2SR) perdía la transparencia** | ✅ **corregido en v0.2.1** (se reescala el alfa original y se reaplica) |
| GIF de páginas: aplana sobre blanco | 🟡 aceptable; GIF soporta 1-bit alfa, se podría ofrecer "fondo transparente" con umbral |
| Duotono: píxeles semitransparentes (alfa 1–254) se recoloran sin premultiplicar | 🟡 bordes de recortes pueden mostrar franja rara con duotono; corregir ponderando por alfa |
| `MaskEditor` borra con pincel de borde duro (clip circular) | 🟠 dientes de sierra en el borde; usar pincel con degradado radial y `destination-out` |

8. 🟠 **JPG con fondo transparente rellena blanco sin avisar.** El usuario que
   exporta un recorte como JPG cree que "se perdió la transparencia". Avisar en
   el menú de descarga ("JPG no admite transparencia; usa PNG o WebP") y
   preseleccionar PNG cuando el lienzo es transparente.

9. 🟡 **El `MaskEditor` no tiene zoom, deshacer ni suavidad de pincel** — para
   retocar cabello o bordes finos hace falta acercar. Añadir zoom con rueda,
   Ctrl+Z por trazo (guardar `ImageData` por trazo) y dureza del pincel.

## 3. Descarga y guardado

10. ✅ **Corregido en v0.2.1 — bug grave en la app instalada:** `<a download>`
    con `blob:` **no funciona en macOS (WKWebView) ni en Android WebView**, así
    que en esas plataformas "Descargar" no hacía nada. Ahora hay guardado
    nativo (diálogo Guardar como… en escritorio, `Descargas/ChamVa/` en móvil)
    con respaldo al método web. **Pendiente probar en un Mac y un Android reales.**
11. ✅ La descarga nunca estuvo bloqueada por licencia; el aviso de apoyo salía
    tras **cada** descarga, lo que se sentía como un muro. Ahora sale como
    máximo una vez al día.

## 4. Resto del programa

12. 🔴 **Sin archivo LICENSE.** Sigue siendo el pendiente #1 del repo público, y
    ahora con la restricción del punto 1 (AGPL/no-comercial) — decidir juntos.
13. 🟠 **Dependencia de red en tiempo de ejecución:** el borrador mágico carga
    `opencv.js` desde `docs.opencv.org` — si ese CDN cambia o no hay red, la
    función muere, y contradice el "100% offline". Empaquetar OpenCV con la app
    (`@techstark/opencv-js`) o usar un inpainting propio en WASM.
14. 🟠 **CSP desactivada** (`"csp": null` en `tauri.conf.json`). Con el OpenCV
    remoto y los modelos de HuggingFace hay que configurarla bien, pero dejarla
    en null en una app que abre archivos externos no es aceptable a largo plazo.
15. 🟠 **`App.tsx` (2.900+ líneas)** concentra toda la UI; cada función nueva lo
    engorda. Extraer paneles (PLAN-MEJORA #11) antes de que cueste el doble.
16. 🟡 **i18n parcial:** el chrome está en es/en, pero propiedades, avisos y el
    editor de video siguen en español. Completar el diccionario.
17. 🟡 **Sin tests:** `license.ts`, `refineEdges`, `restoreAlpha` y los
    exportadores son funciones puras ideales para Vitest.
18. 🟡 **Identificador `com.chamva.app`** (choca con `.app` en macOS) — cambiar
    en el próximo release mayor junto con regenerar el proyecto Android.
19. 🟡 **APK fuera de CI:** se compila y sube a mano. Añadir job de Android al
    workflow con el keystore como secreto de GitHub.

## 5. Qué haría primero (orden recomendado)

1. Decidir **licencia del proyecto + modelo de quitar fondo** (puntos 1 y 12) —
   bloquea todo lo demás legalmente.
2. **Descontaminación de color + refinado opcional** (punto 2): es la mejora de
   calidad visible más grande por menos código.
3. **Vista previa antes/después** del recorte con botón "Refinar" (punto 3).
4. **Aviso JPG/transparencia + PNG por defecto** (punto 8) — 20 minutos.
5. **OpenCV empaquetado + CSP** (13, 14).
6. Pincel suave, zoom y deshacer en el `MaskEditor` (puntos 9 y tabla).
