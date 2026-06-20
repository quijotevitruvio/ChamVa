# ChamVa — Plan Técnico Completo

Editor de imágenes/diseño libre, tipo Canva, **sin restricciones de transparencia**,
con **quitar fondo 100% local (offline)**, exportación a **todos los formatos (incl. WebP)**,
subida de imágenes, lienzos de cualquier tamaño y redimensionado.

**Objetivo de plataformas:** Android (APK) + Windows (instalador) + Linux. iOS queda fuera
(requeriría macOS/Xcode; el código no cambiará el día que se quiera añadir).

---

## 1. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Plataformas | **Android + Windows + Linux** (todo compilable desde Windows) | Requisito del usuario |
| Stack | **Tauri 2 + React + TypeScript + Konva.js** | Es el enfoque de Canva (web+canvas); edición profesional lista |
| Quitar fondo | **100% local / offline** (ONNX RMBG/U²-Net) | Gratis, sin límites, privado, sin internet |
| Punto de partida | Plan técnico completo (este documento) | Antes de programar |
| Arquitectura | **Web-first** (un solo código de UI) empaquetado nativo | Escribir una vez, correr en las 3 plataformas |

---

## 2. El stack recomendado (y por qué)

Como necesitas **una sola base de código** para escritorio Y móvil, lo más eficiente es
un **editor web** (HTML/Canvas) reutilizado en todos lados, empaquetado de forma nativa.

### Stack principal

- **Lenguaje/UI:** TypeScript + **React**
- **Motor de lienzo/capas:** **Konva.js** (`react-konva`) — drag, escala, rotación,
  transform handles, capas, eventos táctiles. Es lo que evita reinventar el editor.
- **Estado:** Zustand (simple) + estructura de "documento" en JSON.
- **IA quitar fondo (local):** **onnxruntime-web** (WASM + WebGPU) o **transformers.js**
  con el modelo **RMBG-1.4** / U²-Net. Corre dentro de la app, sin servidor.
- **Procesamiento de imagen / filtros:** Canvas 2D + WebGL (shaders) para brillo,
  contraste, saturación, desenfoque, etc.
- **Exportación:** Canvas API (PNG/JPG/WebP), `jsPDF`/`pdf-lib` (PDF), SVG nativo.
- **Empaquetado multiplataforma:** **Tauri 2** (Windows + Android + iOS desde el mismo
  frontend web, con núcleo Rust para tareas pesadas).
  - *Alternativa móvil si Tauri móvil da problemas:* **Capacitor** para Android/iOS y
    Tauri/Electron solo para Windows. (Mismo frontend en ambos casos.)

### Por qué Tauri 2 y no Electron/Flutter

- **Tauri 2** soporta Windows, macOS, Linux, **Android e iOS** con el **mismo frontend web**.
  Instaladores ligeros (~10 MB en escritorio) y permite mover la IA pesada a Rust.
- **Electron** no hace móvil (solo escritorio) → quedaría fuera del requisito Android/iOS.
- **Flutter** es excelente multiplataforma pero implica **reescribir el editor en Dart**
  y su ecosistema de edición de imagen/IA es más artesanal. Con Tauri reutilizas Konva.

> Punto de atención: Tauri móvil es relativamente nuevo. El plan está diseñado para que
> el **frontend sea 100% independiente del empaquetado**, así si hay que cambiar a
> Capacitor para móvil, no se reescribe nada del editor.

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────┐
│                 UI (React)                    │
│  Barra herramientas · Panel capas · Lienzo    │
├─────────────────────────────────────────────┤
│            Núcleo del Editor (TS)             │
│  Documento (JSON) · Comandos · Undo/Redo      │
│  Konva (render interactivo)                    │
├───────────────┬───────────────┬──────────────┤
│  Motor IA      │  Exportador   │  Importador   │
│  (ONNX local)  │  PNG/WebP/PDF │  upload/drag  │
├───────────────┴───────────────┴──────────────┤
│        Capa nativa (Tauri / Rust)             │
│  Sistema de archivos · IA acelerada · share   │
└─────────────────────────────────────────────┘
```

**Idea central (igual que Canva):** el diseño NO se guarda como imagen, se guarda como
un **documento JSON de capas**. Render y exportación son funciones puras que reciben ese
JSON y producen píxeles (PNG/WebP) o vectores (SVG/PDF). Esto habilita undo/redo,
redimensionado, export multi-formato y plantillas, todo "gratis".

---

## 4. Modelo de datos del "documento"

```ts
type Doc = {
  id: string;
  name: string;
  width: number;          // tamaño del lienzo en px
  height: number;
  background: string | null;   // color o null = transparente
  layers: Layer[];
  version: number;
};

