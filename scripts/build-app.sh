#!/usr/bin/env bash
# Compile qalc.cc (the REPL, renamed main -> qalc_main under -DQALC_WEB) and the
# web driver, then link everything against libqalculate.a + the wasm deps into
# web/qalc.mjs + web/qalc.wasm.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v em++ >/dev/null 2>&1 || { echo "ERROR: em++ not found on PATH" >&2; exit 1; }
[ -f "$QBUILD/libqalculate.a" ] || { echo "ERROR: run build-lib.sh first" >&2; exit 1; }

cd "$QSUB"
mkdir -p "$QBUILD/obj" "$QWEB"

# qalc.cc and qalc_web.cc need the web driver define set.
flags=("${QALC_CXXFLAGS[@]}" "${QALC_DEFINES[@]}" -DQALC_WEB "${QALC_INCLUDES[@]}")

echo "CC src/qalc.cc"
em++ "${flags[@]}" -c src/qalc.cc -o "$QBUILD/obj/qalc.o"
echo "CC src/qalc_web.cc"
em++ "${flags[@]}" -c src/qalc_web.cc -o "$QBUILD/obj/qalc_web.o"

echo "linking web/qalc.mjs"
em++ -O2 -std=c++17 \
  "$QBUILD/obj/qalc.o" "$QBUILD/obj/qalc_web.o" \
  "$QBUILD/libqalculate.a" \
  "$QPREFIX/lib/libxml2.a" "$QPREFIX/lib/libmpfr.a" "$QPREFIX/lib/libgmp.a" \
  -sASYNCIFY \
  -sASYNCIFY_STACK_SIZE=16384 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 \
  -sSTACK_SIZE=5242880 \
  -sEXPORTED_FUNCTIONS='["_qalc_web_start","_qalc_web_eval","_qalc_web_preview","_qalc_web_set_userdir","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","IDBFS","stringToUTF8","lengthBytesUTF8","UTF8ToString"]' \
  -lidbfs.js \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=QalcModule \
  -sENVIRONMENT=web,node \
  -o "$QWEB/qalc.mjs"

echo "done:"
ls -la "$QWEB/qalc.mjs" "$QWEB/qalc.wasm"
