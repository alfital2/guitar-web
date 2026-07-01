import { describe, it, expect } from 'vitest';
import { connectInputChannel } from '../src/audio/input-channel.js';

// Minimal spy standing in for a ChannelSplitterNode: records the output index
// passed to connect() (the shared FakeAudioContext ignores connect()'s 2nd arg).
function fakeSplitter() {
  return {
    connections: [],
    disconnectCount: 0,
    connect(dest, output) { this.connections.push({ dest, output }); },
    disconnect() { this.disconnectCount++; this.connections = []; },
  };
}

describe('connectInputChannel', () => {
  it('routes channel 0 (input 1) to the destination on output index 0', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 0, dest);
    expect(sp.connections).toEqual([{ dest, output: 0 }]);
  });

  it('routes channel 1 (input 2) to the destination on output index 1', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 1, dest);
    expect(sp.connections).toHaveLength(1);
    expect(sp.connections[0].dest).toBe(dest);
    expect(sp.connections[0].output).toBe(1);
  });

  it('disconnects prior routing before re-connecting (live re-route)', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 0, dest);   // initial: input 1
    connectInputChannel(sp, 1, dest);   // user switches to input 2
    expect(sp.disconnectCount).toBe(2);
    expect(sp.connections).toEqual([{ dest, output: 1 }]); // only latest routing remains
  });
});
