# Real-Time Guitar — Latency-Test POC (Web)

**Date:** 2026-06-27
**Status:** Approved, building

## Goal

Answer one question before building anything else: **Is browser round-trip
latency low enough that I can comfortably play my guitar through a web app?**

This is a spike test. The amp simulation, pedals, and UI polish are all phase 2,
gated on this POC passing the subjective "can I play to this?" test.

## Hardware context

- Guitar → Focusrite Scarlett Solo Gen 3 (USB) → Mac
- Monitor via the Focusrite's **headphone out** (not Mac speakers — avoids feedback,
  keeps the loop tight)
- **Direct Monitor switch must be OFF** on the interface, or you hear the dry guitar
  at zero latency layered over the processed signal ("why are there two guitars").

## Approach (chosen)

**Approach 1: Subjective pass-through + browser-reported latency numbers.**

Structured so the loopback-measurement mode (Approach 2) can drop in later.

### Signal path
`getUserMedia(Focusrite)` → `MediaStreamAudioSourceNode` → `GainNode`
→ `AudioContext.destination` (routed to Focusrite headphones via `setSinkId`)

An `AnalyserNode` tap drives an input-level meter so the user can confirm signal
is arriving.

### Critical settings (the make-or-break details)
- `getUserMedia` audio constraints: `echoCancellation: false`,
  `noiseSuppression: false`, `autoGainControl: false`. These voice-call features
  add latency and mangle guitar tone. Non-negotiable.
- `new AudioContext({ latencyHint: 'interactive' })` to minimize buffering.
- Select Focusrite as input (`deviceId` constraint) and output (`AudioContext.setSinkId`).

### What we display
- Sample rate
- `baseLatency` (ms) — graph processing latency
- `outputLatency` (ms) — context-to-speaker latency
- Total reported round-trip estimate (ms), with a plain-language verdict band:
  <10 invisible / 10–20 good / 20–30 acceptable / >30 laggy
- Input level meter

### Out of scope (phase 2+)
- Amp simulation (WaveShaper drive + Biquad tone stack + Convolver cab IR)
- Pedals
- True loopback measurement (Approach 2)
- Presets, recording, backing tracks

## Constraints / notes

- `getUserMedia` needs a **secure context** → serve over `http://localhost`
  (a `file://` page won't get mic access). Use `python3 -m http.server`.
- **Chrome or Edge recommended** — best Web Audio latency, `setSinkId` support.
  Safari is more limited.

## Success criteria

User plugs in, starts the app, plays, and can decide: "acceptable" or "not."
A latency number on screen supports that judgment.
