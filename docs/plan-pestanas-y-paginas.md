# Plan: pestañas de documentos, páginas apiladas y barra superior estilo Canva

Fecha: 2026-10-01 · Base: v0.5.0 (`c09eb1f`) + trabajo en curso de unidades (cm/mm/px/in + DPI).
Autor del plan: arquitectura (opus). Ejecutan: agentes `sonnet` por paquetes (sección E).

> Los números de línea se tomaron del árbol de trabajo del 2026-10-01, que ya trae cambios
> sin confirmar del agente de unidades en `store.ts`, `types.ts`, `App.tsx`, `HomeScreen.tsx`,
> `SizeMenu.tsx` e `io/project.ts`. Pueden moverse ±30 líneas: buscar por nombre, no por número.

**Dependencia:** el selector de tamaño (`src/editor/core/units.ts`, `Doc.unit/dpi`,
`src/ui/SizeFields.tsx`) lo hace OTRO agente. **Ningún paquete de este plan empieza hasta que
eso esté confirmado en `main`**, porque toca los mismos archivos (`types.ts`, `store.ts`, `App.tsx`).

---

## A. Hechos del código actual que condicionan el diseño

### Estado (`src/editor/state/store.ts`)
1. **Un solo store plano de Zustand** (`useEditor`, l. 496). El documento abierto es `doc`
   (la página actual, viva) + `pages` (todas) + `pageIndex`. **`pages[pageIndex]` está obsoleta
   mientras se edita**: la verdad es `doc`. Por eso el patrón «synced»
   `pages.map((p, i) => i === pageIndex ? doc : p)` aparece **26 veces en 11 archivos**
   (store.ts ×10, App.tsx ×5, PageBar ×3, runExport, ExportMoreDialog, BatchShareDialog,
   FindReplace, FontPicker, PageSorter, SnapshotsDialog, ErrorBoundary).
2. **El historial es por página y se BORRA al cambiar de página**: `switchPage` (l. 898-912),
   `addPage` (736), `duplicatePage` (757), `deletePage` (914), `loadPages` (952),
   `addResizedPage(s)`, `restorePages` y `editPages` (546, si cambia la página actual) ponen
   `past: [], future: []`. Hoy saltar a otra página y volver = perder el deshacer.
   En modo apilado (clic entre páginas constante) esto sería inaceptable.
3. `past/future` son `Doc[]` de la página actual, `HISTORY_LIMIT = 80` (l. 158). `commit()`
   (l. 402) añade el doc previo salvo dentro de un lote.
4. **El lote de deshacer es una variable de módulo** (`batching`, `batchTimer`, l. 129-130;
   `beginBatch/endBatch` l. 1162-1173), no está en el estado: un cambio de pestaña/página a
   mitad de lote lo arrastraría. Hay que cerrarlo (`endBatch()`) antes de cualquier cambio.
5. `structUndo` (l. 218, 855, 878, `undo` l. 1707-1724): deshacer de «proyecto entero» válido
   solo si `doc === docAfter && pageIndex === pageIndexAfter`. `deletePage` NO lo usa: borrar
   una página hoy no se puede deshacer.
6. `addPage` siempre añade AL FINAL (l. 746); `duplicatePage` solo duplica la página actual.
7. Maestra: `registerMasterPages` (l. 1771-1774) resuelve las páginas «synced» del store para
   dibujar/exportar. `MasterBackdrop.tsx` y `PageThumb.tsx` leen `s.doc`/`s.pages`.
8. Preferencias de vista en `localStorage['chamva.view']` (`loadView/viewPrefs`, l. 445-470):
   reglas, cuadrícula, guías, imán. Ahí cabe el nuevo `pageView`.
9. El módulo del store hace `document.createElement('canvas').getContext('2d')!` al importarse
   (l. 161) y lee `localStorage`: **no se puede importar en Vitest** (`vitest.config.ts`:
   `environment: 'node'`, solo `src/**/*.test.ts`). Toda lógica nueva que deba probarse va en
   **módulos puros** (como ya se hizo con `historyLogic.ts` y `core/pageOps.ts`).
10. `Doc` (`core/types.ts` l. 528-550): `name` es por página. No hay `title`, `hidden` ni
    `locked` de página. **El nombre del diseño es `pages[0].name`** (App.tsx l. 489).

### Identidad del diseño (bug latente que hay que arreglar primero)
11. **El id del diseño es el id de la PRIMERA página**: `SavedDesign.id` «id del doc de la primera
    página» (`io/designs.ts` l. 9), `upsertDesign({ id: first.id … })` (App.tsx l. 484-494),
    `designIdOf` en `io/undoStore.ts` l. 160, y los selectores de `SnapshotsDialog.tsx` l. 25 y
    `AutoVersionsDialog.tsx` l. 19. **Reordenar páginas (o borrar la primera) cambia el id**: el
    diseño aparece duplicado en Inicio y pierde versiones, versiones automáticas y deshacer
    persistente. Con «subir/bajar página» en cada cabecera esto pasaría a diario.

### Autoguardado y persistencia (`App.tsx`, `io/*`)
12. Arranque: `hydrate()` (App l. 432) + GC de imágenes a los 30 s (`gcAssets`, l. 433).
13. Recuperación: `idbGet('autosave')` → `{pages, index}` → `loadPages` + `restoreUndoFor`
    (l. 441-456). Una única clave `autosave` = un único documento abierto.
