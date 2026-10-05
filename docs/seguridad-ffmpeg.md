# FFmpeg nativo en escritorio (V10): seguridad y licencia

Solo escritorio (Windows/macOS/Linux con Tauri). En web y Android no existe nada de esto: la
importación funciona como siempre. Código: `src-tauri/src/native_media/` (Rust) y
`src/video/native/` (interfaz).

## Qué se ejecuta

- **Solo** `ffmpeg` y `ffprobe` de rutas fijas (`locate.rs`), por orden:
  1. `<recursos de la app>/ffmpeg/` (lo copia el instalador, ver «Empaquetado»);
  2. `<datos locales>/com.chamva.editor/ffmpeg/`: copia que el usuario descarga e instala a mano.
     Solo se usa si **cada archivo** coincide con el SHA-256 fijado en
     `src-tauri/ffmpeg-manifest.json` y **no hay archivos de más** (una DLL plantada junto a
     `ffmpeg.exe` se cargaría antes que la del sistema);
  3. compilaciones de desarrollo (`debug_assertions`): `src-tauri/binaries/ffmpeg/`.
- Nunca el `PATH`, nunca una ruta que diga la interfaz. No se usa el plugin `shell`: los
  comandos Rust lanzan el proceso con `std::process::Command` (argv directo, **sin shell**).
- Antes del primer uso, el binario debe declararse LGPL en `-L` (ffmpeg **y** ffprobe) y su
  `-buildconf` no puede llevar `--enable-gpl`, `--enable-nonfree`, `--enable-libx264/x265`,
  `--enable-libvidstab`, `--enable-libfdk-aac` ni `--enable-libxvid`. Si no, «no disponible».
- Entorno del proceso vacío salvo `SystemRoot`, `windir`, `SYSTEMDRIVE`, `TEMP`, `TMP`, `LANG`,
  `LC_ALL` (así `FFREPORT`, `AV_LOG_FORCE_*`… no pueden escribir archivos ni cambiar nada);
  stdin cerrado (`-nostdin`), directorio de trabajo = temporal propio, sin consola en Windows.

## Cómo llegan los archivos (la interfaz nunca envía rutas)

- `native_media_pick`: Rust abre el diálogo nativo «Abrir» (filtro de extensiones de video).
- Soltar archivos: Rust anota las rutas del evento nativo `DragDrop` (las da el sistema
  operativo); la interfaz solo puede pedir `native_media_take_dropped` («registra lo último que
  se soltó», caduca a los 2 min, máx. 64).
