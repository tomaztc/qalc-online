#!/usr/bin/env bash
# Compile qalc.cc (the REPL, renamed main -> qalc_main under -DQALC_WEB) and the
# web driver, then link everything against libqalculate.a + the wasm deps into
# web/qalc.mjs + web/qalc.wasm.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v em++ >/dev/null 2>&1 || { echo "ERROR: em++ not found on PATH" >&2; exit 1; }
[ -f "$QBUILD/libqalculate.a" ] || { echo "ERROR: run build-lib.sh first" >&2; exit 1; }

cd "$QSRCDIR"
obj_dir="$QBUILD/obj/app"
mkdir -p "$obj_dir" "$QWEB"

# qalc.cc and qalc_web.cc need the web driver define set.
flags=("${QALC_CXXFLAGS[@]}" "${QALC_DEFINES[@]}" -DQALC_WEB "${QALC_INCLUDES[@]}")

qalc_obj="$obj_dir/qalc.o"
driver_obj="$obj_dir/qalc_web.o"
compile_signature="$({
  em++ --version | sed -n '1p'
  printf '%s\n' "${flags[@]}"
} | sha256sum | cut -d' ' -f1)"
compile_signature_file="$QBUILD/.app-compile-signature"
if [ ! -f "$compile_signature_file" ] ||
   [ "$(<"$compile_signature_file")" != "$compile_signature" ]; then
  echo "app compile configuration changed; rebuilding app objects"
  rm -f "$qalc_obj" "$driver_obj"
fi
if [ ! -f "$qalc_obj" ] || [ src/qalc.cc -nt "$qalc_obj" ] ||
   find libqalculate -maxdepth 1 -name '*.h' -newer "$qalc_obj" -print -quit | grep -q .; then
  echo "CC src/qalc.cc"
  em++ "${flags[@]}" -c src/qalc.cc -o "$qalc_obj"
fi
if [ ! -f "$driver_obj" ] || [ "$QROOT/src/qalc_web.cc" -nt "$driver_obj" ] ||
   find libqalculate -maxdepth 1 -name '*.h' -newer "$driver_obj" -print -quit | grep -q .; then
  echo "CC src/qalc_web.cc"
  em++ "${flags[@]}" -c "$QROOT/src/qalc_web.cc" -o "$driver_obj"
fi
printf '%s\n' "$compile_signature" > "$compile_signature_file"

link_flags=(
  "$QALC_OPTIMIZATION" -std=c++17
  -sASYNCIFY
  -sASYNCIFY_STACK_SIZE=16384
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=67108864
  -sSTACK_SIZE=5242880
  -sEXPORTED_FUNCTIONS='["_qalc_web_start","_qalc_web_eval","_qalc_web_preview","_qalc_web_set_userdir"]'
  -sEXPORTED_RUNTIME_METHODS='["cwrap","FS"]'
  -sINCOMING_MODULE_JS_API='["locateFile","print","printErr","wasmBinary"]'
  -sTEXTDECODER=2
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=QalcModule
  -sENVIRONMENT=web
)
link_signature="$({
  em++ --version | sed -n '1p'
  printf '%s\n' "${link_flags[@]}"
} | sha256sum | cut -d' ' -f1)"
signature_file="$QBUILD/.app-link-signature"
link_inputs=(
  "$qalc_obj" "$driver_obj" "$QBUILD/libqalculate.a"
  "$QPREFIX/lib/libxml2.a" "$QPREFIX/lib/libmpfr.a" "$QPREFIX/lib/libgmp.a"
)
needs_link=false
if [ ! -f "$QWEB/qalc.mjs" ] || [ ! -f "$QWEB/qalc.wasm" ] ||
   [ ! -f "$signature_file" ] || [ "$(<"$signature_file")" != "$link_signature" ]; then
  needs_link=true
else
  for input in "${link_inputs[@]}"; do
    if [ "$input" -nt "$QWEB/qalc.wasm" ]; then needs_link=true; break; fi
  done
fi

if [ "$needs_link" = true ]; then
  echo "linking web/qalc.mjs"
  if ! em++ "${link_flags[@]}" \
    "$qalc_obj" "$driver_obj" \
    "$QBUILD/libqalculate.a" \
    "$QPREFIX/lib/libxml2.a" "$QPREFIX/lib/libmpfr.a" "$QPREFIX/lib/libgmp.a" \
    -o "$QWEB/qalc.mjs"; then
    rm -f "$QWEB/qalc.mjs" "$QWEB/qalc.wasm" "$signature_file"
    exit 1
  fi
  printf '%s\n' "$link_signature" > "$signature_file"
else
  echo "web module already up to date"
fi

echo "done:"
ls -la "$QWEB/qalc.mjs" "$QWEB/qalc.wasm"