14. Autoguardado: `useEffect` con retardo de 1,2 s sobre `[doc, pages, pageIndex]`
    (l. 472-502): escribe `autosave`; cada ≥30 s `pushBackup`, `upsertDesign` (solo si hay capas
    o >1 página) y `maybeSaveAutoVersion`. **Si el efecto se desmonta o cambian las deps antes de
    1,2 s, el último cambio no se guarda** (el `clearTimeout` lo descarta). No hay `beforeunload`.
15. `idbSet` devuelve booleano y hay `setStorageErrorHandler` (App l. 425): ya hay señal real de
    error para el indicador de guardado.
16. Deshacer persistente (`io/undoStore.ts`): clave `undo:<designId>`, guarda solo la página
    actual (`UndoRecord.pageId`), escritura diferida 2,5 s (`UNDO_DEBOUNCE_MS`), se suscribe a
    cambios de `past`. Se inyecta el store por `UNDO_API` (App l. 105-109).
17. `gcAssets` (`io/assets.ts` l. 153-161) solo considera vivas las imágenes referenciadas desde
    `GC_KEYS` y `undo:*`. **Cualquier clave nueva con documentos que no se añada aquí verá sus
    imágenes borradas a los 30 s del arranque** (fallo silencioso con pérdida de datos).
18. `upsertDesign` recorta a `MAX_DESIGNS = 40` (`designs.ts` l. 30, 58).

### Lienzo (`src/editor/canvas/EditorCanvas.tsx`, 1072 l.)
19. **Un solo `Stage`** (l. 726) dentro de `div.canvas-area` (`containerRef`, l. 670) que es a la
    vez el contenedor de scroll, de zoom con rueda (l. 674-694), de paneo (l. 695-724), de gestos
    táctiles (`useTouchGestures(containerRef…)`, l. 337) y del cálculo de ajuste `fit()`
    (l. 444-463, usa `doc.width/height`).
20. Las capas (`ImageLayerNode`, `TextLayerNode`, `ShapeLayerNode`) leen `selectedId` del store y
    llaman a `updateLayer`, que **siempre actúa sobre `s.doc`**: no se pueden montar nodos
    interactivos de otra página sin reescribirlos.
21. Imán/guías/distancias usan `node.getClientRect({relativeTo: stage})` y `doc.width/height`
    (l. 189-221): coordenadas de la página con origen 0,0.
22. **Posicionamiento por `offsetLeft/offsetTop` del contenedor del Stage**: editor de texto en
    línea (l. 500-501), origen de las notas adhesivas (l. 581-586), `Minimap.tsx` l. 41. Funcionan
    porque `.canvas-area` es `position: relative` (`App.css` l. 2728-2730). Cualquier envoltorio
    posicionado nuevo entre ambos rompe estas posiciones.
23. `Rulers.tsx` mide con `getBoundingClientRect` del área y del Stage (l. 46-47): sigue sirviendo
    con varias páginas si se le pasa el Stage activo.
24. Visión de color (`ColorBlindView.tsx` l. 21) filtra `.canvas-area .konvajs-content`: una
    página dibujada como `<canvas>`/`<img>` estático no recibiría el filtro.

### Barra inferior y riel
25. `PageBar.tsx`: miniaturas (`PageThumb`), arrastrar para reordenar, ✕ borrar, «+ Agregar
    página», «Duplicar», «Clasificar» (`PageSorter`), «Maestra», y el menú **«Vista ▾»**
    (l. 194-264: guías, imán, minimapa, maquetación, notas, orador) + zoom (l. 267-280).
26. `core/pageOps.ts` ya tiene operaciones puras (`reorderOne`, `duplicateIndices`,
    `deleteIndices`, `moveIndicesTo`) **sin prueba propia**. `ui/pageActions.ts` tiene el patrón
    «si es la página actual `editDoc`, si no `editPages`» (solo para la maestra).
27. Riel (`RailPanels.tsx` l. 17-25): Subir (ya es la galería de subidas), Texto, Elementos,
    **Fondo (ya existe)**, Plantillas, Capas, Marca. Inicio usa `DesignFolders` (carpetas, ya
    hecho) dentro de `HomeScreen`.
28. Barra superior (App l. 1165-1373): «ChamVa» (→ Inicio), Archivo, `📐 W×H` (abre `SizeMenu`),
    Deshacer/Rehacer/Historial, Buscar, Quitar fondo, Más, Descargar, Ajustes. «Lote y compartir…»
    existe como comando de la paleta (`openBatchShare`, l. 1103) y `BatchShareHost` (l. 1627).
29. No hay biblioteca de audio ni de video: `VideoEditor.tsx` es un diálogo que trabaja con
    archivos sueltos.

### Coste de mover el estado a «sesiones» (medido con grep en `src/`)
- `useEditor(` selector: **295 llamadas en 51 archivos**; de ellas 81 leen directamente
  `doc/pages/pageIndex/past/future/selectedId(s)/zoom/viewScale`.
- `useEditor.getState()`: **64 llamadas en 17 archivos**; `useEditor.setState` ×3, `subscribe` ×1.
- Conclusión: **cualquier diseño que cambie la forma de `doc/pages/past/...` obliga a tocar ~50
  archivos**. El diseño de pestañas debe dejar esos campos planos tal cual (ver B.1).