- Cada ruta pasa por `validate::validate_source`: absoluta; sin `..`/`.` (se mira el texto crudo
  porque `PathBuf::join("..")` en rutas `\\?\` ya lo resuelve); sin NUL/CR/LF; sin rutas de red o
  dispositivo (`\\servidor\…`, `//…`, `\\?\UNC\…`, `\\.\…`, `\\?\GLOBALROOT…`); canonicalizada
  (resuelve enlaces simbólicos y juntas) y **revalidada** en destino; archivo regular, no vacío,
  ≤ 256 GiB y extensión de video permitida (un `.mp4` que es un enlace a un `.m3u8` se rechaza).
- La interfaz recibe un **token** opaco (máx. 256 registrados). Cada uso revalida la ruta: si el
  archivo desapareció o ahora apunta a otro sitio, se pide elegirlo de nuevo.

## Argumentos (todos construidos en Rust, `args.rs`)

- Opciones de la interfaz = tipos cerrados con `serde(deny_unknown_fields)`: altura
  `360|540|720|1080`, vídeo `auto|h264|vp8`, `tonemap: bool`; lector de fotogramas con tamaño
  par 16–7680×16–4320, fps 1–120, tiempos finitos 0–24 h; exportación por hardware con encoder
  de una lista cerrada (`h264_mf|h264_nvenc|h264_qsv|h264_amf|h264_videotoolbox`) y 200–200 000 kbps.
  Un valor desconocido falla al deserializar (comprobado en la app real: `libx264` → error).
- La entrada va como `file:<ruta canónica>` en **un** argv: nunca empieza por `-` (no es una
  opción), fuerza el protocolo de archivo (`concat:…`, `pipe:…`, `http://…` en el nombre no
  cambian nada) y espacios, `;`, `&`, `$()`, comillas son datos. Probado con el ffmpeg real:
  `-i evil.mp4`, `a;b & c.mp4`, `$(calc) \`x\`.mov`, `con 'comillas' y espacios.mkv`,
  `concat:x.mp4`, `-y.mp4`, `pipe:1.mp4`.
- Antes de cada entrada: `-protocol_whitelist file` (también para lo que un demuxer abra desde
  dentro: referencias externas de MOV, listas…) y `-format_whitelist
  mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mxf,flv,asf,mpeg,ogg,dv`. Probado: una lista
  HLS, un guion `ffconcat`, un SDP y un texto renombrados a `.mp4` se rechazan.
- Filtros fijos (escala, `fps`, `setparams`+`zscale`+`tonemap` para HDR con valores de un enum).
- Salidas: solo `<caché>/native-media/tmp/job-<n>.<ext>` (se renombra a
  `out/<sha256>.<ext>` al terminar bien) o `pipe:1`. La exportación por hardware guarda donde el
  usuario elija en el diálogo «Guardar» abierto **desde Rust** (nombre saneado).

## Recursos y limpieza

- Tiempo: detección 15 s por llamada, probe 30 s, prueba de encoder 20 s; conversiones con
  vigilante: bloqueo sin progreso 90 s, total `duración×20` (2 min–12 h); lector de fotogramas
  60 s por lectura y cierre si nadie lee en 5 min. Fuente máx. 12 h.
- Tamaño: `-fs` + vigilante del temporal (proxy ≤ 8 GiB, WAV ≤ 4 GB), stdout de ffprobe ≤ 4 MiB,
  stderr ≤ 64 KiB (los últimos), líneas de progreso ≤ 512 B y solo claves conocidas con valores
  saneados, lecturas de la caché ≤ 16 MiB, fotogramas ≤ 64 MiB por llamada y cola acotada por
  bytes (si nadie lee, ffmpeg se bloquea en el tubo: memoria constante).
- Máx. 2 conversiones, 4 lectores de fotogramas y 1 exportación por hardware a la vez.
- Cancelar mata el proceso y borra el temporal (probado: < 5 s, sin temporal ni salida). Al
  salir de la app se matan todos los procesos y se vacía `tmp/`; al arrancar también se vacía.
- Caché `out/` con desalojo de los más antiguos por encima de 20 GiB; clave = SHA-256 de
  esquema + versión de ffmpeg + perfil + ruta + tamaño + fecha + 3 ventanas de 1 MiB (inicio,
  mitad, final). La interfaz lee por clave validada como 64 hex (sin forma de salir del directorio).

## Superficie expuesta a la webview (comandos)

Todos con permiso explícito en `capabilities/default.json` (el manifiesto de app de `build.rs`
hace que cualquier comando propio no listado quede bloqueado por la ACL):

| Comando | Recibe | Hace |
|---|---|---|
| `native_media_status` | `refresh?` | detección y licencia (cacheada) |
| `native_media_pick` / `_take_dropped` | — | diálogo nativo / último drop → tokens |
| `native_media_probe` | token | ffprobe → resumen tipado (texto saneado) |
| `native_media_proxy` | token, opciones cerradas, canal | proxy con progreso |
| `native_media_extract_audio` | token, canal | WAV 48 kHz estéreo |
| `native_media_cancel` | id | mata y limpia |
| `native_media_read` | clave 64 hex, offset, longitud | bytes del resultado (≤ 16 MiB) |
| `native_media_cache_clear` | — | vacía `out/` (no con trabajos en marcha) |
| `native_media_hw_encoders` | — | encoders que funcionan de verdad (prueba de 3 fotogramas) |
| `native_media_frames_open/_read/_close` | token, opciones cerradas / id | RGBA crudos del original |
| `native_media_hw_export_open/_write/_write_audio/_finish/_abort` | opciones cerradas / bytes + `x-job` | **experimental**, apagado por defecto |

Lo que una webview comprometida podría hacer: convertir o leer archivos **que el usuario ya
eligió**, gastar CPU/disco dentro de los topes anteriores y abrir los diálogos nativos. No puede
elegir rutas, binarios, argumentos, filtros, protocolos ni destinos.

## Licencia

- Build fijado: BtbN FFmpeg-Builds `autobuild-2026-10-04-20-51`, `n9.0.2-22-g46d8f462ee`,
  variante **lgpl-shared** (DLL separadas, sustituibles por el usuario como pide la LGPL).
  Windows x64: `ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip`, SHA-256
  `feb93d768fe01ebb696d990c4f0c65add416c12e5e16fa73ad5643237e0e9e22` (coincide con el
  `checksums.sha256` y con el digest de la API de GitHub). `-L`: LGPL v3 o posterior.
  `-buildconf`: `--enable-version3`, sin `--enable-gpl`/`--enable-nonfree`,
  `--disable-libx264 --disable-libx265 --disable-libvidstab --disable-libfdk-aac --disable-libxvid`.
- gyan.dev «essentials/full» y los builds `gpl` de BtbN **no sirven** (llevan x264/x265 → GPL).
- Aviso en la app: pie del diálogo «Convertir para editar» (versión, licencia, enlace a la fuente).
  Aviso en el instalador: `scripts/fetch-ffmpeg.mjs` genera `binaries/LICENCIAS-INSTALADOR.txt`
  (MIT de ChamVa + aviso FFmpeg) que `tauri.ffmpeg.conf.json` usa como `licenseFile`, y copia
  `LICENSE.txt` (LGPL v3) y `AVISO-FFMPEG.txt` junto a los binarios.
- Pendiente de cumplimiento estricto: ofrecer la **fuente completa** (FFmpeg en el commit
  `46d8f462ee` y las bibliotecas que el build enlaza estáticamente dentro de las DLL) desde un
  sitio propio (p. ej. adjunta a cada GitHub Release): los autobuilds de BtbN caducan.
- Patentes: H.264/AAC se codifican con el sistema (`h264_mf`, VideoToolbox) o con el AAC nativo de
  FFmpeg; la alternativa libre es VP8 + Opus. El build incluye `libopenh264` compilado desde la
  fuente (sin la cobertura de patentes de Cisco): ChamVa **no** lo usa.

## Empaquetado

```
node scripts/fetch-ffmpeg.mjs           # descarga, verifica SHA-256 de zip y de cada archivo, -L y -buildconf
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

Sin ese paso el instalador sale como hasta ahora (sin FFmpeg, +0 MB) y la app explica la causa.
Con él: +150 MB sin comprimir en Windows (≈ 55–65 MB más en el instalador). `src-tauri/binaries/`
está en `.gitignore`.

### Cambio propuesto para `.github/workflows/release.yml` (no aplicado)

Antes de `tauri-apps/tauri-action`, en Windows (y Linux cuando esté verificado):

```yaml
      - name: FFmpeg LGPL (verificado por SHA-256 y -buildconf)
        if: matrix.platform == 'windows-latest'
        run: node scripts/fetch-ffmpeg.mjs
```

y en `tauri-action`, `args: ${{ matrix.args }} ${{ matrix.platform == 'windows-latest' && '--config src-tauri/tauri.ffmpeg.conf.json' || '' }}`.
Recomendado además: subir el zip verificado y la fuente a un Release propio y apuntar el
manifiesto ahí (los autobuilds de BtbN se borran con el tiempo). macOS: BtbN no publica builds;
hay que compilar FFmpeg LGPL en CI (`--disable-gpl --enable-videotoolbox`, sin x264) y universal.

## Sin probar

macOS (VideoToolbox, build universal), Linux (build estático lgpl, VA-API no se usa), Windows ARM,
QSV/AMF (solo NVENC y MF funcionan en la máquina de prueba), la exportación por hardware de punta a
punta y el flujo completo dentro de la app con el diálogo nativo (se probó la IPC real en la app
y la conversión/cancelación con el ffmpeg real por separado).
