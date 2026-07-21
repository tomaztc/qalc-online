#!/usr/bin/env bash
# Compile libqalculate (all sources + generated definitions.c) to a WebAssembly
# static archive: $QBUILD/libqalculate.a. Requires build-deps.sh to have run and
# the patches + definitions.c to be in place.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v em++ >/dev/null 2>&1 || { echo "ERROR: em++ not found on PATH" >&2; exit 1; }
[ -f "$QSUB/libqalculate/definitions.c" ] || { echo "ERROR: run gen-definitions.sh first" >&2; exit 1; }

cd "$QSUB"
mkdir -p "$QBUILD/obj"

flags=("${QALC_CXXFLAGS[@]}" "${QALC_DEFINES[@]}" "${QALC_INCLUDES[@]}")

# Invalidate all library objects if compiler options, the submodule revision, or
# an integration patch changed. Source mtimes alone cannot detect a changed
# class layout in util.h after the submodule is restored and patched again.
signature="$({
  printf '%s\n' "${flags[@]}"
  git rev-parse HEAD
  for patch in "$QROOT"/patches/*.patch; do
    sha256sum "$patch" | cut -d' ' -f1
  done
} | sha256sum | cut -d' ' -f1)"
signature_file="$QBUILD/.lib-build-signature"
if [ ! -f "$signature_file" ] || [ "$(cat "$signature_file")" != "$signature" ]; then
  echo "build configuration changed; rebuilding all libqalculate objects"
  rm -f "$QBUILD"/obj/*.o "$QBUILD/libqalculate.a"
  printf '%s\n' "$signature" > "$signature_file"
fi

srcs=(libqalculate/*.cc)
fail=0
for f in "${srcs[@]}"; do
  obj="$QBUILD/obj/$(basename "${f%.cc}").o"
  header_changed=false
  if [ -f "$obj" ] && find libqalculate -maxdepth 1 -name '*.h' -newer "$obj" -print -quit | grep -q .; then
    header_changed=true
  fi
  if [ ! -f "$obj" ] || [ "$f" -nt "$obj" ] || [ "$header_changed" = true ]; then
    echo "CC $f"
    ( em++ "${flags[@]}" -c "$f" -o "$obj" || { echo "FAILED: $f"; rm -f "$obj"; } ) &
  fi
  while [ "$(jobs -r | wc -l)" -ge "$QJOBS" ]; do wait -n; done
done
wait

# Embedded definition data (plain C).
em++ -O2 -DCOMPILED_DEFINITIONS -I. -c libqalculate/definitions.c -o "$QBUILD/obj/definitions.o"

for f in "${srcs[@]}"; do
  obj="$QBUILD/obj/$(basename "${f%.cc}").o"
  [ -f "$obj" ] || { echo "MISSING OBJECT: $obj"; fail=1; }
done
[ "$fail" = 0 ] || { echo "BUILD INCOMPLETE" >&2; exit 1; }

emar rcs "$QBUILD/libqalculate.a" "$QBUILD"/obj/*.o
echo "built $QBUILD/libqalculate.a"
ls -la "$QBUILD/libqalculate.a"