---

## B. Pestañas de documentos (sesiones)

### B.1 Modelo: «aparcar y desaparcar», no fachada
La sesión ACTIVA sigue viviendo en los campos planos actuales (`doc`, `pages`, `pageIndex`,
`past`, `future`, `structUndo`, `selectedId(s)`, `zoom`…). Las INACTIVAS se guardan
«aparcadas» en un mapa. Cambiar de pestaña = copiar los campos planos al aparcamiento y cargar
los de la otra. Así **las 295 llamadas no cambian** y ningún componente sabe que hay pestañas,
salvo la tira de pestañas.

Se descarta la fachada/selector `activeSession(s).doc`: obliga a reescribir los 81 selectores
directos y los 64 `getState()`, y cada `set` del store (≈120 acciones) tendría que escribir
dentro de `sessions[i]`: es el mismo trabajo que reescribir el store.

Nuevos campos (todos en `store.ts`; la lógica, pura, en `src/editor/state/sessions.ts`):
```ts
interface TabMeta { id: string; designId: string; name: string; save: SaveState }
interface SessionSnapshot {            // lo que se aparca
  doc; pages; pageIndex; past; future; structUndo;
  pageHist;                            // historial por página (B.2 / paquete P1)
  selectedId; selectedIds; zoom; designId; designName; pageView;
  scroll?: { left: number; top: number };   // posición del área de lienzo
}
tabs: TabMeta[]; activeTabId: string; parked: Record<string, SessionSnapshot>;
```
- **Por sesión**: lo de arriba. `zoom` y `pageView` (sencilla/apilada) también, como en Canva.
- **Global (no cambia)**: `uploads`, `templates`, `brandKits/activeBrandKitId/brandColors/
  brandLogos/brandFonts`, `customFonts`, `recentColors`, `showRulers/showGrid/showGuides/
  snapToGrid/showNotes/showLayout/showRespect`, `textEditNonce`, `animPlayNonce`.
- **Transitorio, se reinicia al cambiar**: `cropMode/cropRect/cropAspect` (cancelar),
  `editingTextId` y `textSel` (cerrar el editor ANTES, ver B.5), `selRect: null`, `viewScale`
  (lo recalcula `fit()`).
- Componentes que no deben seleccionar `parked` (re-render): regla de revisión.

Acciones nuevas: `openTab(p: {pages, index, designId, name})`, `newTab(size)`,
`switchTab(id)`, `closeTab(id)`, `reorderTabs(from, to)`. `loadPages/newDesign` siguen
reemplazando la pestaña activa (compatibilidad: abrir proyecto, restaurar copia, Tauri «abrir con»).

### B.2 Requisitos previos que salen antes (v0.6.0, paquete P1)
- **`designId` y `designName` estables en el estado** (arregla el hecho 11). `loadPages(pages,
  index, meta?: {designId, name})`; sin `meta` → `pages[0].id`/`pages[0].name` (migración
  automática: todo diseño existente conserva su id). `newDesign` → `designId = blank.id`.
  `designIdOf` de `undoStore.ts`, `SnapshotsDialog`, `AutoVersionsDialog` y el `upsertDesign`
  del autoguardado pasan a usar `s.designId`. El nombre del diseño deja de ser `pages[0].name`.
- **Historial por página conservado**: `pageHist: Record<pageId, {past, future, base: Doc}>`.
  `switchPage` guarda el de la página que sale y restaura el de la que entra **solo si
  `pages[i] === base`** (igualdad de referencia: si `patchOtherPages`, `recolorOtherPages` o
  `editPages` la cambiaron, el historial se descarta). LRU de 12 páginas. Útil también en modo
  clásico (cambio visible: ya no se pierde el deshacer al cambiar de página).
- **Sin esto las pestañas no son viables** (cada pestaña necesita su designId propio) y las
  páginas apiladas tampoco (deshacer perdido en cada clic).

### B.3 Persistencia y autoguardado por pestaña (v0.7.0)
- Claves IndexedDB nuevas: `tabs` = `{ order: TabMeta[], activeId }` y `tab:<tabId>` =
  `{ pages (deshidratadas), index, designId, name, savedAt }`. **Añadir `'tabs'` a `GC_KEYS`
  y recorrer `idbKeys('tab:')` en `gcAssets` igual que `undo:`** (hecho 17).
- La clave `autosave` se sigue escribiendo para la pestaña activa (compatibilidad hacia atrás:
  si el usuario vuelve a v0.6 recupera lo último que editó).
- El autoguardado se extrae de App a `src/io/autosave.ts` (P3) con `scheduleSave()` y
  **`flushSave(): Promise<boolean>`**. Antes de `switchTab/closeTab/openTab` se llama a
  `flushSave()` para la sesión saliente (hecho 14: si no, se pierde el último segundo de trabajo).
- `undoStore.ts` exporta `flushUndo(store)` (fuerza `persistNow` si hay temporizador) y se llama
  también antes del cambio; después `restoreUndoFor` para la entrante si su `past` está vacío.
- Las sesiones aparcadas se guardan en memoria (rehidratadas) para que el cambio sea
  instantáneo; su copia en `tab:<id>` ya está escrita por el `flushSave` previo.

