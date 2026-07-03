// src/loudness.js — the loudness-normalization CONTROLLER.
// Extracted from main.js (refactor 2026-07-03) so the trickiest runtime logic
// in the app — debounce, signature skip, monotonic measure tokens, the session
// gain cache, silence-until-measured loads, bounded retries and the ramped
// apply — lives in one testable unit. src/normalize.js does the measuring;
// this decides WHEN to measure and HOW to land the result.
//
// Wiring (all getters, so power cycles that rebuild nodes never go stale):
//   getCtx()        → live AudioContext (or null when powered off)
//   getNormGain()   → the normalization GainNode (post-chain, pre-master)
//   getEngineChain()→ chain in engine form (chainState.toEngineChain(...))
//   getSignature()  → structure signature INCLUDING the reverb suffix
//   getReverb()     → the amp reverb params ({size, mix})
import { measureLoudnessGain } from './normalize.js';

export function createLoudnessController({ getCtx, getNormGain, getEngineChain, getSignature, getReverb }) {
  let timer = null;      // debounce handle
  let sig = null;        // last-measured signature
  let token = 0;         // monotonic measure id — only the NEWEST may land
  let retries = 0;       // bounded retries after an untrustworthy (null) measure
  let applyCount = 0;    // how many gains have landed (e2e bridge observes this)
  let mutePending = false; // preset/amp loads: HOLD SILENCE until the gain lands
  let prevGain = null;   // restore point if a muted measure ultimately fails
  const cache = new Map(); // param-inclusive chain key -> measured gain (session)

  // Apply with a short ramp (~50 ms) — a hard step is audible and lands in
  // recordings (the recorder taps the norm gain).
  function apply(g) {
    const normGain = getNormGain();
    if (!normGain) return;
    const ctx = getCtx();
    if (ctx && normGain.gain.setTargetAtTime) normGain.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    else normGain.gain.value = g;
    applyCount++;
  }

  // Param-inclusive cache key: two presets can share a structure signature yet
  // need very different gains, and repeat visits apply INSTANTLY from cache.
  function cacheKey() {
    const rv = getReverb() || {};
    return JSON.stringify(getEngineChain()) + `|rv${rv.size},${rv.mix}`;
  }

  // Re-measure when the chain STRUCTURE (or reverb) changed. Param-only edits
  // keep the signature, so knob turns never re-measure (a volume knob is
  // SUPPOSED to change loudness). Neural chains measure offline like everything
  // else (see normalize.js).
  function schedule() {
    const normGain = getNormGain();
    if (!normGain) return;
    const now = getSignature();
    if (now === sig) return;
    sig = now;
    clearTimeout(timer);
    const my = ++token; // any older in-flight measure is now void
    const key = cacheKey();
    const cached = cache.get(key);
    if (cached != null) { retries = 0; mutePending = false; prevGain = null; apply(cached); return; }
    // Loads hold SILENCE until the measured gain lands, so the user never hears
    // the brief unmatched level. Debounce skipped — measure immediately.
    const muted = mutePending;
    if (muted) {
      mutePending = false;
      if (prevGain == null) prevGain = normGain.gain.value;
      const ctx = getCtx();
      try { normGain.gain.cancelScheduledValues(ctx ? ctx.currentTime : 0); } catch {}
      normGain.gain.value = 0;
    }
    timer = setTimeout(async () => {
      try {
        const ctx = getCtx();
        const g = await measureLoudnessGain(getEngineChain(), { sampleRate: ctx ? ctx.sampleRate : 48000, reverb: getReverb() });
        if (token !== my || !getNormGain()) return; // stale, or powered off meanwhile
        if (g == null) {
          // Untrustworthy measure: retry (bounded); if we were holding silence
          // and ran out, restore the pre-load gain — wrong level beats dead rig.
          if (retries < 2) { retries++; sig = null; timer = setTimeout(schedule, 2500); }
          else if (prevGain != null) { apply(prevGain); prevGain = null; }
          return;
        }
        retries = 0;
        prevGain = null;
        cache.set(key, g);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        apply(g); // ramps up from silence on muted loads
      } catch (e) { console.warn('loudness normalize failed:', e); }
    }, muted ? 0 : 150);
  }

  return {
    schedule,
    // Preset/patch/model loads: next schedule() must re-measure even if the
    // signature matches, and hold silence until the gain lands.
    invalidate({ mute = false } = {}) { if (mute) mutePending = true; sig = null; },
    // Power-off: the norm gain node is about to be destroyed; a stale sig would
    // skip the re-measure after the next power-on (same chain), leaving the rig
    // un-normalized. Bump the token so in-flight measures can't land either.
    reset() { sig = null; token++; retries = 0; clearTimeout(timer); },
    applyCount: () => applyCount,
  };
}
