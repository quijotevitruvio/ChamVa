# FFmpeg en el instalador de Windows: publicación y mantenimiento

> **No se aplica en v0.9.0.** El build BtbN que describe este documento se descartó por licencias
> mixtas (FFTW GPL-2.0+ vía chromaprint, zvbi GPL-2.0-only, opencore-amr Apache-2.0, libaribb24
> LGPL-3.0; ver «Auditoría de licencias del binario» en `docs/seguridad-ffmpeg.md`). El manifiesto
> lo marca `"status": "blocked-license"`, `scripts/fetch-ffmpeg.mjs` se niega a descargarlo y
> `.github/workflows/release.yml` está como en v0.8.1 (sin FFmpeg). Los pasos de CI con FFmpeg
> están guardados como referencia en `docs/release-ffmpeg.workflow.yml.txt` para **v0.9.1**, que
> usará un build propio con `--disable-chromaprint --disable-libzvbi`. Los nombres, hashes y la
> etiqueta «LGPL» de abajo son del build descartado: hay que rehacerlos con el build propio, y la
> licencia se afirma solo tras repetir la auditoría.

Solo **Windows x64**. macOS, Linux y Android se publican sin FFmpeg y la app funciona igual
(la importación de video usa el navegador). Seguridad y licencia: `docs/seguridad-ffmpeg.md`.

## Qué lleva el instalador

`tauri.ffmpeg.conf.json` (se aplica SOLO con `--config`, y el CI solo lo pasa en
`windows-latest`) añade a NSIS y MSI:

- `bundle.resources`: `src-tauri/binaries/ffmpeg/` → `<carpeta del programa>/ffmpeg/`:
  `ffmpeg.exe`, `ffprobe.exe` y las 7 DLL que ambos importan (`avcodec`, `avdevice`,
  `avfilter`, `avformat`, `avutil`, `swresample`, `swscale`), más `LICENSE.txt` (LGPL v3),
  `AVISO-FFMPEG.txt` (oferta de la fuente) y `BUILD-INFO.json`. Del zip de BtbN no se copia nada
  más (`doc/`, `include/`, `lib/`, `presets/` no hacen falta).
- `bundle.licenseFile`: `binaries/LICENCIAS-INSTALADOR.txt` (MIT de ChamVa + aviso de FFmpeg con
  la URL de la fuente): página de licencia del instalador.

## Qué hace la app instalada («si ya lo tiene y es la misma versión, omite»)

`src-tauri/src/native_media/install.rs`. Nunca usa un FFmpeg del `PATH`.

