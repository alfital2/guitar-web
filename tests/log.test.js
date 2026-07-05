import { describe, it, expect } from 'vitest';
import { log, warn, getLogs, dumpLogs } from '../src/log.js';

describe('log ring buffer', () => {
  it('records entries with level + message and dumps them', () => {
    const before = getLogs().length;
    log('record start', { atSec: 1.5 });
    warn('empty capture');
    const after = getLogs();
    expect(after.length).toBe(before + 2);
    const dump = dumpLogs();
    expect(dump).toContain('record start');
    expect(dump).toContain('"atSec":1.5');
    expect(dump).toContain('empty capture');
    expect(dump).toMatch(/\[\d+ \+\d+ms (log|warn)\]/); // formatted line
  });
});
