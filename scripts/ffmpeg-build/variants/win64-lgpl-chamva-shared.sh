#!/bin/bash
# shellcheck disable=SC2034,SC2128,SC1091  # variables y estilo que lee BtbN (generate.sh/build.sh)
# Variante propia de ChamVa para BtbN/FFmpeg-Builds (la copia scripts/ffmpeg-build/build.sh a
# variants/ en el checkout fijado de BtbN). Paquete resultante: «win64-chamva-lgpl-shared».
#
# El identificador interno empieza por «lgpl» A PROPÓSITO: 11 scripts de BtbN (x264, x265, xvid,
# vidstab, frei0r, rubberband, davs2, xavs2, avisynth, dvd*…) se desactivan con
# `[[ $VARIANT == lgpl* ]] && return -1`. Aquí además build.sh BORRA de scripts.d/ toda etapa que
# no esté en scripts/ffmpeg-allowed-libs.json, así que esas bibliotecas ni se descargan.
#
# Licencia objetivo: LGPL-2.1-or-later. Sin --enable-version3: ninguna biblioteca de la lista
# blanca lo necesita (las que lo exigían —opencore-amr, aribb24, gmp, mbedtls— están fuera).
source "$(dirname "$BASH_SOURCE")"/windows-install-shared.sh

FF_CONFIGURE="--disable-debug --enable-shared --disable-static"
# licencia: LGPL-2.1-or-later; prohibido todo lo GPL, no libre o solo v3
FF_CONFIGURE+=" --disable-gpl --disable-nonfree --disable-version3"
# superficie: ChamVa solo abre archivos locales (-protocol_whitelist file) y no usa ffplay
FF_CONFIGURE+=" --disable-network --disable-ffplay --disable-schannel --disable-sdl2"
# h264_mf es obligatorio: si Media Foundation no se detecta, configure debe FALLAR
FF_CONFIGURE+=" --enable-mediafoundation"
# explícitos (defensa en profundidad: no están en el prefijo, pero así constan en -buildconf)
FF_CONFIGURE+=" --disable-chromaprint --disable-libzvbi --disable-libaribb24"
FF_CONFIGURE+=" --disable-libopencore-amrnb --disable-libopencore-amrwb --disable-gmp --disable-mbedtls"
FF_CONFIGURE+=" --disable-libx264 --disable-libx265 --disable-libxvid --disable-libvidstab --disable-libfdk-aac"
FF_CONFIGURE+=" --disable-frei0r --disable-avisynth --disable-librubberband --disable-libopenh264"
FF_CFLAGS=""
FF_CXXFLAGS=""
FF_LDFLAGS=""
GIT_BRANCH="release/9.0" # no se usa: build.sh compila el commit exacto de ffmpeg-allowed-libs.json
LICENSE_FILE="COPYING.LGPLv2.1"
