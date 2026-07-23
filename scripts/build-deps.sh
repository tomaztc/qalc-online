#!/usr/bin/env bash
# Cross-compile libqalculate's C dependencies to WebAssembly with Emscripten:
#   GMP, MPFR (needs GMP), libxml2.
# Produces static archives + headers under $QPREFIX. Skips deps already built.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v emcc >/dev/null 2>&1 || { echo "ERROR: emcc not found on PATH" >&2; exit 1; }

deps_signature="$({
  emcc --version | sed -n '1p'
  printf '%s\n' "$GMP_VERSION" "$MPFR_VERSION" "$LIBXML2_VERSION"
  sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1
} | sha256sum | cut -d' ' -f1)"
signature_file="$QPREFIX/.deps-build-signature"
all_archives=(
  "$QPREFIX/lib/libgmp.a"
  "$QPREFIX/lib/libmpfr.a"
  "$QPREFIX/lib/libxml2.a"
)
if [ -f "$signature_file" ] && [ "$(<"$signature_file")" != "$deps_signature" ]; then
  echo "dependency configuration changed; rebuilding the WebAssembly prefix"
  rm -rf "$QPREFIX"
elif [ ! -f "$signature_file" ]; then
  # Existing prefixes from older checkouts have no signature. Adopt a complete
  # one once; future compiler, version, or recipe changes are then detected.
  complete=true
  for archive in "${all_archives[@]}"; do
    if [ ! -f "$archive" ]; then complete=false; break; fi
  done
  if [ "$complete" = true ]; then
    mkdir -p "$QPREFIX"
    printf '%s\n' "$deps_signature" > "$signature_file"
  fi
fi

mkdir -p "$QDEPS" "$QPREFIX"
cd "$QDEPS"

fetch() { # url outfile
  [ -f "$2" ] && return
  echo "downloading $2"
  part="$2.part"
  rm -f "$part"
  if ! curl -fsSL \
    --retry 5 --retry-all-errors --connect-timeout 20 --max-time 300 \
    -o "$part" "$1"; then
    rm -f "$part"
    return 1
  fi
  mv "$part" "$2"
}

# ---- GMP ----
if [ ! -f "$QPREFIX/lib/libgmp.a" ]; then
  fetch "https://ftp.gnu.org/gnu/gmp/gmp-${GMP_VERSION}.tar.xz" "gmp-${GMP_VERSION}.tar.xz"
  rm -rf "gmp-${GMP_VERSION}"; tar xf "gmp-${GMP_VERSION}.tar.xz"
  ( cd "gmp-${GMP_VERSION}"
    emconfigure ./configure --host=none --disable-assembly --enable-cxx=no \
      --disable-shared --enable-static --prefix="$QPREFIX" CFLAGS="-O2"
    emmake make -j"$QJOBS"
    emmake make install )
  echo "GMP built"
else
  echo "GMP already built"
fi

# ---- MPFR (depends on GMP) ----
if [ ! -f "$QPREFIX/lib/libmpfr.a" ]; then
  fetch "https://ftp.gnu.org/gnu/mpfr/mpfr-${MPFR_VERSION}.tar.xz" "mpfr-${MPFR_VERSION}.tar.xz"
  rm -rf "mpfr-${MPFR_VERSION}"; tar xf "mpfr-${MPFR_VERSION}.tar.xz"
  ( cd "mpfr-${MPFR_VERSION}"
    emconfigure ./configure --host=wasm32-unknown-emscripten --prefix="$QPREFIX" \
      --with-gmp="$QPREFIX" --disable-shared --enable-static CFLAGS="-O2"
    emmake make -j"$QJOBS"
    emmake make install )
  echo "MPFR built"
else
  echo "MPFR already built"
fi

# ---- libxml2 (minimal, no network/threads/icu/zlib) ----
if [ ! -f "$QPREFIX/lib/libxml2.a" ]; then
  fetch "https://download.gnome.org/sources/libxml2/${LIBXML2_SERIES}/libxml2-${LIBXML2_VERSION}.tar.xz" "libxml2-${LIBXML2_VERSION}.tar.xz"
  rm -rf "libxml2-${LIBXML2_VERSION}"; tar xf "libxml2-${LIBXML2_VERSION}.tar.xz"
  ( cd "libxml2-${LIBXML2_VERSION}"
    emconfigure ./configure --host=wasm32-unknown-emscripten --prefix="$QPREFIX" \
      --enable-static --disable-shared \
      --without-python --without-zlib --without-lzma --without-iconv \
      --without-http --without-ftp --without-html --without-modules \
      --without-threads --without-catalog --without-schematron \
      --without-c14n --without-debug --without-legacy CFLAGS="-O2"
    emmake make -j"$QJOBS"
    emmake make install )
  echo "libxml2 built"
else
  echo "libxml2 already built"
fi

echo "all dependencies present in $QPREFIX"
printf '%s\n' "$deps_signature" > "$signature_file"