1. Al arrancar (hilo aparte) y antes de la primera detección mira su copia propia en
   `%LOCALAPPDATA%\com.chamva.editor\ffmpeg\` (escribible sin administrador tanto si ChamVa se
   instaló por usuario como por máquina; la carpeta del programa no se toca).
2. **Comprobación barata**: sello `CHAMVA-FFMPEG.json` con versión + SHA-256 del zip + SHA-256,
   tamaño y fecha de cada archivo. Debe coincidir con el manifiesto compilado en la app y con el
   disco, sin archivos de más ni enlaces. No relee los 150 MB. Si coincide → **se omite**.
3. Si falta, cambió algún archivo, hay uno de más (p. ej. una DLL plantada) o el manifiesto es
   otro (actualización de ChamVa con otro FFmpeg) → **repara**: copia desde
   `<programa>/ffmpeg/` a `ffmpeg.staging-<pid>` calculando el SHA-256 de cada archivo, exige el del
   manifiesto y la licencia LGPL, ejecuta `-L`/`-buildconf` del binario copiado, escribe el sello y
   sustituye la carpeta por renombrado. Si algo falla, la copia anterior queda intacta y la app usa
   directamente los recursos del programa tras verificarlos archivo a archivo. Aviso en la app
   (toast) y en Ajustes → «FFmpeg».
4. Sin recursos (instalador sin FFmpeg, otras plataformas) no se toca nada.

## Publicar una versión (CI)

`.github/workflows/release.yml`, solo en `windows-latest`, antes de `tauri-action`:

1. `actions/cache@v4` del zip (`${{ runner.temp }}/ffmpeg-cache`, clave = hash del manifiesto).
2. `node scripts/fetch-ffmpeg.mjs --target x86_64-pc-windows-msvc --cache-dir …`: prueba los
   `mirrors` (Release propio) y después BtbN; acepta el primero con el SHA-256 fijado; verifica
   el de cada archivo, `-L` y `-buildconf`; **cualquier fallo sale con código ≠ 0 y el job de
   Windows falla** (Linux/macOS siguen: `fail-fast: false`).
3. `tauri-action` con `args: --config src-tauri/tauri.ffmpeg.conf.json` (en la matriz, solo
   Windows).

## Release de fuentes (cumplimiento LGPL)

Los autobuilds de BtbN caducan: el zip exacto y su fuente correspondiente se alojan en un Release
propio, `ffmpeg-lgpl-<versión>` (hoy `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee`), cuya URL está en el
manifiesto (`sourceRelease`, y el zip en `mirrors`). Contenido: el zip binario, `SHA256SUMS`,
`SOURCES.md`, el tarball de FFmpeg en el commit exacto, el de FFmpeg-Builds en el commit del
autobuild y las fuentes de las bibliotecas activas en `win64 lgpl-shared`.

**Importante:** créalo SIEMPRE con `--prerelease --latest=false`. El auto-actualizador lee
`releases/latest/download/latest.json`; si este Release quedara como «latest», las
actualizaciones dejarían de funcionar.

```sh
gh release create ffmpeg-lgpl-n9.0.2-22-g46d8f462ee --repo quijotevitruvio/ChamVa \
  --prerelease --latest=false --title "FFmpeg LGPL n9.0.2-22-g46d8f462ee (binario y fuente)" \
  --notes-file SOURCES.md
gh release upload ffmpeg-lgpl-n9.0.2-22-g46d8f462ee --repo quijotevitruvio/ChamVa <archivos…>
```

## Actualizar FFmpeg

1. Elige un autobuild de BtbN: variante **`win64-lgpl-shared`** (nunca `gpl`), y anota tag,
   nombre del zip y su línea de `checksums.sha256` (compárala con el `digest` de
   `gh api repos/BtbN/FFmpeg-Builds/releases/tags/<tag>`).
2. En `src-tauri/ffmpeg-manifest.json` cambia `version`, `release`, `checksums`, `ffmpegSource`,
   `sourceRelease`, y en el target `url`, `mirrors` (mismo nombre de archivo bajo el tag nuevo
   `ffmpeg-lgpl-<versión>`), `sha256`.
3. **Regenera los hashes por archivo** (`files`): descarga y extrae el zip y calcula
   `sha256sum bin/*.exe bin/*.dll` (o `Get-FileHash -Algorithm SHA256`). Si cambian los nombres de
   las DLL (sube la versión mayor de una biblioteca), el script lo detecta y aborta hasta que el
   manifiesto los liste.
4. `node scripts/fetch-ffmpeg.mjs` debe terminar con «Licencia verificada: LGPL (v3+)». Revisa el
   `-buildconf` en `binaries/ffmpeg/BUILD-INFO.json` (sin `--enable-gpl`, `--enable-nonfree`,
   `--enable-libx264/x265`, `--enable-libvidstab`, `--enable-libfdk-aac`, `--enable-libxvid`).
5. `cargo test` (con el binario en `binaries/ffmpeg/` corren las pruebas reales, incluida la
   instalación de la copia propia) y `pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json`.
6. Prepara y sube el Release de fuentes del paso anterior **antes** de publicar la versión de
   ChamVa (el aviso del instalador ya enlaza a él). Las apps ya instaladas repararán su copia al
   primer arranque tras actualizar (el manifiesto cambió → «reparar», no «omitir»).
7. Actualiza la sección «Licencia» de `docs/seguridad-ffmpeg.md`.

## Construir en local

```sh
node scripts/fetch-ffmpeg.mjs --cache-dir "$TEMP/chamva-ffmpeg-cache"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/chamva-updater.key)"
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

Comprobar el contenido sin instalar: `7z l <setup>.exe` y
`msiexec /a <archivo>.msi /qn TARGETDIR=%TEMP%\msi-x` (instalación administrativa: solo extrae).