### B.4 Abrir, cerrar, ordenar, límite
- **Inicio → Abrir**: si `designId` ya está abierto en otra pestaña, se enfoca esa pestaña
  (**nunca dos pestañas con el mismo `designId`**: se pisarían en `upsertDesign`, `undo:` y
  versiones). Si no, `openTab`. Si la pestaña activa está vacía (1 página, 0 capas, sin
  historial), se reutiliza en vez de abrir otra.
- **«+»**: abre Inicio en modo «nueva pestaña»; elegir tamaño/plantilla → `newTab`.
- **Cerrar ✕** (y clic central): `flushSave()`. Si devuelve `true` se cierra sin preguntar
  (el diseño está en Inicio; un diseño vacío simplemente se descarta). Si `false` (error de
  almacenamiento) → confirmación «No se pudo guardar este diseño en el equipo. ¿Guardarlo como
  archivo (.chamva) antes de cerrar?» [Guardar archivo] [Cerrar sin guardar] [Cancelar].
  La última pestaña no se cierra: se sustituye por un diseño vacío y se muestra Inicio.
- **Ordenar**: arrastrar con HTML5 DnD (mismo patrón que `PageBar` l. 78-85).
- **Límite: 8 pestañas** (cada sesión aparcada mantiene imágenes rehidratadas y hasta 80 pasos
  por página en memoria). Al pasar del límite: aviso y no se abre.
- Atajos (registro `core/shortcuts.ts`): `Ctrl+Alt+N` nueva, `Ctrl+Alt+W` cerrar,
  `Ctrl+Tab`/`Ctrl+Shift+Tab` siguiente/anterior (en el navegador PWA el navegador puede
  capturar `Ctrl+Tab`: queda la paleta de comandos).

### B.5 Migración y restauración
- Primer arranque con v0.7: no hay `tabs` → se lee `autosave` como hoy y se crea una pestaña
  con `designId = pages[0].id` (o el `designId` que P1 ya guardó en `autosave`). Nada se pierde.
- Arranques siguientes: se lee `tabs`, se rehidrata SOLO la pestaña activa al inicio; las demás
  se rehidratan perezosamente al activarlas (arranque rápido). Una `tab:<id>` dañada se omite con
  aviso, nunca bloquea el arranque.
- Antes de aparcar: `endBatch()`, cerrar recorte, y si `editingTextId` → desenfocar el editor
  en línea (`InlineTextEditor` confirma en `onBlur`, l. 289) y aparcar en el siguiente tick.

### B.6 Riesgos de pestañas y cómo detectarlos
| Riesgo | Detección |
|---|---|
| GC borra imágenes de pestañas inactivas | Prueba: abrir 2 pestañas con fotos, esperar 35 s, reiniciar, abrir la inactiva: fotos presentes. Prueba unitaria de `collectRefs` sobre un registro `tab:`. |
| Último cambio perdido al cambiar de pestaña | Editar, cambiar de pestaña antes de 1 s, recargar: el cambio está. |
| Mismo diseño en 2 pestañas | Prueba pura de `findTabByDesign`; en pantalla: abrir dos veces desde Inicio → una pestaña. |
| Lote de deshacer arrastrado | Arrastrar grupo y pulsar `Ctrl+Alt+N` a mitad: deshacer en ambas pestañas es coherente. |
| Deshacer persistente de la pestaña equivocada | Editar A, cambiar a B < 2,5 s, recargar, abrir A: Ctrl+Z deshace el paso de A. |
| Memoria | `MemoryMeter` con 8 pestañas de 10 páginas con fotos; no superar el umbral de aviso. |

---

## C. Páginas apiladas (modo que se activa; el clásico sigue siendo el predeterminado)

### C.1 Estrategia de render: UNA página viva + las demás como imagen
Opciones evaluadas:
- **Un Stage interactivo por página**: imposible sin reescribir los nodos de capa, que leen
  `selectedId` y escriben siempre en `s.doc` (hecho 20); además N Stages × capas pesadas.
- **Un solo Stage alto con todas las páginas**: rompe todo lo que asume origen 0,0 y tamaño
  `doc.width/height` (imán, guías, distancias, recorte, editor en línea, exportar selección,
  gestos, reglas: hechos 21-23) y choca con el tamaño máximo de canvas del navegador
  (30 páginas × 1080 px × zoom × DPR supera 16-32 k px → lienzo en blanco).
- **Elegida: página activa = el `Stage` actual (sin cambios en su lógica); páginas inactivas =
  `PageStill`** (imagen de `renderDocToCanvas(doc, scale·dpr)`, la misma función que exporta y
  que ya pinta la maestra), **virtualizada con `IntersectionObserver`** (`rootMargin` de una
  pantalla; fuera de él solo un hueco con el tamaño correcto). Clic en una página inactiva →
  `switchPage(i)` y el Stage se monta en su hueco. Con el historial por página de P1 el cambio
  no pierde nada. Coste: re-render de la imagen solo al cambiar su firma (como `PageThumb`:
  `version-capas-tamaño-fondo-maestra`) o el zoom (con 250 ms de retardo; mientras tanto se
  escala la imagen anterior por CSS).

Para reutilizar `EditorCanvas` se parte en dos (paquete P4, sin cambiar comportamiento):
- `CanvasViewport` (área de scroll): rueda/zoom, paneo, gestos táctiles, `fit()`, reglas,
  minimapa, insignia de transparente. Recibe `children`.
