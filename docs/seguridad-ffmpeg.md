# FFmpeg nativo en escritorio (V10): seguridad y licencia

> **Estado (2026-10-05, para v0.9.1): el instalador de Windows x64 incluye el FFmpeg PROPIO**,
> LGPL-2.1-or-later, DLL compartidas, compilado desde la fuente por
> `.github/workflows/ffmpeg-build.yml` (lista blanca `scripts/ffmpeg-allowed-libs.json`, auditoría
> automática `scripts/audit-ffmpeg-licenses.mjs`) y publicado con su fuente completa en el Release
> `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1`
> (https://github.com/quijotevitruvio/ChamVa/releases/tag/ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1).
> `src-tauri/ffmpeg-manifest.json` está en `"status": "ok"` con el SHA-256 del zip y de cada
> archivo. macOS, Linux, Android y web **no** traen FFmpeg: la app dice «no disponible en esta
> plataforma» y la importación funciona como en v0.8.1. v0.9.0 salió sin FFmpeg: el build BtbN
> que se pensó usar tiene licencias mixtas (ver «Auditoría de licencias del build BtbN») y sus
> SHA-256 siguen en `revoked`: no se ejecutan nunca, con cualquier estado del manifiesto.
> Procedimiento: `docs/release-ffmpeg.md`.

Solo escritorio (Windows/macOS/Linux con Tauri). En web y Android no existe nada de esto: la
importación funciona como siempre. Código: `src-tauri/src/native_media/` (Rust) y
`src/video/native/` (interfaz).

## Qué se ejecuta

- **Solo** `ffmpeg` y `ffprobe` de rutas fijas (`locate.rs`), por orden:
  1. `<datos locales>/com.chamva.editor/ffmpeg/` con sello válido: la copia propia que
     `install.rs` coloca desde los recursos del instalador («si es la misma versión, se omite»;
     ver `docs/release-ffmpeg.md`). Comprobación barata en cada arranque: sello con versión y
     SHA-256 del manifiesto + tamaño y fecha de cada archivo, sin archivos de más ni enlaces;
  2. `<recursos de la app>/ffmpeg/` (lo deja el instalador), solo si **cada archivo** coincide con
     el SHA-256 del manifiesto (respaldo si la copia propia no se pudo hacer);
  3. `<datos locales>/com.chamva.editor/ffmpeg/` sin sello: copia que el usuario instala a mano.
     Solo se usa si **cada archivo** coincide con el SHA-256 fijado en
     `src-tauri/ffmpeg-manifest.json` y **no hay archivos de más** (una DLL plantada junto a
     `ffmpeg.exe` se cargaría antes que la del sistema);
  4. compilaciones de desarrollo (`debug_assertions`): `src-tauri/binaries/ffmpeg/`.
- Límite conocido de la comprobación barata: alguien con permisos de TU usuario podría sustituir
  un archivo conservando tamaño y fecha. Ese atacante ya puede modificar ChamVa y su perfil; la
  reparación sí verifica el SHA-256 completo.
- Nunca el `PATH`, nunca una ruta que diga la interfaz. No se usa el plugin `shell`: los
  comandos Rust lanzan el proceso con `std::process::Command` (argv directo, **sin shell**).
- Un binario cuyo SHA-256 aparezca en una entrada bloqueada del manifiesto **nunca** se ejecuta,
  venga de la ruta que venga (pruebas: `locate::tests::planted_blocked_binary_is_never_used`,
  `real_blocked_dev_binary_is_not_used`, `install::tests::blocked_entry_is_unavailable_and_never_runs`).
- Antes del primer uso, el binario debe declararse LGPL en `-L` (ffmpeg **y** ffprobe) y su
  `-buildconf` no puede llevar `--enable-gpl`, `--enable-nonfree`, `--enable-libx264/x265`,
  `--enable-libvidstab`, `--enable-libfdk-aac` ni `--enable-libxvid`. Si no, «no disponible».
  Es condición **necesaria, no suficiente**: `-L` no ve las licencias de las bibliotecas externas
  (así pasó el build BtbN, que lo cumple y aun así no es LGPL limpio).
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

- **Build incluido (Windows x64):** FFmpeg `n9.0.2-22-g46d8f462ee` (commit
  `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`), variante propia `win64-chamva-lgpl-shared`, zip
  `ffmpeg-n9.0.2-22-g46d8f462ee-win64-chamva-lgpl-shared.zip`, SHA-256
  `8df875058a37afa611deebbcb7ba6b31fe1f4afcc3a6d115fae35bd4462fbfa0` (coincide con el digest del
  asset del Release, comprobado al descargarlo). Licencia **LGPL-2.1-or-later**: `-buildconf` con
  `--disable-gpl --disable-nonfree --disable-version3 --disable-network`, sin chromaprint, zvbi,
  aribb24, opencore-amr, gmp, mbedtls, x264, x265, xvid, vid.stab, fdk-aac, frei0r, avisynth,
  rubberband ni openh264; `-L` declara «GNU Lesser General Public License … version 2.1 … or (at
  your option) any later version».
- **Bibliotecas enlazadas** (tabla con commit y SHA-256 de cada fuente en `SOURCES.md` del Release):
  mingw-w64 runtime (ZPL-2.1/MIT/BSD), mingw-std-threads (BSD-2), libiconv (LGPL-2.1+), zlib
  (Zlib), xz/liblzma (0BSD), dav1d (BSD-2), libvpx (BSD-3 + PATENTS), libopus (BSD-3), zimg (WTFPL),
  y las cabeceras ffnvcodec (MIT), AMF (MIT) y libvpl (MIT). Todas LGPL-2.1+ o permisivas; runtime
  de GCC con la GCC Runtime Library Exception. La auditoría automática (también dentro de
  `fetch-ffmpeg.mjs`) pasa: «✓ Sin bibliotecas GPL ni incompatibles».
- **DLL compartidas y reemplazables:** `avcodec-63`, `avdevice-63`, `avfilter-12`, `avformat-63`,
  `avutil-61`, `swresample-7`, `swscale-10`, junto a `ffmpeg.exe`/`ffprobe.exe` en
  `<programa>/ffmpeg/`. ffmpeg es un programa aparte (ChamVa no enlaza con él: lo lanza como
  proceso). El usuario puede sustituir esas DLL y usar ese ffmpeg por su cuenta; ChamVa, por
  seguridad, solo ejecuta los SHA-256 fijados (trabaja con su copia en la carpeta de datos y la
  restaura desde el programa si cambia). El zip del Release trae además `lib/` e `include/` para
  recompilar o enlazar.
- **Avisos:** `<programa>/ffmpeg/LICENSE.txt` (LGPL v2.1) y `AVISO-FFMPEG.txt` (oferta de la fuente
  con la URL exacta del Release, SHA-256 del zip original); `<programa>/ffmpeg-licenses/<biblioteca>/`
  con la licencia de cada biblioteca (BSD/MIT exigen acompañar el binario con su aviso); y la
  página de licencia de los instaladores NSIS y MSI (`binaries/LICENCIAS-INSTALADOR.txt`: MIT de
  ChamVa + el mismo aviso). Los genera `scripts/fetch-ffmpeg.mjs`.
- **Fuente completa y correspondiente:** Release `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1`
  (prerelease, no «latest»): el zip exacto, FFmpeg en el commit exacto (`.tar.xz`), los scripts de
  BtbN sin tocar y con el overlay de ChamVa (+ diff), los scripts de ChamVa, el Dockerfile
  generado, la fuente de cada biblioteca (`ffmpeg-libs-sources.tar`), `SOURCES.md`, `SHA256SUMS`,
  `audit.txt`, `BUILD-INFO.json` y `linked-dlls.txt`.
- **En la app:** Ajustes → «FFmpeg (componente de terceros)» muestra la versión, la licencia que
  declara el binario en uso, el estado de la copia propia, el texto de la licencia y el enlace a la
  fuente; el pie del diálogo «Convertir para editar» enlaza también a la fuente. Si en Windows el
  FFmpeg no se puede usar (copia dañada sin reparar, instalador sin FFmpeg…), se dice el motivo
  real; en macOS/Linux, «no disponible en esta plataforma».
- **Patentes:** H.264/AAC se codifican con el sistema (`h264_mf`, VideoToolbox) o con el AAC
  nativo de FFmpeg; la alternativa libre es VP8 + Opus. El build propio no lleva openh264.

### Auditoría de licencias del build BtbN descartado (v0.9.0)

Contexto: el build BtbN `autobuild-2026-10-04-20-51` «lgpl-shared»
(`ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip`, SHA-256
`feb93d768fe01ebb696d990c4f0c65add416c12e5e16fa73ad5643237e0e9e22`; `-L` LGPL v3,
`--enable-version3`) se iba a incluir en v0.9.0. No se redistribuyó: lo que sigue explica por qué.
Sus SHA-256 están en `revoked`.



Método: zip descomprimido y comprobado por SHA-256 contra el manifiesto (los 9 archivos
coinciden); `grep -a` sobre cada DLL/EXE; lectura de la fuente de cada biblioteca sospechosa en el
tar de fuentes (`ffmpeg-lgpl-libs-sources.tar`) y de los scripts de BtbN en el commit
`9acad4a9ef15`; `configure` de FFmpeg en `46d8f462ee`.

1. **FFTW 3.3.11 (GPL-2.0-or-later) dentro de `avformat-63.dll`.** Confirmado:
   - `avformat-63.dll` contiene la cadena de wisdom `(fftw-3.3.11 fftw_wisdom`, 1017 apariciones de
     `fftw` y **948 nombres distintos `fftw_codelet_*`** más `fftw_dft_*_register`,
     `fftw_rdft_*_register`, etc. Ninguna otra DLL ni EXE contiene `fftw`.
   - Origen: `scripts.d/25-fftw3.sh` (estático, `--enable-threads`) y `scripts.d/50-chromaprint.sh`
     (`-DFFT_LIB=fftw3`, `Libs.private: -lfftw3`); FFmpeg `--enable-chromaprint` (muxer
     `chromaprint`, en libavformat). `COPYING` de FFTW: GPL v2; cabeceras «version 2 … or (at your
     option) any later version»; MIT vende licencia comercial alternativa.
   - `-L` y `-buildconf` no lo revelan: FFmpeg no clasifica chromaprint como GPL en `configure`.
2. **zvbi: código GPL-2.0-ONLY dentro de `avcodec-63.dll` (hallazgo nuevo).**
   - `avcodec-63.dll` contiene `zvbi 0.2.45`; `--enable-libzvbi` (decodificador
     `libzvbi_teletext`), zvbi estático (`scripts.d/50-zvbi.sh`, commit `d3a5ee9f2b04`).
   - `COPYING.md` de zvbi: `src/*` LGPL-2+ salvo **`src/packet-830.*` y `src/pdc.*`: «License:
     GPL-2»**; la cabecera de `packet-830.c` dice «GNU General Public License version 2», sin «or
     later».
   - Se enlaza de verdad: `libzvbi-teletextdec.c` llama a `vbi_decode` (`vbi.c:423`) →
     `vbi_decode_teletext` (`packet.c:2192`) → en código activo (`packet.c:2146`, sin `#if 0`)
     `vbi_decode_teletext_8301_local_time`, definida en `packet-830.c:130`. Al enlazar la `.a`
     estática, `packet-830.o` entra en la DLL. (`pdc.o` probablemente no: sus cadenas, p. ej.
     «Indefinite time window», no aparecen en la DLL.)
3. **Incompatibilidad resultante.** En la misma `avcodec-63.dll` hay bibliotecas que FFmpeg pone en
   `EXTERNAL_LIBRARY_VERSION3_LIST` (exigen LGPL/GPL **v3**): `libopencore_amrnb/amrwb`
   (Apache-2.0) y `libaribb24` (LGPL-3.0); además `gmp`/`mbedtls` en sus opciones v3/Apache. El
   código GPL-2.0-only no puede combinarse con Apache-2.0 ni con (L)GPL-3.0 (según la FSF), y FFTW
   (GPL-2+) obliga a que el conjunto sea GPL. Conclusión: **ninguna licencia única (ni LGPL ni
   GPL-2.0-or-later ni GPL-3.0) describe con verdad este binario**; redistribuirlo tal cual tiene
   riesgo legal real aunque se publique toda la fuente.
4. **Resto de bibliotecas** (tabla completa con licencia y SHA-256 en `SOURCES.md` del Release de
   fuentes): LGPL-2.0+/2.1+/3.0 (FFmpeg, glib, pango, fribidi, gme, lame, twolame, libbluray,
   libssh, soxr, libudfread, librsvg, libplacebo, openal, libiconv, vapoursynth, aribb24), MPL-2.0
   (libzmq, srt), Apache-2.0 (openssl, opencl, opencore-amr, spirv-cross, shaderc), duales usadas en
   su rama permisiva/LGPL (gmp LGPL-3+|GPL-2+, freetype FTL|GPL-2, mbedtls Apache-2.0|GPL-2+, cairo
   LGPL-2.1|MPL-1.1) y permisivas (BSD/MIT/ISC/zlib/0BSD/libpng/WTFPL: aom, dav1d, libvpx, libwebp,
   opus, vorbis, theora, svtav1, rav1e, kvazaar, vvenc, openh264, openjpeg, libjxl, harfbuzz,
   fontconfig, libass, zimg, lcms2, xz, zlib, …). Runtime de GCC con la GCC Runtime Library
   Exception. No se revisó archivo por archivo cada biblioteca (sí FFTW, chromaprint y zvbi).
5. Lo que **no** hay (comprobado en `-buildconf`): `--enable-gpl`, `--enable-nonfree`, x264, x265,
   xvid, vid.stab, fdk-aac, frei0r, avisynth, rubberband, davs2/xavs2, dvdread/dvdnav.

Salida adoptada: el build propio de arriba (misma fuente de FFmpeg, solo las bibliotecas de la
lista blanca, sin chromaprint ni zvbi y sin `--enable-version3`). gyan.dev «essentials/full» y los
builds `gpl` de BtbN **no sirven** (llevan x264/x265 → GPL). El Release
`ffmpeg-lgpl-n9.0.2-22-g46d8f462ee` (sin `-chamva1`) previsto para el build BtbN nunca se publicó.

## Empaquetado

Procedimiento completo (CI, local, actualizar versión, regenerar hashes, Release de fuentes):
`docs/release-ffmpeg.md`. `.github/workflows/release.yml` lo aplica **solo en `windows-latest`**:
caché del zip por hash del manifiesto, `node scripts/fetch-ffmpeg.mjs --target
x86_64-pc-windows-msvc` (descarga del Release propio, SHA-256 del zip y de cada archivo, auditoría,
`-L`/`-buildconf`) y `--config src-tauri/tauri.ffmpeg.conf.json` en `tauri-action`. Si algo no
cuadra, falla el job de Windows y no se publica su instalador (Linux y macOS siguen:
`fail-fast: false`). `src-tauri/binaries/` está en `.gitignore`.

## Probado y sin probar

Probado (2026-10-05, Windows 11 x64, RTX 3060 Ti) con el build propio: instalador local con
`tauri.ffmpeg.conf.json` (NSIS 35,1 MB y MSI 41,7 MB, antes 13,4 / 14,9 MB) con ffmpeg.exe,
ffprobe.exe, las 7 DLL (SHA-256 del manifiesto), `LICENSE.txt`, `AVISO-FFMPEG.txt`,
`ffmpeg-licenses/` y la página de licencia con la URL de la fuente; el `chamva.exe` de release
(WebView2 aislado, por CDP): «installed» la primera vez, «skipped» la segunda sin reescribir
nada, «repaired» con una DLL alterada, ausente o plantada, un build BtbN plantado en la carpeta de
datos NO se ejecuta (con y sin sello copiado: «retirado por licencias»; con recursos, se repara),
y sin recursos la app arranca normal. Probe y proxy (h264_mf y VP8) de clips HEVC (hevc_nvenc) y
ProRes con la copia que preparó la app; progreso y cancelación con el mismo binario.

Sin probar: instalar de verdad el NSIS/MSI (por usuario y por máquina) y actualizar desde v0.9.0,
macOS (VideoToolbox, build universal), Linux, Windows ARM, Android, QSV/AMF (solo NVENC y MF
funcionan en la máquina de prueba), la exportación por hardware de punta a punta y el flujo
completo dentro de la app con el diálogo nativo.
