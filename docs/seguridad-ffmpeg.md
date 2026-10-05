# FFmpeg nativo en escritorio (V10): seguridad y licencia

> **v0.9.0 se publica SIN FFmpeg.** El build BtbN fijado se descartó por licencias mixtas (ver
> «Auditoría de licencias del binario»): `src-tauri/ffmpeg-manifest.json` lo marca
> `"status": "blocked-license"`, `scripts/fetch-ffmpeg.mjs` se niega a descargarlo (código 8) y la
> app no lo instala, no lo acepta a mano y no ejecuta ningún binario con sus SHA-256 (ni siquiera
> en desarrollo). Sin FFmpeg válido el escritorio se comporta como web/Android: «nativo no
> disponible» y la importación de v0.8.1. **v0.9.1** traerá un build propio con
> `--disable-chromaprint --disable-libzvbi`. Lo que sigue describe el mecanismo (que se conserva)
> para ese build.

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

> **Estado (2026-10-05): la licencia efectiva del binario fijado NO es «LGPL» ni «GPL-2.0-or-later»
> limpio** (ver «Auditoría de licencias del binario» abajo). **Decisión:** no se redistribuye. v0.9.0
> sale sin FFmpeg y sin apuntar a ese binario; la app ya no afirma ninguna licencia de FFmpeg (dice
> «La conversión con FFmpeg nativo no está incluida en esta versión; llegará en una próxima
> actualización»). v0.9.1: build propio sin chromaprint ni zvbi.

- Build fijado: BtbN FFmpeg-Builds `autobuild-2026-10-04-20-51`, `n9.0.2-22-g46d8f462ee`,
  variante BtbN «lgpl-shared» (DLL separadas). El nombre de la variante solo refleja que FFmpeg se
  configuró sin `--enable-gpl`; no describe la licencia de las bibliotecas enlazadas.
  Windows x64: `ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip`, SHA-256
  `feb93d768fe01ebb696d990c4f0c65add416c12e5e16fa73ad5643237e0e9e22` (coincide con el
  `checksums.sha256` y con el digest de la API de GitHub). `-L`: LGPL v3 o posterior (lo que
  imprime `-L` depende solo de `--enable-gpl/--enable-version3`, no de las bibliotecas).
  `-buildconf`: `--enable-version3`, sin `--enable-gpl`/`--enable-nonfree`,
  `--disable-libx264 --disable-libx265 --disable-libvidstab --disable-libfdk-aac --disable-libxvid`.

### Auditoría de licencias del binario (2026-10-05, verificada a mano)

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

Salida recomendada: build propio desde la misma fuente con **`--disable-chromaprint
--disable-libzvbi`** (ChamVa no usa ni huella acústica ni teletexto); con eso el conjunto vuelve a
ser LGPL-3.0-or-later de verdad (comprobar de nuevo con `grep fftw` y la cadena `zvbi`).
- gyan.dev «essentials/full» y los builds `gpl` de BtbN **no sirven** (llevan x264/x265 → GPL).
- Aviso en la app (solo si hay un FFmpeg en uso): pie del diálogo «Convertir para editar» y
  **Ajustes → «FFmpeg (componente de terceros)»** (versión, licencia que declara, estado de la copia
  propia, texto de la licencia y enlace a la fuente). En v0.9.0 Ajustes → FFmpeg solo dice que no
  está incluida. Aviso en el instalador (solo con `tauri.ffmpeg.conf.json`, que v0.9.0 no usa):
  `scripts/fetch-ffmpeg.mjs` genera
  `binaries/LICENCIAS-INSTALADOR.txt` (MIT de ChamVa + aviso FFmpeg con la oferta de fuente) que
  `tauri.ffmpeg.conf.json` usa como `licenseFile`, y copia `LICENSE.txt` (LGPL v3) y
  `AVISO-FFMPEG.txt` junto a los binarios.
- Fuente completa: para el build de v0.9.1, un Release propio (manifiesto: `sourceRelease`) con el
  binario exacto, FFmpeg en el commit exacto, los scripts del build y las fuentes de las bibliotecas
  incluidas. El Release `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee` previsto para el build BtbN **no se
  publicó** (comprobado: no existe) y ya no se publicará; `sourceRelease` y `mirrors` se quitaron
  del manifiesto. Procedimiento: `docs/release-ffmpeg.md`.
- Patentes: H.264/AAC se codifican con el sistema (`h264_mf`, VideoToolbox) o con el AAC nativo de
  FFmpeg; la alternativa libre es VP8 + Opus. El build incluye `libopenh264` compilado desde la
  fuente (sin la cobertura de patentes de Cisco): ChamVa **no** lo usa.

## Empaquetado

Procedimiento completo (CI, local, actualizar versión, regenerar hashes, Release de fuentes):
`docs/release-ffmpeg.md`. En v0.9.0 el CI (`.github/workflows/release.yml`) NO lo aplica: está
como en v0.8.1; la versión con FFmpeg queda como referencia en `docs/release-ffmpeg.workflow.yml.txt`
(no es un workflow). Sin ese paso el instalador sale sin FFmpeg y la app lo dice.
`src-tauri/binaries/` está en `.gitignore`.

## Sin probar

macOS (VideoToolbox, build universal), Linux (build estático lgpl, VA-API no se usa), Windows ARM,
QSV/AMF (solo NVENC y MF funcionan en la máquina de prueba), la exportación por hardware de punta a
punta y el flujo completo dentro de la app con el diálogo nativo (se probó la IPC real en la app
y la conversión/cancelación con el ffmpeg real por separado).
