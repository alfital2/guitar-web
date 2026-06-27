# Guitar Latency Test (POC)

A one-page web app to measure whether browser round-trip latency is low enough
to play guitar through. This is a spike test — if it passes, phase 2 is the amp sim.

See the design doc: `docs/superpowers/specs/2026-06-27-latency-test-poc-design.md`

## How to run

`getUserMedia` (mic access) only works in a **secure context**, so you can't just
open `index.html` from disk — serve it over `localhost`:

```sh
cd /Users/tal/Documents/guitar_web
python3 -m http.server 8000
```

Then open **http://localhost:8000** in **Chrome or Edge** (best Web Audio latency
and output-device support; Safari is more limited).

## Using it

1. Plug guitar into the Focusrite, headphones into the Focusrite's headphone out.
2. Turn the Focusrite's **Direct Monitor switch OFF** (so you hear only the
   processed signal from the browser, not the dry guitar on top).
3. Pick the Focusrite as both **Input** and **Output**, press **Start**, grant mic
   permission, and play.
4. Watch the input meter to confirm signal; read the latency estimate; **judge by
   ear** whether it's playable.

## What's next (gated on this feeling good)

- True loopback latency measurement (hard ms number incl. the interface)
- Amp sim: `WaveShaperNode` drive → `BiquadFilterNode` tone stack → `ConvolverNode` cab IR
- Pedalboard
