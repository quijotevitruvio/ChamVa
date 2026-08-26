# ChamVa — Plan de mejora (nivel pro)

Diagnóstico hecho el 2026-08-26 sobre `main` (commit 05c155a). El objetivo: pasar de
"proyecto personal que funciona" a "producto que inspira confianza para instalar,
donar y contribuir".

## Diagnóstico

**Lo que ya está bien** (no tocar):

- Arquitectura modular real: `editor/core` (modelo puro), `editor/canvas` (Konva),
  `io/` (exportadores), `ai/` (modelos locales), `ui/` (paneles). El render y la
  exportación comparten funciones puras — decisión correcta.
- Licencias offline con ECDSA P-256 bien implementadas; la clave privada está
  gitignorada y **nunca se subió** (verificado en el historial).
- TypeScript `strict: true`, capabilities de Tauri mínimas, chunks manuales en Vite.
- README y PLAN-TECNICO completos y honestos.

**Los huecos** que impiden llamarlo "pro":

| Hueco | Evidencia |
|---|---|
| Sin CI | `.github/` solo tiene `FUNDING.yml` — nada compila el proyecto fuera de tu PC |
| Sin tests | 0 archivos de test en 9.100 líneas de TS |
| Sin linter/formatter | No hay ESLint ni Prettier |
| Monolitos | `App.tsx` 2.591 líneas, `App.css` 2.156, `VideoEditor.tsx` 1.415 |
| Sin CSP | `tauri.conf.json` → `"security": { "csp": null }` |
| Versión triplicada | `0.1.0` vive en `package.json`, `tauri.conf.json` y `branding.ts` a mano |
| Sin releases | No hay tags, no hay GitHub Releases, no hay updater |
| Sin LICENSE formal | El README dice "uso libre" pero no hay archivo `LICENSE` |
| Restos de plantilla | `public/tauri.svg`, `public/vite.svg`, `src/assets/react.svg`, logs `*.log` en la raíz |

---

## Fase 1 — Higiene y confianza (1–2 días, máximo impacto/esfuerzo)

1. **LICENSE formal.** Elegir una (MIT si quieres máxima adopción; GPL-3.0 si quieres
   que los forks sigan siendo libres) y añadir el archivo. Sin esto, legalmente nadie
   puede usar ni contribuir al código con seguridad.
2. **Limpieza.** Borrar `android-build.log`, `gradle-build.log`, `tauri-build.log`,
   `tauri-dev.log` (ya están gitignorados), `public/tauri.svg`, `public/vite.svg`,
   `src/assets/react.svg`. `authors` en `Cargo.toml` → nombre real.
3. **CSP.** Definir una Content-Security-Policy en `tauri.conf.json` en vez de `null`.
   Nota: ffmpeg.wasm y ONNX necesitan `wasm-unsafe-eval` y workers; probar bien.
4. **ESLint + Prettier.** `eslint` flat config con `typescript-eslint` +
   `eslint-plugin-react-hooks`, y Prettier. Script `pnpm lint` y `pnpm format`.
   Primera pasada: arreglar lo automático, anotar el resto.
5. **Versión única.** Script `tools/bump-version.mjs` que escriba
   `package.json` + `tauri.conf.json` + `Cargo.toml` y genere `src/version.ts`
   (o leer `import.meta.env` desde Vite). Adiós a los tres `0.1.0` manuales.

## Fase 2 — CI/CD y releases (2–3 días)

6. **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada push/PR →
   `pnpm install`, `pnpm lint`, `pnpm build` (incluye `tsc`), y `cargo check` en
   `src-tauri`. Es la red de seguridad para todo lo demás.
