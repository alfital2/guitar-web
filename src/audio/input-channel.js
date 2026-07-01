// src/audio/input-channel.js
// Route one output of a ChannelSplitterNode to a destination node.
//   splitter output `channel` -> dest
//   channel 0 = hardware input 1 (left), channel 1 = hardware input 2 (right)
// The splitter's outputs are disconnected first so setInputChannel() can
// re-route a live graph without stacking connections. NOTE: that disconnect()
// clears ALL of the splitter's outputs, so this assumes a single consumer —
// callers wiring more than one destination off the same splitter must fan the
// extra ones out manually after calling this once (see routeInputChannel in
// src/main.js), not by calling this a second time.
export function connectInputChannel(splitter, channel, dest) {
  // Clamp to a valid splitter output index (0 or 1) so a stray/out-of-range
  // value can't reach splitter.connect() and throw IndexSizeError.
  const ch = Math.min(1, Math.max(0, channel | 0));
  splitter.disconnect();
  splitter.connect(dest, ch);
}
