# FFmpeg en el instalador de Windows: build propio, publicación y mantenimiento

> **Estado (2026-10-05, para v0.9.1): pasos 1–5 hechos.** El build propio
> `win64-chamva-lgpl-shared` (LGPL-2.1-or-later) se compiló (ejecución 37344856528), se auditó y se
> publicó en el Release `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1` (prerelease, no «latest»;
> zip SHA-256 `8df875058a37afa611deebbcb7ba6b31fe1f4afcc3a6d115fae35bd4462fbfa0`, verificado
> contra el asset descargado). `src-tauri/ffmpeg-manifest.json` está en `"status": "ok"` con los
> hashes reales, y `release.yml` empaqueta FFmpeg en Windows. v0.9.0 salió sin FFmpeg: el build
> BtbN `win64-lgpl-shared` se descartó por licencias mixtas (FFTW GPL-2.0+ vía chromaprint, zvbi
> GPL-2.0-only, opencore-amr Apache-2.0, libaribb24 LGPL-3.0; ver `docs/seguridad-ffmpeg.md`) y
> sus SHA-256 siguen en `revoked`: **no se ejecutan nunca**.

Solo **Windows x64**. macOS, Linux y Android se publican sin FFmpeg y la app funciona igual
(la importación de video usa el navegador). Seguridad y licencia: `docs/seguridad-ffmpeg.md`.

## El build propio (`win64-chamva-lgpl-shared`)

- **Qué es:** FFmpeg `n9.0.2-22-g46d8f462ee` (commit `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`)
  compilado con los scripts de BtbN/FFmpeg-Builds en el commit `9acad4a9ef1583096af7836cc1e9c8cbcb4d3950`
  (el mismo del autobuild auditado), toolchain crosstool-ng fijado en
  `f697d16bd70b3e4a3499b7f2a153860f41964f72`, DLL **compartidas**, licencia **LGPL-2.1-or-later**
  (sin `--enable-gpl`, `--enable-nonfree` ni `--enable-version3`, con `--disable-network`).
- **Lista blanca versionada:** `scripts/ffmpeg-allowed-libs.json`. Fija los commits, las etapas de
  BtbN que se compilan (mingw-w64, libiconv, zlib, xz, dav1d, libvpx, libopus, zimg, ffnvcodec, amf,
  libvpl: todas LGPL-2.1+ o permisivas) y lo que la auditoría acepta (`--enable-*`, DLL importadas,
  cadenas prohibidas). `scripts/ffmpeg-build/build.sh` **borra** de `scripts.d/` toda etapa que no
  esté en la lista (las GPL o incompatibles ni se descargan) y reescribe `zz-final.sh`; la variante
  es `scripts/ffmpeg-build/variants/win64-lgpl-chamva-shared.sh` (el identificador interno empieza por
  `lgpl` para que las protecciones `[[ $VARIANT == lgpl* ]]` de BtbN sigan actuando).
- **Qué usa ChamVa** (`src-tauri/src/native_media/args.rs`): demux/decodificación nativa de
  HEVC/H.264/ProRes/MKV/AC-3/AAC/Opus/Vorbis (y AV1 con dav1d), `h264_mf` (Media Foundation,
  obligatorio: configure falla si no está), `libvpx` (VP8) + `libopus` para el proxy WebM, `aac`
  nativo, `zscale`(zimg)+`tonemap` para HDR→SDR, `scale`/`fps`/`pad`/`format`, `-progress`, y
  `h264_nvenc`/`h264_qsv`/`h264_amf` para la exportación por hardware (cabeceras MIT; cargan el
  driver en tiempo de ejecución).
