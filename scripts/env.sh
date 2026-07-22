#!/usr/bin/env bash
# Shared environment for all build scripts. Source this; do not execute.
#
# Derives every path from the repository location, so the project builds
# anywhere with no machine-specific configuration.

# Repo root = parent of this scripts/ directory.
QROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export QROOT
export QSUB="$QROOT/libqalculate"          # libqalculate submodule
export QDEPS="$QROOT/deps"                  # third-party sources (gmp/mpfr/libxml2)
export QPREFIX="$QROOT/wasm-prefix"         # install prefix for wasm-built deps
export QBUILD="$QROOT/build"                # object files / static archive
export QSRCDIR="$QBUILD/source"              # patched, generated build source
export QWEB="$QROOT/web"                    # web app output

# Dependency versions (override via environment if needed).
export GMP_VERSION="${GMP_VERSION:-6.3.0}"
export MPFR_VERSION="${MPFR_VERSION:-4.2.2}"
export LIBXML2_VERSION="${LIBXML2_VERSION:-2.12.10}"
export LIBXML2_SERIES="${LIBXML2_SERIES:-2.12}"

# libqalculate version string (embedded in the build; matches the submodule tag).
export QALC_VERSION="${QALC_VERSION:-5.12.0}"

# Emscripten: if emcc is not already on PATH, try a local emsdk checkout.
if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "$QROOT/emsdk/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "$QROOT/emsdk/emsdk_env.sh" >/dev/null 2>&1
  fi
fi

# Common compiler flags for building libqalculate + qalc to WebAssembly.
#  - COMPILED_DEFINITIONS: embed the XML definition data as C strings (no runtime FS)
#  - QALC_FIBER_THREADS:   use the Emscripten-fiber Thread implementation (no pthreads)
#  - HAVE_UNORDERED_MAP:   use std::unordered_map (config.h is not generated here)
#  - PACKAGE_*_DIR:        placeholders; unused at runtime under COMPILED_DEFINITIONS
export QALC_DEFINES=(
  -DCOMPILED_DEFINITIONS
  -DQALC_FIBER_THREADS
  -DHAVE_UNORDERED_MAP=1
  -DPACKAGE_DATA_DIR='"/usr/share"'
  -DPACKAGE_LOCALE_DIR='"/usr/share/locale"'
  -DVERSION="\"$QALC_VERSION\""
)
QALC_INCLUDES=(
  -I"$QSRCDIR"
  -I"$QSRCDIR/libqalculate"
  -I"$QPREFIX/include"
  -I"$QPREFIX/include/libxml2"
)
# Use -Os/-Oz when raw download size matters more than runtime throughput.
export QALC_OPTIMIZATION="${QALC_OPTIMIZATION:--O2}"
QALC_CXXFLAGS=(
  "$QALC_OPTIMIZATION" -std=c++17
  -Wno-deprecated-declarations -Wno-sentinel
)

# Number of parallel jobs. Cap the default because parallel C++ compilation can
# otherwise exhaust memory on hosts that report a very large CPU count.
if [ -z "${QJOBS:-}" ]; then
  detected_jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
  [ "$detected_jobs" -le 8 ] || detected_jobs=8
  export QJOBS="$detected_jobs"
else
  export QJOBS
fi
