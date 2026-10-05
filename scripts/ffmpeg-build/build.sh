#!/usr/bin/env bash
# Compila el FFmpeg propio de ChamVa (Windows x64, LGPL-2.1-or-later, DLL compartidas) desde la
# fuente con el método de BtbN/FFmpeg-Builds (Docker), fijando TODOS los commits en
# scripts/ffmpeg-allowed-libs.json. Lo usa .github/workflows/ffmpeg-build.yml; también corre en
# cualquier Linux x86_64 con Docker (buildx), git, jq, xz, zip y sha256sum.
#
#   WORK=/ruta/trabajo scripts/ffmpeg-build/build.sh prepare   # fuentes fijadas + overlay de BtbN
#   WORK=/ruta/trabajo scripts/ffmpeg-build/build.sh image     # imagen Docker con las bibliotecas
#   WORK=/ruta/trabajo scripts/ffmpeg-build/build.sh ffmpeg    # configure + make dentro de la imagen
#   WORK=/ruta/trabajo scripts/ffmpeg-build/build.sh package   # zip + licencias + fuentes + SHA256SUMS
#   WORK=/ruta/trabajo scripts/ffmpeg-build/build.sh all
#
# Variables: FFMPEG_REF (commit de FFmpeg, 40 hex; vacío = el fijado), RELEASE_TAG (solo para
# SOURCES.md). NO publica nada: deja todo en $WORK/out (binario) y $WORK/out/source (fuentes).
#
# Lista blanca: build.sh BORRA de scripts.d/ toda etapa que no esté en
# scripts/ffmpeg-allowed-libs.json (las GPL o incompatibles ni se descargan) y reescribe
# zz-final.sh con solo esas dependencias. La auditoría del binario es aparte
# (scripts/audit-ffmpeg-licenses.mjs) y es la que decide.
set -euo pipefail
shopt -s nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ALLOW="$ROOT/scripts/ffmpeg-allowed-libs.json"
WORK="${WORK:?define WORK (carpeta de trabajo)}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
OUT="$WORK/out"
SRC_OUT="$OUT/source"
BTBN="$WORK/btbn"
STATE="$WORK/state.env"

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "==> $*" >&2; }
j() { jq -er "$1" "$ALLOW"; }

for t in git jq xz sha256sum; do command -v "$t" >/dev/null || die "falta $t"; done
[[ "$(j .schema)" == 1 ]] || die "schema desconocido en $ALLOW"

BTBN_REPO="$(j .btbn.repo)"
BTBN_COMMIT="$(j .btbn.commit)"
CTNG_REPO="$(j .btbn.crosstoolNgRepo)"
CTNG_COMMIT="$(j .btbn.crosstoolNgCommit)"
TARGET="$(j .btbn.target)"
VARIANT="$(j .btbn.variant)"
mapfile -t ADDINS < <(j '.btbn.addins[]')
FFMPEG_REPO="$(j .ffmpeg.repo)"
FFMPEG_DEFAULT="$(j .ffmpeg.commit)"
FFMPEG_SHA="${FFMPEG_REF:-$FFMPEG_DEFAULT}"
EXTRA_VERSION="$(j .ffmpeg.extraVersion)"
PKG_SUFFIX="$(j .package.name)"
for c in "$BTBN_COMMIT" "$CTNG_COMMIT" "$FFMPEG_SHA"; do
  [[ "$c" =~ ^[0-9a-f]{40}$ ]] || die "commit no válido (se exigen 40 hex): $c"
done
[[ "$EXTRA_VERSION" =~ ^[a-z0-9]{1,16}$ ]] || die "extraVersion no válida"
[[ -z "${RELEASE_TAG:-}" || "$RELEASE_TAG" =~ ^ffmpeg-lgpl-[A-Za-z0-9._-]{1,80}$ ]] || die "RELEASE_TAG no válida: $RELEASE_TAG"

# imágenes solo locales: si algo intentara descargarlas de un registro, fallaría (chamva.local no existe)
export REGISTRY_OVERRIDE="chamva.local"
export GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-chamva/ffmpeg-build}"

# etapas que se conservan de scripts.d/ (sin «.sh»): base + bibliotecas + zz-final
keep_stages() {
  j '.btbn.baseStages[]'
  j '.libraries[].stage'
  echo zz-final
}

save_state() { printf '%s=%q\n' "$@" >>"$STATE"; }