- `PageStage` (lo demás): Stage, Transformer, imán, guías, recorte, notas, editor en línea,
  antes/después. Envuelto en `div.page-stage` con `position: relative` y **el editor en línea,
  las notas y `BeforeAfterSlider` dentro de ese envoltorio**, para que `offsetLeft/Top` sean
  relativos a él en ambos modos (hecho 22).

### C.2 Zoom, scroll y ayudas en modo apilado
- **Zoom único** para todas las páginas. `fit` apilado = `min(1, (anchoÁrea − 48)/maxAncho,
  (altoÁrea − 48 − 36)/maxAlto) × zoom` sobre TODAS las páginas: la escala no salta al cambiar de
  página. Rueda con zoom hacia el cursor igual que hoy; sin Ctrl la rueda desplaza (hoy la rueda
  siempre hace zoom: en apilado, **zoom = Ctrl+rueda**, rueda sola = scroll; en clásico, igual que
  hoy).
- **Página activa por scroll**: al terminar el scroll (150 ms) se activa la página más visible,
  **solo si no hay selección ni texto en edición** (así «Texto» del riel añade a la página que se
  ve). Al activar una página desde `PageBar`/Buscar y reemplazar → `scrollIntoView` de su tarjeta.
- Reglas: se miden contra el Stage activo (funciona sin cambios, hecho 23). Cuadrícula, guías,
  imán, maquetación, zona de respeto y distancias: solo en la página activa (son del Stage).
- **Minimapa: oculto en modo apilado** (v1); el scroll largo ya cumple su función.
- Notas adhesivas: solo en la página activa (no se exportan; en las imágenes no aparecen).
- Gestos: `useTouchGestures` sigue sobre el área de scroll; el pellizco cambia el zoom global;
  el paneo de dos dedos desplaza la pila.
- Visión de color: añadir la clase `.page-still` al selector de `ColorBlindView` (hecho 24).
- Selección y arrastre entre páginas: **no se permite arrastrar capas de una página a otra** en
  v1 (el Stage solo existe en la activa). Se puede Cortar/Copiar → clic en otra página → Pegar
  (el portapapeles interno `clipLayer` de App ya sobrevive a `switchPage`). «Mover a página ▸» en
  el menú contextual queda como idea para después.

### C.3 Cabecera por página y acciones
`PageHeader` encima de cada tarjeta: «Página N · [Agregar título de página]» + iconos:
| Acción | Implementación |
|---|---|
| Título | `Doc.title?: string` (nuevo, opcional). Campo en línea; guarda con `patchPage` (abajo). En la miniatura de `PageBar` como `title` del botón. Se exporta en PDF como nombre de marcador si el exportador lo admite; si no, se ignora. |
| Subir / Bajar | `reorderPages(i, i∓1)` (ya existe). Con P1 ya no cambia el id del diseño. |
| Ocultar | `Doc.hidden?: boolean`. La tarjeta se pliega a solo la cabecera con «Oculta · no se exporta ni se presenta» y botón «Mostrar». En `PageBar` miniatura atenuada con icono de ojo tachado. |
| Bloquear | `Doc.locked?: boolean`. Helper puro `isLayerLocked(doc, l) = !!doc.locked \|\| !!l.locked` sustituye las comprobaciones de `l.locked` que deciden arrastrar/transformar/borrar: `EditorCanvas` (Transformer, l. 475), `*LayerNode` (draggable), App (Supr y flechas, l. 394-399), `useTouchGestures`, `PropertiesPanel` (aviso «Página bloqueada»). Añadir capas a una página bloqueada sí se permite. |
| Duplicar | `duplicatePage(i?: number)` (por defecto la actual: compatibilidad). |
| Borrar | `deletePage(i)` **con `structUndo`** (P1) + toast «Página borrada» con botón Deshacer. |
| «+» debajo | `addPage(afterIndex?: number)`; sin argumento sigue añadiendo al final (PageBar). |

`ui/pageActions.ts` se generaliza con `patchPage(pageId, fn)` (actual → `editDoc`, otra →
`editPages`) y `setPageTitle/setPageHidden/setPageLocked` encima; `setPageMaster/Id` lo reutilizan.

### C.4 Maestra, notas y exportación
- Maestra: se marca en la cabecera («Maestra»); la página que usa maestra se dibuja con ella
  porque `renderDocToCanvas` ya la resuelve (`PageStill` incluye `masterRevision` en su firma).
- **Páginas ocultas**: excluidas de «Descargar todas», PDF, GIF/APNG/video de varias páginas,
  presentación (`Presentation`, App l. 1514), presentación HTML, `ExportMoreDialog` y lote.
  Incluidas en proyecto `.chamva`, autoguardado, copias, versiones y `PageSorter`. Exportar «esta
  página» con una oculta activa sí la exporta (acción explícita). Helper puro
  `exportablePages(pages)` en `core/pageOps.ts`; aplicarlo en `io/runExport.ts` l. 157,
  `App.tsx` l. 942 y 1514, `ExportMoreDialog.tsx` l. 131, `BatchShareDialog.tsx` l. 30, y el
  `pageCount` de `DownloadMenu`. Si todas están ocultas: toast y no exporta.