7. **Release automatizado** (`.github/workflows/release.yml`) con
   [tauri-action](https://github.com/tauri-apps/tauri-action): al pushear un tag
   `v*` → compila NSIS/MSI de Windows y publica GitHub Release con changelog.
   La APK puede añadirse en un job aparte (necesita SDK/NDK en el runner).
8. **Firma de la APK release** con un keystore propio (secreto de GitHub Actions).
   Sin firma consistente, los usuarios de Android no pueden actualizar sin
   desinstalar.
9. **Updater de Tauri** (`tauri-plugin-updater`): la app comprueba GitHub Releases
   y se actualiza sola. Es la diferencia entre "descarga el zip otra vez" y un
   producto. (Requiere firmar los artefactos con la clave del updater — distinta
   de la de licencias.)
10. **SmartScreen.** A mediano plazo: certificado de firma de código
    (Azure Trusted Signing es la vía barata, ~$10/mes) o publicar en
    **winget** / Microsoft Store, que reduce la fricción de reputación.

## Fase 3 — Calidad de código (1–2 semanas, incremental)

11. **Trocear `App.tsx`** (2.591 líneas). Extraer por panel, no todo de golpe:
    `panels/LayersPanel`, `panels/TextPanel`, `panels/ExportDialog`,
    `panels/SettingsDialog` (licencia/donantes ya casi es autónomo), `HomeScreen`.
    Meta razonable: `App.tsx` < 500 líneas de composición.
12. **Trocear `App.css`** en módulos por componente (o CSS Modules al extraer cada
    panel). Mismo criterio con `VideoEditor.tsx` (1.415): separar timeline, pistas
    de audio y diálogo de exportación.
13. **Tests con Vitest** donde hay lógica pura y estable — no perseguir cobertura:
    - `license.ts` (verificar/expirar/manipular firma) — es el código que protege
      ingresos; merece tests primero.
    - `editor/core/*` (filtros, formas, texto curvo, tipos del documento).
    - Exportadores puros de `io/` (SVG es el más testeable).
    - Smoke test del store de Zustand (undo/redo, páginas, reorden).
14. **Reducir `as any`** (hay ~15 repartidos en canvas/ai/io). Cada uno es un punto
    ciego del compilador en el código más delicado (Konva, ONNX).
15. **Web Workers para IA.** Quitar fondo / upscale / ffmpeg hoy pueden congelar la
    UI; moverlos a workers (transformers.js y ffmpeg.wasm lo soportan) y dejar la
    barra de progreso fluida.

## Fase 4 — Producto (continuo, priorizado)

16. **Migrar plantillas/galería de localStorage+IndexedDB a un esquema versionado**
    del documento JSON (`docVersion: 2` + migraciones). Evita que una actualización
    rompa proyectos guardados de usuarios — crítico una vez haya updater.
17. Pendientes ya identificados en el README, en este orden de valor:
    estilo de texto **por palabra** (inline editor) → **crossfade real** en video →
    gráficas/tablas → RNNoise → fotos de stock (requiere clave de API; opcional
    para mantener el "100% offline" como bandera).
18. **Atajos de teclado** documentados (Ctrl+Z/Y ya; añadir Ctrl+D duplicar,
    flechas para mover, Ctrl+G agrupar) + panel de ayuda.
19. **i18n** (es/en) con un diccionario simple — duplica el público potencial y es
    barato si se hace antes de que la UI crezca más.
20. **Sitio/landing** en GitHub Pages: capturas, GIF del editor, botón de descarga
    del último release y muro de donantes (hoy `donors.ts` está compilado en la
    app; en la web puede leerse de un JSON del repo, se actualiza sin re-release).

---

## Orden sugerido de ejecución

```
Semana 1:  Fase 1 completa + CI básico (punto 6)
Semana 2:  Release automatizado + APK firmada (7, 8)
Semana 3+: Refactor incremental (11–14) en paralelo con producto (16–17)
Cuando haya tracción: updater (9), firma Windows (10), landing (20)
```

Regla general: **ningún refactor sin CI verde primero** — los puntos 6 y 13 son los
que hacen seguros todos los demás.
