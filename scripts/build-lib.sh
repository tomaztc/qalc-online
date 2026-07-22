#!/usr/bin/env bash
# Compile libqalculate (all sources + generated definitions.c) to a WebAssembly
# static archive: $QBUILD/libqalculate.a. Requires the staged source tree and
# generated definitions to be present.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v em++ >/dev/null 2>&1 || { echo "ERROR: em++ not found on PATH" >&2; exit 1; }
[ -f "$QBUILD/generated/definitions.c" ] || { echo "ERROR: run gen-definitions.sh first" >&2; exit 1; }
[ -f "$QSRCDIR/libqalculate/Calculator.cc" ] || { echo "ERROR: run apply-patches.sh first" >&2; exit 1; }

cd "$QSRCDIR"
obj_dir="$QBUILD/obj/lib"
mkdir -p "$obj_dir"
# Remove objects produced by the old shared obj/ layout. Keeping app objects out
# of this directory is what prevents them from leaking into libqalculate.a.
rm -f "$QBUILD"/obj/*.o

flags=("${QALC_CXXFLAGS[@]}" "${QALC_DEFINES[@]}" "${QALC_INCLUDES[@]}")

# Invalidate all library objects if compiler options, the submodule revision, or
# an integration patch changed. Source mtimes alone cannot detect a changed
# class layout in util.h after the submodule is restored and patched again.
signature="$({
  em++ --version | sed -n '1p'
  printf '%s\n' "${flags[@]}"
  cat "$QBUILD/.source-signature"
  for patch in "$QROOT"/patches/*.patch; do
    sha256sum "$patch" | cut -d' ' -f1
  done
} | sha256sum | cut -d' ' -f1)"
signature_file="$QBUILD/.lib-build-signature"
if [ ! -f "$signature_file" ] || [ "$(cat "$signature_file")" != "$signature" ]; then
  echo "build configuration changed; rebuilding all libqalculate objects"
  rm -f "$obj_dir"/*.o "$QBUILD/libqalculate.a"
fi

srcs=(libqalculate/*.cc)
fail=0
archive_needed=false
for f in "${srcs[@]}"; do
  obj="$obj_dir/$(basename "${f%.cc}").o"
  header_changed=false
  if [ -f "$obj" ] && find libqalculate -maxdepth 1 -name '*.h' -newer "$obj" -print -quit | grep -q .; then
    header_changed=true
  fi
  if [ ! -f "$obj" ] || [ "$f" -nt "$obj" ] || [ "$header_changed" = true ]; then
    archive_needed=true
    echo "CC $f"
    ( em++ "${flags[@]}" -c "$f" -o "$obj" || { echo "FAILED: $f"; rm -f "$obj"; } ) &
  fi
  while [ "$(jobs -r | wc -l)" -ge "$QJOBS" ]; do wait -n; done
done
wait

# Embedded definition data (plain C).
definitions_obj="$obj_dir/definitions.o"
if [ ! -f "$definitions_obj" ] || [ "$QBUILD/generated/definitions.c" -nt "$definitions_obj" ]; then
  archive_needed=true
  echo "CC generated/definitions.c"
  emcc "$QALC_OPTIMIZATION" -DCOMPILED_DEFINITIONS -I. \
    -c "$QBUILD/generated/definitions.c" -o "$definitions_obj"
fi

for f in "${srcs[@]}"; do
  obj="$obj_dir/$(basename "${f%.cc}").o"
  [ -f "$obj" ] || { echo "MISSING OBJECT: $obj"; fail=1; }
done
[ "$fail" = 0 ] || { echo "BUILD INCOMPLETE" >&2; exit 1; }

if [ "$archive_needed" = true ] || [ ! -f "$QBUILD/libqalculate.a" ]; then
  emar rcs "$QBUILD/libqalculate.a" "$obj_dir"/*.o
  printf '%s\n' "$signature" > "$signature_file"
  echo "built $QBUILD/libqalculate.a"
else
  echo "libqalculate archive already up to date"
fi
ls -la "$QBUILD/libqalculate.a"