### C.5 Activar el modo y qué pasa con `PageBar`
- Preferencia `pageView: 'single' | 'stacked'` en `chamva.view` (por defecto `'single'`), y por
  sesión en v0.7. Interruptor «Páginas en vertical» en **Vista ▾** (`PageBar.tsx` l. 207-262),
  comando en la paleta («Vista: páginas en vertical») y atajo personalizable `Ctrl+Alt+P`.
- `PageBar` en apilado: se conserva (miniaturas, clasificar, maestra, vista, zoom); clic en una
  miniatura = activar + desplazar a la tarjeta. En clásico, sin cambios salvo los iconos de oculta
  y bloqueada.

---

## D. Barra superior estilo Canva y riel

- **Nombre del diseño editable**: `DesignNameField` junto a «ChamVa». Lee/escribe `designName`
  (P1) con `setDesignName` (sin paso de deshacer, como Canva); se persiste en
  `SavedDesign.name`, en `autosave` y en `tab:<id>`. Al guardar `.chamva` se usa como nombre de
  archivo propuesto. Enter/Escape/blur; vacío → «Diseño sin título».
- **Indicador de guardado**: `src/io/saveStatus.ts` (almacén mínimo con
  `useSyncExternalStore`): `'idle' | 'pending' | 'saving' | 'saved' | 'error'` + `savedAt`.
  Lo alimenta `io/autosave.ts`: `pending` al programar, `saving` antes de `idbSet('autosave')`,
  `saved` si devuelve `true`, `error` si `false` o si salta `setStorageErrorHandler`. Icono de
  nube con texto «Guardado en este equipo» / «Guardando…» / «Sin guardar: espacio lleno» (clic →
  Guardar proyecto como archivo). No dice «nube»: todo es local.
- **Redimensionar**: el botón `📐 W×H` (App l. 1233) pasa a «⤢ Redimensionar · W×H» y sigue
  abriendo `SizeMenu` (cuyo interior es del agente de unidades: no tocarlo).
- **Compartir**: botón a la izquierda de «Descargar» que llama a `openBatchShare()`.
- **Riel**:
  - «Fondo»: ya existe. «Fotos»: lo que hay es la galería de «Subir»; un banco de fotos exige
    servidor → **descartado**; no se duplica la pestaña.
  - «Audio» / «Videos»: no hay biblioteca que mostrar (hecho 29) → **descartados**.
  - **«Proyectos»** (nuevo): `ProjectsPanel.tsx` reutiliza `DesignFolders` + `loadDesigns`. En
    v0.6 abrir = como en Inicio (autoguarda y sustituye); en v0.7 abre en pestaña nueva (B.4).
  - Traductor y comentarios: fuera de alcance. «Compartir» con enlace/colaboración: exige
    servidor, descartado.

---

## E. Paquetes de trabajo

Reglas comunes para todos: rama propia `feat/<paquete>`; el agente **no hace commit ni push**;
entrega `npx tsc --noEmit`, `npm test` (todas verdes, con el número de pruebas antes/después) y
capturas del navegador (`npm run dev`) de los criterios. Textos de interfaz en español y con `t()`
cuando el componente vecino lo use. Nada de cambiar firmas existentes sin parámetro opcional.

### v0.6.0

**P1 · Núcleo de páginas e identidad del diseño** — sonnet, esfuerzo alto · **REVISIÓN OPUS**
- Objetivo: B.2 completo + `addPage(afterIndex?)`, `duplicatePage(i?)`, `deletePage` con
  `structUndo`, `setDesignName`.
- Archivos propios: `src/editor/state/pageHistory.ts` (puro: `stash`, `restore`, LRU),
  `src/editor/state/pageHistory.test.ts`, `src/editor/core/pageOps.test.ts` (nuevo, cubre también
  las funciones ya existentes), `src/editor/core/pageOps.ts` (añadir `insertAt`).
- Hunks permitidos: `store.ts` (estado `designId/designName/pageHist`, acciones de página,
  `loadPages/newDesign/loadDoc` con `meta?`); `io/undoStore.ts` (`designIdOf` → `s.designId`,
  ampliar `UndoStoreApi.getState`); `SnapshotsDialog.tsx` l. 25 y `AutoVersionsDialog.tsx` l. 19
  (selector); `App.tsx` solo el bloque de autoguardado (l. 472-502: `id: st.designId`,
  `name: st.designName`, y `designId/name` dentro de `autosave`), la recuperación (l. 441-456) y
  `openDesign` (l. 311-317: pasar `{designId: d.id, name: d.name}`).
- Aceptación (Vitest): restaurar historial solo si `pages[i] === base`; LRU expulsa la 13.ª;
  `insertAt`; `exportablePages` aún no. En pantalla: deshacer sobrevive a ir a página 2 y volver;
  reordenar páginas NO crea un segundo diseño en Inicio y conserva «Versiones…»; borrar página y
  Ctrl+Z la recupera; un diseño guardado con v0.5 abre con su id de siempre.
- Riesgo principal: migración silenciosa del id (diseños duplicados o versiones huérfanas).

**P2 · Campos de página: título, oculta, bloqueada** — sonnet, medio (depende de P1)
- Archivos propios: `ui/pageActions.ts` (`patchPage` y setters), `core/pageOps.ts`
  (`exportablePages`, `isLayerLocked`) y su prueba.