- **Auditoría automática** (`scripts/audit-ffmpeg-licenses.mjs`, la misma en CI, en local y dentro
  de `fetch-ffmpeg.mjs`): no ejecuta el binario; lee los PE (importaciones normales y diferidas,
  exportaciones) y las cadenas. Falla si hay archivos de más en `bin/`, una importación que no sea
  de Windows ni de FFmpeg, cadenas/símbolos de FFTW, zvbi, chromaprint, aribb24, opencore, x264,
  x265, xvid, vidstab, fdk-aac, frei0r, rubberband, postproc u openh264 (fuera de la línea
  `-buildconf` y de dos excepciones nativas documentadas), un `-buildconf` con `--enable-gpl`/
  `--enable-nonfree`/`--enable-version3` o con un `--enable-*` fuera de la lista, configuraciones
  distintas entre DLL, falta de `LICENSE.txt` LGPL o de `licenses/<biblioteca>/`, o un `SHA256SUMS`
  que no cuadra. Pruebas: `pnpm exec vitest run scripts/` (incluye el zip BtbN descartado si está en
  `%TEMP%\chamva-ffmpeg-release\binary\`: debe fallar por FFTW y zvbi).

### 1. Disparar y vigilar el flujo

Solo `workflow_dispatch` (no corre con tags ni con `release.yml`). Entradas opcionales:
`ffmpeg_ref` (commit de 40 hex; vacío = el fijado) y `release_tag` (vacío =
`ffmpeg-lgpl-<versión>-chamva1`; solo se escribe en `SOURCES.md` y en el manifiesto candidato) y
`only` (`all` por defecto; `image` compila solo la imagen Docker y guarda la caché, para calentarla
sin compilar FFmpeg. No hay `ffmpeg`/`package` sueltos: cada job es un runner nuevo y necesita la
imagen, que con la caché de capas se rehace en minutos).

```sh
gh workflow run ffmpeg-build.yml --repo quijotevitruvio/ChamVa --ref main
#   con entradas: -f ffmpeg_ref=46d8f462eeb87ee1f704d8c44a0ee24fca471ad1 -f release_tag=ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1
RUN=$(gh run list --repo quijotevitruvio/ChamVa --workflow ffmpeg-build.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --repo quijotevitruvio/ChamVa --exit-status
gh run view "$RUN" --repo quijotevitruvio/ChamVa --log-failed   # si falla
```

Duración: la primera vez (sin caché) ≈ 2–3 h (el toolchain GCC de crosstool-ng es lo más largo);
después, con la caché de capas Docker (`actions/cache`, clave = hash de la lista blanca y de
`scripts/ffmpeg-build/` + id de la ejecución; se restaura la más reciente y se guarda también si
la imagen falla a medias, para no rehacer la imagen base ni las descargas), ≈ 30–45 min. Tope del job: 345 min. El repositorio es público: los
minutos de Actions en `ubuntu-24.04` no se cobran. La caché puede ocupar varios GB del cupo de 10 GB.

Artefactos (30 días): `ffmpeg-chamva-win64-binary` (zip, `SHA256SUMS`, `SOURCES.md`,
`BUILD-INFO.json`, `audit.json`/`audit.txt`, `linked-dlls.txt`, `manifest-snippet.json`,
`ffmpeg-manifest.candidate.json`), `ffmpeg-chamva-win64-source` (FFmpeg + cada biblioteca a su
commit con SHA-256, scripts de BtbN sin tocar y con el overlay, el diff, los scripts de ChamVa, el
Dockerfile generado) y `ffmpeg-chamva-win64-logs` (también si falla; nunca el binario).

### 2. Descargar y auditar en Windows

```powershell
$run = gh run list --repo quijotevitruvio/ChamVa --workflow ffmpeg-build.yml --limit 1 --json databaseId -q '.[0].databaseId'
gh run download $run --repo quijotevitruvio/ChamVa -n ffmpeg-chamva-win64-binary -D $env:TEMP\ffmpeg-chamva\binary
gh run download $run --repo quijotevitruvio/ChamVa -n ffmpeg-chamva-win64-source -D $env:TEMP\ffmpeg-chamva\source
cd $env:TEMP\ffmpeg-chamva\binary; sha256sum -c SHA256SUMS --ignore-missing   # (Git Bash) o Get-FileHash
node F:\666999\0.Programador\ChamVa\scripts\audit-ffmpeg-licenses.mjs (Get-Item .\ffmpeg-*-win64-chamva-lgpl-shared.zip) --json audit-local.json
```

Debe terminar en «✓ Sin bibliotecas GPL ni incompatibles». Revisa además a mano: `audit.txt`
(importaciones y familias de exportaciones por DLL), el `-buildconf`, la tabla de `SOURCES.md` y
que `licenses/` trae la licencia de cada biblioteca. Si quieres comprobar `-L`/`-buildconf`
ejecutando el binario, hazlo en una carpeta temporal (`ffmpeg.exe -hide_banner -L`).

### 3. Publicar el Release de fuentes (a mano)

Créalo SIEMPRE con `--prerelease --latest=false`: el auto-actualizador lee
`releases/latest/download/latest.json` y un Release «latest» sin él rompe las actualizaciones.

```sh
TAG=ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1
cd "$TEMP/ffmpeg-chamva"
gh release create "$TAG" --repo quijotevitruvio/ChamVa --prerelease --latest=false \
  --title "FFmpeg LGPL n9.0.2-22-g46d8f462ee para ChamVa (binario y fuente)" --notes-file binary/SOURCES.md
gh release upload "$TAG" --repo quijotevitruvio/ChamVa binary/*.zip binary/SHA256SUMS binary/SOURCES.md \
  binary/BUILD-INFO.json binary/audit.json source/*.tar.* source/*.patch source/Dockerfile.generated source/libs/*
gh release view "$TAG" --repo quijotevitruvio/ChamVa --json isPrerelease,isLatest   # true / false
```

### 4. Rellenar el manifiesto

(Hecho para `-chamva1`.) `ffmpeg-manifest.candidate.json` ya trae la URL del Release, el SHA-256
del zip y el de cada archivo, con `"status": "pending-review"` (sigue bloqueado). Cópialo sobre
`src-tauri/ffmpeg-manifest.json`, compara con `manifest-snippet.json` y con tu auditoría local, y
**solo entonces** cambia `"status"` a `"ok"` y quita `blockedReason`. Conserva `revoked` (el build
BtbN no debe ejecutarse nunca). Comprueba:

```sh
node scripts/fetch-ffmpeg.mjs --target x86_64-pc-windows-msvc --cache-dir "$TEMP/chamva-ffmpeg-cache"
#   descarga del Release, SHA-256 del zip y de cada archivo, auditoría de licencias, -L y -buildconf:
#   debe terminar con «Licencia verificada: LGPL (v2.1+)»
cd src-tauri && cargo test --lib native_media::   # con el binario en binaries/ corren las pruebas reales
```

`locate::tests::manifest_is_consistent` exige en `"ok"`: URL del Release propio, `verified` con
hashes por archivo, SHA-256 distinto de la plantilla (`000…`) y ningún hash de `revoked`.

### 5. Reactivar FFmpeg en `release.yml`

(Hecho para `-chamva1`.) Parte de `docs/release-ffmpeg.workflow.yml.txt` (referencia, no es un workflow): copia a
`.github/workflows/release.yml` la fila de Windows de la matriz (`args: '--config
src-tauri/tauri.ffmpeg.conf.json'`), los pasos «Caché del zip de FFmpeg» y «FFmpeg LGPL verificado»
y el párrafo del `releaseBody` con el enlace al Release de fuentes (pon el `TAG` real). El paso de
FFmpeg falla el job de Windows si el manifiesto no está en `"ok"`, si un hash no coincide o si la
auditoría falla (Linux y macOS siguen: `fail-fast: false`).

### 6. NSIS y MSI

`tauri.ffmpeg.conf.json` (solo con `--config`, solo en `windows-latest`) añade a NSIS y MSI:

- `binaries/ffmpeg/` → `<programa>/ffmpeg/`: `ffmpeg.exe`, `ffprobe.exe`, las 7 DLL compartidas
  (reemplazables), `LICENSE.txt` (LGPL v2.1), `AVISO-FFMPEG.txt` (oferta de la fuente con la URL
  del Release) y `BUILD-INFO.json`.
  Nada más: la app rechaza archivos de más en esa carpeta.
- `binaries/ffmpeg-licenses/` → `<programa>/ffmpeg-licenses/`: la licencia de cada biblioteca
  enlazada (BSD/MIT exigen acompañar el binario con su aviso).
- `bundle.licenseFile`: `binaries/LICENCIAS-INSTALADOR.txt` (MIT de ChamVa + aviso de FFmpeg).

```sh
node scripts/fetch-ffmpeg.mjs --cache-dir "$TEMP/chamva-ffmpeg-cache"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/chamva-updater.key)"
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

Comprobar el contenido sin instalar: `7z l <setup>.exe` y
`msiexec /a <archivo>.msi /qn TARGETDIR=%TEMP%\msi-x` (instalación administrativa: solo extrae).
Antes de publicar la versión de ChamVa, el Release de fuentes del paso 3 ya debe existir (el aviso
del instalador enlaza a él). Actualiza la sección «Licencia» de `docs/seguridad-ffmpeg.md`.

## Qué hace la app instalada («si ya lo tiene y es la misma versión, omite»)

`src-tauri/src/native_media/install.rs`. Nunca usa un FFmpeg del `PATH`.

1. Al arrancar (hilo aparte) y antes de la primera detección mira su copia propia en
   `%LOCALAPPDATA%\com.chamva.editor\ffmpeg\` (escribible sin administrador tanto si ChamVa se
   instaló por usuario como por máquina; la carpeta del programa no se toca).
2. **Comprobación barata**: sello `CHAMVA-FFMPEG.json` con versión + SHA-256 del zip + SHA-256,
   tamaño y fecha de cada archivo. Debe coincidir con el manifiesto compilado en la app y con el
   disco, sin archivos de más ni enlaces. No relee los binarios. Si coincide → **se omite**.
3. Si falta, cambió algún archivo, hay uno de más (p. ej. una DLL plantada) o el manifiesto es
   otro (actualización de ChamVa con otro FFmpeg) → **repara**: copia desde `<programa>/ffmpeg/` a
   `ffmpeg.staging-<pid>` calculando el SHA-256 de cada archivo, exige el del manifiesto y la
   licencia LGPL, ejecuta `-L`/`-buildconf` del binario copiado, escribe el sello y sustituye la
   carpeta por renombrado. Si algo falla, la copia anterior queda intacta y la app usa directamente
   los recursos del programa tras verificarlos archivo a archivo.
4. Sin recursos (instalador sin FFmpeg, otras plataformas) o con el manifiesto bloqueado
   (`pending-build`, `pending-review`…) no se toca nada.

## Actualizar FFmpeg (versión nueva)

1. Cambia en `scripts/ffmpeg-allowed-libs.json` `ffmpeg.commit` y `ffmpeg.expectedVersion` (y, si
   hace falta, `btbn.commit`/`crosstoolNgCommit`: revisa el diff de `scripts.d/` de las etapas de
   la lista blanca). Una biblioteca nueva solo entra tras leer su COPYING/LICENSE en la fuente y
   anotarlo en `docs/seguridad-ffmpeg.md`.
2. Pasos 1–6 con una etiqueta nueva (`…-chamva2`). Las apps instaladas repararán su copia al primer
   arranque tras actualizar (el manifiesto cambió → «reparar», no «omitir»).

## Qué NO está fijado (riesgos de reproducibilidad)

`ubuntu:26.04` y los paquetes `apt` de la imagen base de BtbN no van por digest; las fuentes de
GCC/binutils las baja crosstool-ng (verifica SHA-512). El binario puede variar en bytes entre
ejecuciones; la fuente de FFmpeg y de cada biblioteca (commit + SHA-256 en `SOURCES.md`), no. Por
eso el manifiesto fija el zip concreto que se auditó y se publicó.
