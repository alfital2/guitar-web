import { describe, it, expect } from 'vitest';
import { encodeCode, decodeCode, mungeOpusForMusic } from '../src/jam.js';

describe('jam code encoding', () => {
  it('round-trips an object through compress + base64url', async () => {
    const obj = { v: 1, t: 'o', sdp: 'v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\n' + 'a=candidate:'.repeat(40) };
    const code = await encodeCode(obj);
    expect(code.startsWith('J1.') || code.startsWith('J0.')).toBe(true);
    expect(code).not.toMatch(/[+/=]/); // chat-paste safe (base64url, no padding)
    const back = await decodeCode(code);
    expect(back).toEqual(obj);
  });
  it('compressed codes are much smaller than the raw SDP', async () => {
    const sdp = ('a=candidate:1 1 udp 2122260223 192.168.1.10 56789 typ host generation 0\r\n').repeat(30);
    const code = await encodeCode({ v: 1, t: 'o', sdp });
    if (code.startsWith('J1.')) expect(code.length).toBeLessThan(sdp.length / 2);
  });
  it('rejects garbage', async () => {
    await expect(decodeCode('not a code')).rejects.toThrow();
  });
});

describe('mungeOpusForMusic', () => {
  const base = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';
  it('adds a music-profile fmtp when none exists', () => {
    const out = mungeOpusForMusic(base);
    expect(out).toMatch(/a=fmtp:111 .*stereo=1/);
    expect(out).toMatch(/maxaveragebitrate=192000/);
    expect(out).toMatch(/useinbandfec=1/);
    expect(out).toMatch(/a=ptime:10/);
  });
  it('merges with an existing fmtp, keeping unrelated params and overriding ours', () => {
    const sdp = base + 'a=fmtp:111 minptime=20;useinbandfec=0;usedtx=1\r\n';
    const out = mungeOpusForMusic(sdp);
    expect(out).toMatch(/usedtx=1/);                 // unrelated param kept
    expect(out).toMatch(/useinbandfec=1/);           // ours overrides
    expect(out).toMatch(/minptime=10/);
    expect(out).not.toMatch(/useinbandfec=0/);
    expect(out).not.toMatch(/minptime=20/);
  });
  it('leaves SDP without opus untouched', () => {
    const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
    expect(mungeOpusForMusic(sdp)).toBe(sdp);
  });
});