# ------------------------------------------------------------------ prepare
cmd_prepare() {
  rm -f "$STATE"
  rm -rf "$OUT"
  mkdir -p "$SRC_OUT/libs" "$OUT/logs"

  log "BtbN/FFmpeg-Builds en $BTBN_COMMIT"
  mkdir -p "$BTBN" # puede existir ya con .cache/ restaurado de la caché de Actions
  git -C "$BTBN" init -q
  git -C "$BTBN" fetch -q --depth 1 "$BTBN_REPO" "$BTBN_COMMIT"
  git -C "$BTBN" -c advice.detachedHead=false checkout -q --force --detach FETCH_HEAD
  git -C "$BTBN" clean -q -fd # quita restos de un overlay anterior; .cache/ está en .gitignore y se conserva
  [[ "$(git -C "$BTBN" rev-parse HEAD)" == "$BTBN_COMMIT" ]] || die "BtbN no está en el commit fijado"
  git -C "$BTBN" archive --format=tar --prefix="FFmpeg-Builds-$BTBN_COMMIT/" HEAD | gzip -n -9 >"$SRC_OUT/FFmpeg-Builds-$BTBN_COMMIT.tar.gz"

  log "overlay de ChamVa: lista blanca de etapas, variante propia, crosstool-ng fijado"
  local keep
  keep="$(keep_stages | sort -u)"
  for s in $keep; do
    [[ -e "$BTBN/scripts.d/$s.sh" || -d "$BTBN/scripts.d/$s" || "$s" == zz-final ]] || die "la etapa $s de la lista blanca no existe en BtbN $BTBN_COMMIT"
  done
  for p in "$BTBN"/scripts.d/*; do
    local name
    name="$(basename "$p" .sh)"
    grep -qxF "$name" <<<"$keep" || git -C "$BTBN" rm -r -q -- "scripts.d/$(basename "$p")"
  done
  {
    echo '#!/bin/bash'
    echo '# Generado por ChamVa (scripts/ffmpeg-build/build.sh) desde scripts/ffmpeg-allowed-libs.json.'
    echo 'SCRIPT_SKIP="1"'
    echo 'ffbuild_depends() {'
    local base
    base="$(j '.btbn.baseStages[]')"
    j '.libraries[].stage' | while read -r st; do
      grep -qxF "$st" <<<"$base" || echo "    echo ${st#[0-9][0-9]-}"
    done
    echo '}'
    for f in enabled:0 dockerfinal:0 dockerdl:0 dockerlayer:0 dockerstage:0 dockerbuild:0 ldexeflags:0; do
      echo "ffbuild_${f%%:*}() {"
      echo "    return ${f##*:}"
      echo '}'
    done
  } >"$BTBN/scripts.d/zz-final.sh"
  cp "$HERE/variants/$TARGET-$VARIANT.sh" "$BTBN/variants/$TARGET-$VARIANT.sh"

  # BtbN clona crosstool-ng sin fijar (rama por defecto): se fija al commit de la lista blanca
  local df="$BTBN/images/base-$TARGET/Dockerfile" content
  local from="git clone --filter=blob:none $CTNG_REPO /ct-ng && cd /ct-ng && \\"
  local to="git clone --filter=blob:none $CTNG_REPO /ct-ng && cd /ct-ng && git checkout --detach $CTNG_COMMIT && test \"\$(git rev-parse HEAD)\" = $CTNG_COMMIT && \\"
  content="$(cat "$df")"
  [[ "$content" == *"$from"* ]] || die "no encuentro el clon de crosstool-ng en $df (¿cambió BtbN?)"
  printf '%s\n' "${content/"$from"/"$to"}" >"$df"
  grep -qF "git checkout --detach $CTNG_COMMIT && test" "$df" || die "no se pudo fijar crosstool-ng"

  git -C "$BTBN" add -A -- scripts.d variants images
  git -C "$BTBN" -c user.name=ChamVa -c user.email=build@chamva.invalid commit -q -m "ChamVa: overlay LGPL (lista blanca de scripts/ffmpeg-allowed-libs.json)"
  git -C "$BTBN" diff "$BTBN_COMMIT" HEAD >"$SRC_OUT/chamva-btbn-overlay.patch"
  git -C "$BTBN" archive --format=tar --prefix="FFmpeg-Builds-$BTBN_COMMIT-chamva/" HEAD | gzip -n -9 >"$SRC_OUT/FFmpeg-Builds-$BTBN_COMMIT-chamva.tar.gz"
  # el propio overlay de ChamVa (scripts con los que se compiló)
  tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 -C "$ROOT" -czf "$SRC_OUT/chamva-ffmpeg-build-scripts.tar.gz" \
    scripts/ffmpeg-build scripts/ffmpeg-allowed-libs.json scripts/audit-ffmpeg-licenses.mjs .github/workflows/ffmpeg-build.yml

  log "FFmpeg en $FFMPEG_SHA"
  local ffgit="$WORK/ffmpeg-git"
  if [[ ! -d "$ffgit/.git" ]]; then
    git clone -q --filter=blob:none --no-checkout "$FFMPEG_REPO" "$ffgit"
  else
    git -C "$ffgit" fetch -q --tags origin
  fi
  git -C "$ffgit" cat-file -e "$FFMPEG_SHA^{commit}" 2>/dev/null || git -C "$ffgit" fetch -q origin "$FFMPEG_SHA"
  git -C "$ffgit" -c advice.detachedHead=false checkout -q --force --detach "$FFMPEG_SHA"
  # version.sh usa `git describe`: abreviatura fija (como los builds de BtbN: g46d8f462ee)
  git -C "$ffgit" config core.abbrev 10
  [[ "$(git -C "$ffgit" rev-parse HEAD)" == "$FFMPEG_SHA" ]] || die "FFmpeg no está en el commit pedido"
  local ver mtime
  ver="$(cd "$ffgit" && sh ffbuild/version.sh .)"
  [[ "$ver" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] || die "versión de FFmpeg no válida: $ver"
  if [[ "$FFMPEG_SHA" == "$FFMPEG_DEFAULT" ]]; then
    [[ "$ver" == "$(j .ffmpeg.expectedVersion)" ]] || die "versión $ver distinta de la esperada $(j .ffmpeg.expectedVersion)"
  fi
  mtime="$(git -C "$ffgit" log -1 --format=%ct HEAD)"
  # la fuente que se compila ES la que se publica: git archive + VERSION (version.sh lo lee)
  rm -rf "$WORK/src"
  mkdir -p "$WORK/src"
  git -C "$ffgit" archive --format=tar --prefix="ffmpeg-$ver/" HEAD | tar -x -C "$WORK/src"
  printf '%s\n' "$ver" >"$WORK/src/ffmpeg-$ver/VERSION"
  touch -d "@$mtime" "$WORK/src/ffmpeg-$ver/VERSION"
  tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$mtime" --format=gnu -C "$WORK/src" -cf - "ffmpeg-$ver" | xz -T1 -6 >"$SRC_OUT/ffmpeg-$ver.tar.xz"

  save_state FF_VERSION "$ver" FFMPEG_SHA "$FFMPEG_SHA" SOURCE_MTIME "$mtime" \
    BUILD_NAME "ffmpeg-$ver-$PKG_SUFFIX"
  log "listo: FFmpeg $ver, BtbN $BTBN_COMMIT, crosstool-ng $CTNG_COMMIT"
}

load_state() {
  [[ -f "$STATE" ]] || die "falta $STATE: ejecuta antes «prepare»"
  # shellcheck disable=SC1090
  source "$STATE"
}

image_name() {
  (cd "$BTBN" && source util/vars.sh "$TARGET" "$VARIANT" "${ADDINS[@]}" >/dev/null && echo "$IMAGE")
}

# ------------------------------------------------------------------ image
cmd_image() {
  load_state
  command -v docker >/dev/null || die "falta docker"
  log "imagen $(image_name) (base + toolchain crosstool-ng + bibliotecas de la lista blanca)"
  (cd "$BTBN" && ./makeimage.sh "$TARGET" "$VARIANT" "${ADDINS[@]}")
  cp "$BTBN/Dockerfile" "$SRC_OUT/Dockerfile.generated"
  # etapas que entraron de verdad (FROM … AS <etapa>) frente a la lista blanca
  local got allowed
  got="$(sed -nE 's/^FROM [^ ]+ AS ([^ ]+)$/\1/p' "$BTBN/Dockerfile" | grep -vxE 'base-layer|stage-layer|combine-layer' | sort -u)"
  allowed="$(keep_stages | sed -E 's/^[0-9]+-//' | sort -u)"
  local bad
  bad="$(comm -23 <(echo "$got") <(echo "$allowed") || true)"
  [[ -z "$bad" ]] || die "la imagen incluye etapas fuera de la lista blanca: $bad"
  echo "$got" >"$OUT/logs/stages.txt"
  log "etapas compiladas: $(tr '\n' ' ' <"$OUT/logs/stages.txt")"
}

# ------------------------------------------------------------------ ffmpeg
cmd_ffmpeg() {
  load_state
  local img
  img="$(image_name)"
  docker image inspect "$img" >/dev/null 2>&1 || die "no existe la imagen $img: ejecuta antes «image»"
  rm -rf "$WORK/ffbuild"
  mkdir -p "$WORK/ffbuild"
  cp -a "$WORK/src/ffmpeg-$FF_VERSION" "$WORK/ffbuild/ffmpeg"
  local script="$WORK/build-in-docker.sh"
  cat >"$script" <<'EOF'
set -xe
cd /ffbuild/ffmpeg
./configure --prefix=/ffbuild/prefix --pkg-config-flags="--static" $FFBUILD_TARGET_FLAGS $FF_CONFIGURE \
    --extra-cflags="$FF_CFLAGS" --extra-cxxflags="$FF_CXXFLAGS" --extra-libs="$FF_LIBS" \
    --extra-ldflags="$FF_LDFLAGS" --extra-ldexeflags="$FF_LDEXEFLAGS" \
    --cc="$CC" --cxx="$CXX" --ar="$AR" --ranlib="$RANLIB" --nm="$NM" \
    --extra-version="$CHAMVA_EXTRA_VERSION" || { tail -n 300 ffbuild/config.log; exit 1; }
make -j"$(nproc)"
make install install-doc
EOF
  local uid=()
  if ! docker info -f '{{println .SecurityOptions}}' 2>/dev/null | grep -q rootless; then uid=(-u "$(id -u):$(id -g)"); fi
  log "configure + make de FFmpeg $FF_VERSION en $img"
  docker run --rm -i "${uid[@]}" -e CHAMVA_EXTRA_VERSION="$EXTRA_VERSION" \
    -v "$WORK/ffbuild":/ffbuild -v "$script":/build.sh:ro "$img" bash /build.sh
  cp "$WORK/ffbuild/ffmpeg/ffbuild/config.log" "$OUT/logs/ffmpeg-config.log" 2>/dev/null || true
  grep -E '^#define FFMPEG_CONFIGURATION ' "$WORK/ffbuild/ffmpeg/config.h" | sed -E 's/^#define FFMPEG_CONFIGURATION "(.*)"$/\1/' >"$OUT/logs/buildconf.txt"
  log "configuración: $(cat "$OUT/logs/buildconf.txt")"
}

# ------------------------------------------------------------------ package
cmd_package() {
  load_state
  command -v zip >/dev/null || die "falta zip"
  local pkgroot="$WORK/pkg" pkg="$WORK/pkg/$BUILD_NAME"
  rm -rf "$pkgroot"
  mkdir -p "$pkg"
  # mismo reparto que BtbN (bin/ lib/ include/ doc/ presets/): DLL compartidas para que el usuario
  # pueda sustituirlas y, con include/ y lib/, recompilar o enlazar contra ellas
  (shopt -u nullglob && set +u && source "$BTBN/variants/windows-install-shared.sh" && package_variant "$WORK/ffbuild/prefix" "$pkg")
  cp "$WORK/ffbuild/ffmpeg/$(j .ffmpeg.licenseFile)" "$pkg/LICENSE.txt"
  mkdir -p "$pkg/licenses/ffmpeg"
  cp "$WORK/ffbuild/ffmpeg/LICENSE.md" "$WORK/ffbuild/ffmpeg/$(j .ffmpeg.licenseFile)" "$pkg/licenses/ffmpeg/"

  log "licencias y fuente de cada biblioteca enlazada"
  local libs_json="$WORK/libs.json"
  echo '[]' >"$libs_json"
  local n
  n="$(j '.libraries | length')"
  for ((i = 0; i < n; i++)); do
    local id stage lic hdr hdrn tarball real sha tmp
    id="$(j ".libraries[$i].id")"
    stage="$(j ".libraries[$i].stage")"
    lic="$(j ".libraries[$i].license")"
    hdr="$(jq -r ".libraries[$i].licenseHeader // empty" "$ALLOW")"
    hdrn="$(jq -r ".libraries[$i].licenseHeaderLines // 30" "$ALLOW")"
    tarball="$BTBN/.cache/downloads/$stage.tar.xz"
    [[ -e "$tarball" ]] || die "no está la fuente descargada de $stage ($tarball)"
    real="$(readlink -f "$tarball")"
    cp "$real" "$SRC_OUT/libs/"
    sha="$(sha256sum "$real" | cut -d' ' -f1)"
    tmp="$(mktemp -d)"
    tar -xJf "$real" -C "$tmp"
    mkdir -p "$pkg/licenses/$id"
    while IFS= read -r -d '' f; do
      local rel="${f#"$tmp"/}"
      mkdir -p "$pkg/licenses/$id/$(dirname "$rel")"
      cp "$f" "$pkg/licenses/$id/$rel"
    done < <(find "$tmp" -maxdepth 4 -type f \( -iname 'copying*' -o -iname 'license*' -o -iname 'licence*' -o -iname 'notice*' -o -iname 'patents*' \) -not -path '*/.git/*' -print0)
    if [[ -n "$hdr" ]]; then
      local h
      h="$(find "$tmp" -path "*/$hdr" -type f | LC_ALL=C sort | head -n 1)"
      [[ -n "$h" ]] || die "$id: no encuentro $hdr para extraer su licencia"
      head -n "$hdrn" "$h" >"$pkg/licenses/$id/LICENSE-de-$(basename "$hdr").txt"
    fi
    rm -rf "$tmp"
    [[ -n "$(find "$pkg/licenses/$id" -type f -print -quit)" ]] || die "$id: su fuente no trae COPYING/LICENSE (añade licenseHeader en la lista blanca)"
    jq --arg id "$id" --arg stage "$stage" --arg lic "$lic" --arg file "libs/$(basename "$real")" --arg sha "$sha" \
      --arg repo "$(sed -nE 's/^SCRIPT_REPO="(.*)"$/\1/p' "$BTBN/scripts.d/$stage.sh" | head -n1)" \
      --arg commit "$(sed -nE 's/^SCRIPT_COMMIT="(.*)"$/\1/p' "$BTBN/scripts.d/$stage.sh" | head -n1)" \
      '. + [{id:$id, stage:$stage, license:$lic, repo:$repo, commit:$commit, source:$file, sha256:$sha}]' "$libs_json" >"$libs_json.tmp"
    mv "$libs_json.tmp" "$libs_json"
  done

  local buildconf
  buildconf="$(cat "$OUT/logs/buildconf.txt")"
  jq -n --arg name "$BUILD_NAME" --arg ver "$FF_VERSION" --arg sha "$FFMPEG_SHA" --arg btbn "$BTBN_COMMIT" \
    --arg ctng "$CTNG_COMMIT" --arg variant "$TARGET-$VARIANT" --arg conf "$buildconf" --arg extra "$EXTRA_VERSION" \
    --arg run "${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-local}" \
    --arg chamva "${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo desconocido)}" \
    --slurpfile libs "$libs_json" \
    '{name:$name, ffmpegVersion:$ver, extraVersion:$extra, ffmpegCommit:$sha, btbnCommit:$btbn, crosstoolNgCommit:$ctng,
      btbnVariant:$variant, license:"LGPL-2.1-or-later", buildconf:$conf, chamvaCommit:$chamva, ciRun:$run, libraries:$libs[0]}' \
    >"$pkg/BUILD-INFO.json"

  # fechas fijas y SHA256SUMS dentro del paquete
  find "$pkg" -exec touch -h -d "@$SOURCE_MTIME" {} +
  (cd "$pkg" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  touch -d "@$SOURCE_MTIME" "$pkg/SHA256SUMS"
  rm -f "$OUT/$BUILD_NAME.zip"
  (cd "$pkgroot" && find "$BUILD_NAME" | LC_ALL=C sort | TZ=UTC zip -X -9 -q -@ "$OUT/$BUILD_NAME.zip")
  cp "$pkg/BUILD-INFO.json" "$OUT/BUILD-INFO.json"

  write_sources_md "$libs_json" "$buildconf"
  (cd "$OUT" && find . -type f ! -name SHA256SUMS ! -path './logs/*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  log "paquete: $OUT/$BUILD_NAME.zip ($(du -h "$OUT/$BUILD_NAME.zip" | cut -f1)); fuentes: $(du -sh "$SRC_OUT" | cut -f1)"
}

write_sources_md() {
  local libs_json="$1" buildconf="$2" tag="${RELEASE_TAG:-ffmpeg-lgpl-$FF_VERSION-chamva1}"
  local zipsha
  zipsha="$(sha256sum "$OUT/$BUILD_NAME.zip" | cut -d' ' -f1)"
  {
    echo "# FFmpeg $FF_VERSION para ChamVa (Windows x64, LGPL-2.1-or-later): binario y fuente correspondiente"
    echo
    echo "Release previsto: \`$tag\` (se publica a mano con \`--prerelease --latest=false\`; ver docs/release-ffmpeg.md)."
    echo "Compilado por el flujo \`.github/workflows/ffmpeg-build.yml\` de ChamVa${GITHUB_RUN_ID:+ (ejecución ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})}."
    echo
    echo "## Binario"
    echo
    echo "- \`$BUILD_NAME.zip\`: \`bin/\` (ffmpeg.exe, ffprobe.exe y las DLL de FFmpeg, **compartidas**: puedes sustituirlas por otras compiladas por ti), \`lib/\` e \`include/\` (para enlazar o recompilar), \`LICENSE.txt\` (LGPL v2.1), \`licenses/<biblioteca>/\` (licencia de cada biblioteca enlazada), \`BUILD-INFO.json\` y \`SHA256SUMS\`."
    echo "- SHA-256 del zip: \`$zipsha\`"
    echo "- Licencia: **LGPL-2.1-or-later** (FFmpeg configurado sin \`--enable-gpl\`, \`--enable-nonfree\` ni \`--enable-version3\`; todas las bibliotecas enlazadas son LGPL-2.1+ o permisivas, tabla abajo). Auditado automáticamente: \`audit.json\`."
    echo
    echo "## Fuente (carpeta \`source/\`)"
    echo
    echo "| Componente | Commit | Archivo |"
    echo "|---|---|---|"
    echo "| FFmpeg $FF_VERSION ($(j .ffmpeg.repo)) | \`$FFMPEG_SHA\` | \`ffmpeg-$FF_VERSION.tar.xz\` (git archive + \`VERSION\`; es el árbol exacto que se compiló) |"
    echo "| BtbN/FFmpeg-Builds (scripts de compilación, sin tocar) | \`$BTBN_COMMIT\` | \`FFmpeg-Builds-$BTBN_COMMIT.tar.gz\` |"
    echo "| BtbN/FFmpeg-Builds con el overlay de ChamVa (lo que se ejecutó) | — | \`FFmpeg-Builds-$BTBN_COMMIT-chamva.tar.gz\` y el diff \`chamva-btbn-overlay.patch\` |"
    echo "| Scripts de ChamVa (flujo, overlay, lista blanca, auditoría) | \`${GITHUB_SHA:-local}\` | \`chamva-ffmpeg-build-scripts.tar.gz\` |"
    echo "| crosstool-ng (toolchain mingw-w64 GCC; configuración en \`images/base-win64/ct-ng-config\`) | \`$CTNG_COMMIT\` | no se redistribuye: GCC/binutils son herramientas; libgcc/libstdc++ van con la GCC Runtime Library Exception |"
    echo "| Dockerfile generado por BtbN para esta variante | — | \`Dockerfile.generated\` |"
    echo
    echo "### Bibliotecas enlazadas en las DLL"
    echo
    echo "| Biblioteca | Licencia | Repositorio | Commit | Fuente | SHA-256 |"
    echo "|---|---|---|---|---|---|"
    jq -r '.[] | "| \(.id) | \(.license) | \(.repo) | `\(.commit)` | `\(.source)` | `\(.sha256)` |"' "$libs_json"
    echo
    echo "Cada \`libs/<etapa>_<hash>.tar.xz\` es la descarga exacta que hizo \`download.sh\` de BtbN (commit fijado en \`scripts.d/<etapa>.sh\`)."
    echo
    echo "## Configuración (\`ffmpeg -buildconf\`)"
    echo
    echo '```'
    echo "$buildconf"
    echo '```'
    echo
    echo "## Cómo reproducirlo"
    echo
    echo "En Linux x86_64 con Docker: extrae \`chamva-ffmpeg-build-scripts.tar.gz\` en un clon de ChamVa del mismo commit y ejecuta"
    echo "\`WORK=/tmp/ffbuild scripts/ffmpeg-build/build.sh all\`, o lanza el flujo \`ffmpeg-build.yml\`. Las imágenes base (ubuntu, paquetes apt) no están fijadas por digest: el binario puede variar en bytes; la fuente de FFmpeg y de cada biblioteca, no."
  } >"$OUT/SOURCES.md"
}

case "${1:-}" in
  prepare) cmd_prepare ;;
  image) cmd_image ;;
  ffmpeg) cmd_ffmpeg ;;
  package) cmd_package ;;
  all) cmd_prepare && cmd_image && cmd_ffmpeg && cmd_package ;;
  *) die "uso: WORK=… $0 prepare|image|ffmpeg|package|all" ;;
esac