type Layer =
  | ImageLayer
  | TextLayer
  | ShapeLayer;

type Base = {
  id: string;
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number;
  opacity: number;            // 0..1
  blendMode: BlendMode;       // 'normal' | 'multiply' | ...
  visible: boolean;
  locked: boolean;
};

type ImageLayer = Base & {
  type: 'image';
  src: string;                // ruta local / base64 / blob
  filters: Filter[];          // brillo, contraste, etc.
  hasAlpha: boolean;          // transparencia respetada SIEMPRE
};

type TextLayer = Base & {
  type: 'text';
  text: string; font: string; size: number;
  color: string; align: 'left'|'center'|'right';
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
};

type ShapeLayer = Base & {
  type: 'shape';
  shape: 'rect'|'ellipse'|'line'|'polygon'|'svgPath';
  fill: string; stroke?: { color: string; width: number };
  path?: string;              // para SVG
};
```

---

## 5. Estructura de carpetas

```
ChamVa/
├─ src/
│  ├─ app/                 # arranque React, layout
│  ├─ editor/
│  │  ├─ core/             # Doc, comandos, undo/redo, serialización
│  │  ├─ canvas/           # componentes react-konva (capas, transformer)
│  │  ├─ tools/            # mover, recortar, texto, formas, mano
│  │  └─ state/            # store Zustand
│  ├─ ai/
│  │  ├─ background-removal.ts   # ONNX RMBG/U²-Net
│  │  └─ models/                  # .onnx (o descarga on-demand)
│  ├─ io/
│  │  ├─ import.ts         # subir / drag&drop / portapapeles
│  │  └─ export/           # png, jpg, webp, svg, pdf, batch
│  ├─ filters/             # WebGL/Canvas: brillo, contraste, blur...
│  ├─ presets/             # tamaños de lienzo (IG, A4, etc.)
│  └─ ui/                  # barras, paneles, diálogos
├─ src-tauri/             # núcleo Rust + config Windows/Android/iOS
│  ├─ src/
│  ├─ tauri.conf.json
│  └─ gen/                 # proyectos android/ios generados
├─ public/
├─ package.json
└─ PLAN-TECNICO.md
```

---

## 6. Módulos funcionales

### 6.1 Lienzos y tamaños
- Presets: Instagram post 1080², Story 1080×1920, A4 (2480×3508 @300dpi),
  Facebook, YouTube thumb 1280×720, etc.
- Lienzo personalizado (px / cm / pulgadas + DPI).
- **Redimensionar lienzo** (recortar/extender) vs **redimensionar contenido** (escalar todo).
- Exportar el mismo diseño a **varios tamaños de una vez** (batch).

### 6.2 Capas
- Lista reordenable, mostrar/ocultar, bloquear, opacidad, modo de fusión.
- Agrupar/desagrupar, duplicar, alinear, distribuir.

### 6.3 Transparencia (requisito clave)
- El lienzo puede ser transparente (`background: null`).
- Tablero de cuadros (checkerboard) para indicar zonas transparentes.
- Export PNG/WebP conserva alfa SIEMPRE (sin marca de agua, sin límite).

### 6.4 Filtros y ajustes
- Brillo, contraste, saturación, tono, desenfoque, nitidez, viñeta, escala de grises.
- Implementados con shaders WebGL (rápidos) con fallback Canvas 2D.

### 6.5 Texto y formas
- Fuentes del sistema + Google Fonts empaquetadas.
- Contorno, sombra, espaciado, curvado (fase posterior).
- Rect, elipse, línea, polígono, paths SVG.

### 6.6 Undo/Redo
- Patrón **Command** sobre el documento. Cada acción es un comando reversible.
- Autosave del documento a disco (Tauri FS).

---

## 7. Quitar fondo local (offline) — implementación

1. **Modelo:** RMBG-1.4 (≈44 MB) o U²-Net (≈176 MB) en formato **ONNX**.
   - Escritorio: modelo completo (mejor calidad).
   - Móvil: variante ligera/cuantizada (INT8) para tamaño y velocidad.
2. **Runtime:**
   - Web/móvil: `onnxruntime-web` con **WebGPU** (rápido) y fallback **WASM**.
   - Escritorio (opcional acelerado): `onnxruntime` nativo en Rust vía Tauri command.
3. **Pipeline:**
   ```
   imagen → resize a 320/1024 → normalizar → modelo → máscara alfa
         → suavizar bordes (feather) → aplicar como canal alfa → nueva capa PNG
   ```
4. **Resultado:** una nueva capa con fondo eliminado (no destructivo: la original queda).
5. **Extra futuro:** "borrador mágico" (inpainting) y upscale (Real-ESRGAN) con el mismo runtime.

> Los modelos se pueden **empaquetar** dentro de la app o **descargar la primera vez**
> (mejor para el tamaño del APK). Recomendado: descarga on-demand con caché local.

---

## 8. Exportación de formatos

| Formato | Cómo | Notas |
|---|---|---|
| PNG | `canvas.toBlob('image/png')` | Conserva alfa |
| JPG | `canvas.toBlob('image/jpeg', q)` | Sin alfa, control de calidad |
| **WebP** | `canvas.toBlob('image/webp', q)` | Con/sin alfa, gran compresión |
| AVIF | encoder WASM (libavif) | Fase posterior |
| SVG | serializar capas vectoriales | Texto/formas; imágenes embebidas |
| PDF | `pdf-lib` / `jsPDF` | Tamaño físico + DPI |
| GIF | gif.js (animación, fase posterior) | |

- Opciones de export: escala @1x/@2x/@3x, calidad, **quitar metadatos EXIF** (privacidad),
  exportar selección o lienzo completo, export por lotes a varios tamaños.

---

## 9. Empaquetado por plataforma

### Windows
- `tauri build` → instalador **.msi / .exe** (NSIS). Firma opcional.

### Linux
- `tauri build` → genera **AppImage / .deb / .rpm**. Compilable desde WSL2 o máquina Linux.

### Android (APK)
- `tauri android build` → genera **.apk / .aab**.
- Requiere Android Studio + SDK/NDK. Permisos: almacenamiento, cámara (opcional).
- IA local con onnxruntime-web (WASM/WebGPU) o `onnxruntime` Android nativo.

### iOS (fuera de alcance por ahora)
- Necesitaría **macOS + Xcode**. El código del editor NO cambia; se añade el día que se quiera.

---

## 10. Checklist de paridad con Canva Pro

Leyenda: ✅ sí · ⚠️ parcial/avanzado · ❌ fuera de alcance (nube/colaboración/suite).
La columna **Fase** indica cuándo se implementa.

### Editor y diseño
- [ ] Tamaños/tipos de lienzo predefinidos — ✅ — F1
- [ ] Lienzo personalizado (px/cm/in + DPI) — ✅ — F1
- [ ] Mover / escalar / rotar capas (manijas) — ✅ — F1
- [ ] Capas: orden, ocultar, bloquear, opacidad — ✅ — F1/F3
- [ ] Modos de fusión (multiply, screen...) — ✅ — F3
- [ ] Alinear / distribuir / agrupar — ✅ — F3
- [ ] **Magic Resize** (redimensionar diseño a otros tamaños) — ✅ — F3
- [ ] Redimensionar lienzo vs contenido — ✅ — F3
- [ ] Texto (fuentes, color, contorno, sombra) — ✅ — F3
- [ ] Subir fuentes propias — ✅ — F3
- [ ] Formas / iconos / marcos / máscaras — ⚠️ — F3
- [ ] **Fondos transparentes sin límite** — ✅ — F1
- [ ] Plantillas propias (JSON) — ⚠️ — F5
- [ ] Animaciones — ⚠️ — F5

### IA (Magic Studio) — todo local/offline
- [ ] **Quitar fondo** (ONNX RMBG/U²-Net) — ✅ — F2
- [ ] Upscale (Real-ESRGAN) — ✅ — F5
- [ ] Borrador mágico / inpainting — ⚠️ — F5
- [ ] Expandir imagen (outpainting) — ⚠️ — F5
- [ ] Texto→imagen — ⚠️ opcional — F5

### Exportar
- [ ] PNG con transparencia — ✅ — F1
- [ ] JPG (calidad ajustable) — ✅ — F1
- [ ] **WebP** — ✅ — F1
- [ ] SVG — ✅ — F4
- [ ] PDF (estándar / imprenta + DPI) — ✅ — F4
- [ ] AVIF / GIF — ⚠️ — F4/F5
- [ ] Escala @1x/@2x/@3x — ✅ — F4
- [ ] Quitar metadatos EXIF — ✅ — F4
- [ ] Exportar por lotes (multi-tamaño) — ✅ — F4

### Marca
- [ ] Brand Kit (logos, colores, fuentes) — ✅ — F5
- [ ] Bulk Create (CSV → diseños) — ⚠️ — F5

### Productividad / local
- [ ] Undo / Redo — ✅ — F1
- [ ] Autosave + guardar/abrir proyecto (local) — ✅ — F1
- [ ] Historial de versiones (local) — ✅ — F5
- [ ] Carpetas / organización (local) — ✅ — F5

### Fuera de alcance (lo que Canva sí tiene y nosotros no)
- ❌ Colaboración en tiempo real, comentarios, equipos
- ❌ Almacenamiento en la nube (1 TB)
- ❌ Content Planner / publicar en redes
- ❌ Biblioteca gigante de stock/plantillas/iconos con licencia
- ❌ Otros estudios: video, presentaciones, docs, webs, impresión física

---

## 11. Roadmap por fases

**Fase 0 — Cimientos**
- Proyecto Tauri 2 + React + Konva. Modelo de documento (JSON) + render básico.
- Build de **Windows** funcionando. Esqueleto de UI (barra, panel de capas, lienzo).

**Fase 1 — MVP**
- Subir imagen (botón + drag&drop), lienzo con presets + personalizado.
- Mover/escalar/rotar capas con manijas, panel de capas, orden/ocultar/opacidad.
- **Transparencia** + tablero checkerboard. Undo/Redo. Guardar/abrir proyecto local.
- **Export PNG + JPG + WebP.**

**Fase 2 — Quitar fondo local**
- Integrar ONNX (RMBG/U²-Net), máscara → nueva capa, suavizado de bordes (no destructivo).

**Fase 3 — Edición completa**
- Texto, formas, filtros WebGL, modos de fusión, alinear/distribuir/agrupar.
- **Magic Resize** y redimensionado de lienzo/contenido.

**Fase 4 — Export avanzado + Android/Linux**
- SVG/PDF/AVIF, export por lotes, escala @2x/@3x, sin EXIF.
- Build **Android (APK)** y **Linux (AppImage/.deb)**.

**Fase 5 — Extras**
- Brand Kit, plantillas, upscale, inpainting, fuentes propias, historial de versiones.

---

## 12. Riesgos y consideraciones

- **Tamaño del APK:** los modelos ONNX pesan. Solución: descarga on-demand + cuantización.
- **Rendimiento móvil de la IA:** usar modelo ligero INT8 + WebGPU cuando exista.
- **Tauri móvil es joven:** mantener el frontend desacoplado para poder migrar a Capacitor.
- **iOS exige macOS/Xcode** para compilar y publicar (no se puede desde Windows).
- **Licencias:** usar solo modelos/fuentes/iconos con licencia libre (RMBG-1.4 tiene
  términos propios; U²-Net es Apache-2.0 — verificar antes de uso comercial).
- **Memoria:** imágenes grandes en canvas consumen RAM; limitar resolución de trabajo
  y exportar a resolución completa por separado.

---

## 13. Requisitos de entorno (para empezar la Fase 0)

> **Política de versiones:** usar siempre la **última versión estable** de cada herramienta
> y dependencia. Se fijan (pin) en `package.json` + lockfile y `Cargo.toml` para builds
> reproducibles, y se actualizan periódicamente.

- **Node.js** LTS más reciente + **pnpm** (gestor recomendado)
- **Rust** estable más reciente (rustup) + **Tauri 2** (última)
- **Visual Studio Build Tools** (C++) en Windows
- **Vite** + **React 18+** + **TypeScript** (últimas) + **Konva / react-konva** (última)
- **onnxruntime-web** (última) para la IA local
- Para Android (Fase 4): **Android Studio** + SDK + NDK + JDK (últimos)
- Para Linux (Fase 4): WSL2 o una máquina/VM Linux

## 14. Próximos pasos

1. ✅ Stack confirmado: Tauri 2 + React + Konva + ONNX local.
2. Verificar entorno (Node, Rust, Build Tools).
3. Crear el esqueleto del proyecto (Fase 0).
4. Implementar MVP (Fase 1).
5. Integrar quitar fondo local (Fase 2).
```
