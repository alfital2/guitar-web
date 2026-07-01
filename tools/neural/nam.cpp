// tools/neural/nam.cpp
// Plain-wasm C API around the NAM WaveNet core. Same DSP + build flags as the
// POC bench (poc/nam-web/bench/src/bench.cpp), but NO -sAUDIO_WORKLET / -pthread:
// single-thread + SIMD, so it runs inside a normal AudioWorkletGlobalScope on the
// app's own AudioContext (no SharedArrayBuffer, no COOP/COEP). Contract API:
//   nam_load / nam_reset / nam_process / nam_expected_sr.
#include <emscripten/emscripten.h>
#include <cmath>
#include <cstring>
#include <memory>
#include "json.hpp"
#include <NAM/dsp.h>
#include <NAM/get_dsp.h>
#include <NAM/activations.h>

static std::unique_ptr<nam::DSP> gModel;

extern "C" {

// Build the model from raw .nam JSON text. Returns 1 on success, 0 on failure.
EMSCRIPTEN_KEEPALIVE
int nam_load(const char* jsonStr) {
  try {
    nam::activations::Activation::enable_fast_tanh(); // matches the shipping engine
    auto j = nlohmann::json::parse(jsonStr);
    gModel = nam::get_dsp(j);
  } catch (...) {
    gModel = nullptr;
    return 0;
  }
  return gModel ? 1 : 0;
}

// Reset + prewarm for the AudioContext's real sample rate (like a session start).
EMSCRIPTEN_KEEPALIVE
void nam_reset(double sampleRate, int maxBlock) {
  if (!gModel) return;
  gModel->Reset(sampleRate, maxBlock);
  gModel->prewarm();
}

// Process n (<= maxBlock) samples: inPtr/outPtr are float* into the wasm heap.
// No model loaded -> dry copy (worklet passthrough), never NaN/garbage.
EMSCRIPTEN_KEEPALIVE
void nam_process(float* inPtr, float* outPtr, int n) {
  if (!gModel) {
    if (inPtr != outPtr) std::memcpy(outPtr, inPtr, (size_t)n * sizeof(float));
    return;
  }
  NAM_SAMPLE* ip = inPtr;   // NAM_SAMPLE == float under -DNAM_SAMPLE_FLOAT
  NAM_SAMPLE* op = outPtr;
  gModel->process(&ip, &op, n); // same call shape as bench.cpp
}

EMSCRIPTEN_KEEPALIVE
double nam_expected_sr(void) {
  return gModel ? gModel->GetExpectedSampleRate() : -1.0;
}

} // extern "C"
