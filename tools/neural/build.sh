#!/usr/bin/env bash
# Build the plain-wasm NAM engine (assets/neural/nam.{js,wasm}) from tools/neural/nam.cpp.
# Same NAM core + core flags as the POC bench (-Os -flto -msimd128 -DNAM_USE_INLINE_GEMM
# -DNAM_SAMPLE_FLOAT), MINUS the audio-worklet/pthread machinery -> single-thread + SIMD,
# runnable in a normal AudioWorkletGlobalScope with no SharedArrayBuffer / COOP-COEP.
# Requires: emcc on PATH (or set EMSDK_DIR to an emsdk checkout), and the NAM core with
# the Eigen submodule. To stay network-free, point NAM_SRC at an existing checkout
# (dirs: NAM/, Dependencies/eigen, Dependencies/nlohmann); otherwise it is cloned.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
OUT="${ROOT}/assets/neural"
WORK="${TMPDIR:-/tmp}/nam-app-build"

# 1. emscripten
if ! command -v emcc >/dev/null 2>&1; then
  if [ -n "${EMSDK_DIR:-}" ] && [ -f "${EMSDK_DIR}/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "${EMSDK_DIR}/emsdk_env.sh"
  else
    echo "emcc not found. Install emsdk and put emcc on PATH, or set EMSDK_DIR." >&2
    exit 1
  fi
fi

# 2. NAM core source + Eigen (the exact DSP the POC benched).
#    Prefer an existing checkout via NAM_SRC (network-free); else clone into WORK.
if [ -n "${NAM_SRC:-}" ] && [ -d "${NAM_SRC}/NAM" ]; then
  SRC="${NAM_SRC}"
else
  mkdir -p "${WORK}"
  if [ ! -d "${WORK}/nam-wasm/.git" ]; then
    git clone --depth 1 https://github.com/tone-3000/neural-amp-modeler-wasm.git "${WORK}/nam-wasm"
  fi
  SRC="${WORK}/nam-wasm"
  ( cd "${SRC}" && git submodule update --init Dependencies/eigen )
fi
cd "${SRC}"

if [ ! -d "Dependencies/eigen/Eigen" ]; then
  echo "Eigen submodule missing under ${SRC}/Dependencies/eigen. Fetch it first." >&2
  exit 1
fi

# 3. compile the plain-wasm C API (contract flags; NO -sAUDIO_WORKLET, NO -pthread)
#    -fwasm-exceptions enables REAL wasm exception handling (compile + link, since this
#    is a single emcc invocation). Without it, C++ exceptions are compiled out entirely
#    and nam_load's try/catch is dead code: nlohmann::json::parse on malformed JSON (or
#    nam::get_dsp on an unsupported model) calls abort() and kills the whole wasm
#    instance instead of returning 0 -> nam_load MUST be able to actually catch.
mkdir -p "${OUT}"
emcc "${HERE}/nam.cpp" $(find NAM -name '*.cpp') \
  -std=c++17 -Os -flto -msimd128 -fwasm-exceptions \
  -DNAM_USE_INLINE_GEMM -DNAM_SAMPLE_FLOAT -DEIGEN_STACK_ALLOCATION_LIMIT=0 \
  -I. -IDependencies/eigen -IDependencies/nlohmann \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH \
  -sINITIAL_MEMORY=64MB -sSTACK_SIZE=32MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_nam_load,_nam_reset,_nam_process,_nam_expected_sr \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF32 \
  -o "${OUT}/nam.js"

echo "Built ${OUT}/nam.js (+ nam.wasm)"