- Hunks: `core/types.ts` (3 campos opcionales en `Doc`), `runExport.ts` l. 157, `App.tsx` l. 942
  y 1514, `ExportMoreDialog.tsx` l. 131, `BatchShareDialog.tsx` l. 30, `DownloadMenu` (conteo),
  comprobaciones de bloqueo (C.3), `PageBar.tsx` (iconos y menú contextual de la miniatura:
  ocultar/bloquear/título), `PageSorter.tsx` (mostrar estado).
- Aceptación: pruebas puras de `exportablePages` (todas ocultas → `[]`) e `isLayerLocked`;
  en pantalla, página oculta no sale en PDF de todas ni en presentación pero sí en `.chamva`;
  página bloqueada: no se arrastra, ni Supr ni flechas; desbloquear devuelve todo.
- Riesgo: olvidar una ruta de exportación (grep de `pageIndex ? ` en la revisión).

**P3 · Barra superior** — sonnet, medio (depende de P1; paralelo a P2 si no tocan el mismo
hunk de App: P3 toca la cabecera l. 1165-1373 y el bloque de autoguardado ya movido)
- Archivos propios: `src/io/autosave.ts` (sacar el efecto de App: `startAutosave(api)`,
  `scheduleSave`, `flushSave`), `src/io/saveStatus.ts` + prueba de transiciones,
  `src/ui/DesignNameField.tsx`, `src/ui/SaveIndicator.tsx`, `src/ui/topbar.css`.
- Hunks: `App.tsx` (cabecera y sustituir l. 469-502 por `startAutosave`), `Icon.tsx` si falta
  el icono de nube.
- Aceptación: prueba de `saveStatus` (pending→saving→saved; error con `idbSet` falso);
  en pantalla: renombrar se refleja en Inicio; desconectar IndexedDB (DevTools → bloquear
  almacenamiento) muestra «Sin guardar»; «Redimensionar» y «Compartir» abren lo de siempre.
- Riesgo: cambiar el ritmo del autoguardado (debe seguir: 1,2 s / galería cada 30 s).

**P4 · Partir EditorCanvas sin cambiar comportamiento** — sonnet, alto (depende de nada; hacer
después de P1-P3 para no chocar en revisiones; no en paralelo con P5)
- Archivos propios: `editor/canvas/CanvasViewport.tsx`, `editor/canvas/PageStage.tsx`;
  `EditorCanvas.tsx` queda como composición de ambos (mismo export, App no cambia).
- Hunks: `App.css`/`view.css` (`.page-stage { position: relative }`), `Minimap.tsx` si sus
  `offset*` dejan de cuadrar.
- Aceptación: la lista F completa en modo clásico, idéntica a v0.5 (editor de texto en línea en
  su sitio con reglas y con zoom 300 %, notas, minimapa, gestos táctiles en modo tableta).
- Riesgo: desfase de posiciones por `offsetParent` (hecho 22).

**P5 · Modo apilado** — sonnet, alto (depende de P1, P2, P4)
- Archivos propios: `editor/canvas/PageStack.tsx`, `PageCard.tsx`, `PageStill.tsx`,
  `ui/PageHeader.tsx`, `ui/pagestack.css`, `editor/canvas/stackLayout.ts` (puro: escala común,
  página más visible a partir de rectángulos) + `stackLayout.test.ts`.
- Hunks: `store.ts` (`pageView` en `ViewPrefs` + `togglePageView`), `EditorCanvas.tsx`
  (elegir hijo según `pageView`), `PageBar.tsx` (opción en Vista ▾, clic = desplazar),
  `core/shortcuts.ts` (acción `pageView`), `App.tsx` (comando de paleta), `ColorBlindView.tsx`.
- Aceptación: pruebas de `stackLayout` (escala común, página más visible, empate); en pantalla
  con 30 páginas 1080×1080: scroll fluido, solo ~3-5 `PageStill` montadas (contar en DevTools),
  clic en página inactiva la activa sin perder deshacer, todas las acciones de cabecera, «+»
  inserta debajo, Ctrl+rueda = zoom, volver a clásico deja todo igual.
- Riesgo: rendimiento/memoria de las imágenes (vigilar `MemoryMeter`; liberar `canvas` al salir
  del `rootMargin`).

**P6 · Riel «Proyectos»** — sonnet, medio (paralelo a P4/P5: archivos distintos)
- Archivos propios: `ui/ProjectsPanel.tsx`. Hunks: `RailPanels.tsx` (pestaña + prop
  `onOpenDesign`), `App.tsx` (pasar `openDesign`).
- Aceptación: lista y carpetas iguales a Inicio; abrir un diseño autoguarda el actual primero
  (`flushSave` de P3) y lo carga.
- Riesgo: abrir antes de que termine el autoguardado del actual.

### v0.7.0

**P7 · Sesiones en el store** — sonnet, alto · **REVISIÓN OPUS**
- Archivos propios: `editor/state/sessions.ts` (puro: `park(state)`, `unpark(snapshot)`,
  `findTabByDesign`, `nextActiveAfterClose`, `isBlankSession`) + `sessions.test.ts`.
- Hunks: `store.ts` (`tabs/activeTabId/parked`, acciones de B.1, `endBatch` y cierre de recorte
  antes de aparcar).
