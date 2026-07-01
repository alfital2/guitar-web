// src/audio/input-channel.js
// Route one output of a ChannelSplitterNode to a destination node.
//   splitter output `channel` -> dest
//   channel 0 = hardware input 1 (left), channel 1 = hardware input 2 (right)
// The splitter's outputs are disconnected first so setInputChannel() can
// re-route a live graph without stacking connections.
export function connectInputChannel(splitter, channel, dest) {
  splitter.disconnect();
  splitter.connect(dest, channel);
}