- Aceptación: pruebas puras (aparcar→desaparcar devuelve los mismos objetos por referencia;
  global intacto; cerrar la activa elige la vecina derecha, si no la izquierda). En pantalla aún
  sin UI: por la consola `useEditor.getState().newTab()` / `switchTab()` funcionan.
- Riesgo: un campo por sesión olvidado que «se filtra» entre pestañas (la prueba enumera todas
  las claves de `EditorState` y exige clasificarlas como sesión/global/transitoria).

**P8 · Persistencia de pestañas** — sonnet, alto · **REVISIÓN OPUS** (depende de P7)
- Archivos: `io/tabsStore.ts` (`saveTab`, `loadTabs`, migración desde `autosave`) + prueba;
  hunks en `io/assets.ts` (`GC_KEYS` + `idbKeys('tab:')`), `io/undoStore.ts` (`flushUndo`),
  `io/autosave.ts` (escribir `tab:<id>`), `App.tsx` (arranque).
- Aceptación: B.6 completo; prueba de `collectRefs` sobre `tab:`; quitar `tabs` de IDB y
  arrancar = migración desde `autosave` sin pérdida.
- Riesgo: GC borrando imágenes (hecho 17).

**P9 · Tira de pestañas e integración con Inicio** — sonnet, medio (depende de P8)
- Archivos propios: `ui/TabStrip.tsx`, `ui/tabs.css`, `ui/CloseTabDialog.tsx`.
- Hunks: `App.tsx` (montar la tira sobre `header.toolbar`, `openDesign` → `openTab`, «+» →
  Inicio en modo pestaña), `HomeScreen.tsx` (prop `mode`), `ProjectsPanel.tsx`,
  `core/shortcuts.ts`.
- Aceptación: B.4 completo en pantalla; límite de 8; arrastrar para ordenar; cerrar con error
  de almacenamiento simulado muestra el diálogo; reabrir la app restaura pestañas y la activa.
- Riesgo: dos pestañas con el mismo diseño.

Orden: P1 → (P2 ∥ P3) → P4 (∥ P6) → P5 → publicar v0.6.0 → P7 → P8 → P9 → v0.7.0.
Cada paquete deja la app usable: P1-P3 no cambian la vista; P4 es refactor puro; P5 está tras un
interruptor apagado por defecto; P7 no tiene UI; P8 sin UI mantiene una sola pestaña.

---

## F. Regresión tras cada paquete y pruebas nuevas

Comprobar en pantalla (modo clásico siempre; apilado desde P5; con 2 pestañas desde P9):
1. Crear diseño desde Inicio, añadir texto, imagen, forma; mover, girar, escalar; Ctrl+Z/Y.
2. Editar texto en línea (doble clic) con zoom 50 % y 300 % y con reglas: el editor cae encima.
3. Selección múltiple y arrastre de grupo = un solo paso de deshacer.
4. Recorte de imagen (aplicar y cancelar); quitar fondo.
5. Guías desde reglas, imán, cuadrícula, maquetación, distancias.
6. Notas adhesivas: crear, mover, borrar. Minimapa (clásico).
7. Páginas: añadir, duplicar, borrar, reordenar, maestra (aplicar y quitar), clasificador.
8. Buscar y reemplazar en varias páginas (salta de página).
9. Descargar PNG página / todas / PDF; presentación; «Lote y compartir…».
10. Recargar la app: recupera diseño, página y deshacer; Inicio muestra UN solo diseño.
11. Versiones y versiones automáticas del diseño correcto.
12. Modo tableta: pellizco, paneo con dos dedos, doble toque.
13. Visión de color (todas las páginas filtradas en apilado).

Pruebas Vitest nuevas: `pageOps.test.ts`, `pageHistory.test.ts`, `saveStatus.test.ts`,
`stackLayout.test.ts`, `sessions.test.ts`, `tabsStore.test.ts`, y ampliar
`undoStore.test.ts` (`designId` explícito) y `shortcuts.test.ts` (sin conflictos con los atajos
nuevos). Todo puro (sin importar `store.ts`, hecho 9).

---

## G. Tamaño y recomendación

- **9 paquetes**: P1 y P7-P8 de riesgo alto (estado central, persistencia, GC), P4-P5 de riesgo
  medio-alto pero visible en pantalla, P2/P3/P6/P9 medio. Del orden de 3 000-4 000 líneas nuevas o
  movidas (P4 mueve ~900 sin cambiarlas).
- **Recomendación: partir en dos versiones.**
  - **v0.6.0** = unidades (otro agente) + P1-P6: identidad estable del diseño, deshacer por
    página, campos de página, barra superior, páginas apiladas, riel Proyectos.
  - **v0.7.0** = P7-P9: pestañas.
- Por qué: las pestañas son la única parte cuyo fallo es **silencioso y con pérdida de datos**
  (GC de imágenes, último cambio sin guardar, deshacer de otra pestaña, dos pestañas sobre el
  mismo diseño), y dependen de P1 y de `io/autosave.ts` (P3). Publicarlas junto al modo apilado
  mezclaría dos fuentes de regresión en la misma versión y haría imposible saber cuál rompió el
  autoguardado. El modo apilado, en cambio, va tras un interruptor apagado por defecto y casi
  todo su riesgo se ve en pantalla. Además, P1 arregla ya en v0.6 el duplicado de diseños al
  reordenar páginas, que los botones subir/bajar harían frecuente.
