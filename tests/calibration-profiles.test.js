// tests/calibration-profiles.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { listProfiles, saveProfile, getActive, setActive, setStrength, deleteProfile } from '../src/calibration/profiles.js';

beforeEach(() => localStorage.clear());

describe('profiles', () => {
  it('saves and lists; save sets active', () => {
    saveProfile('Strat', [0, 1, 2], 0.65);
    expect(listProfiles().map(p => p.name)).toEqual(['Strat']);
    expect(getActive().name).toBe('Strat');
    expect(getActive().fingerprint).toEqual([0, 1, 2]);
  });
  it('upserts by name', () => {
    saveProfile('Strat', [1], 0.5);
    saveProfile('Strat', [2], 0.7);
    expect(listProfiles()).toHaveLength(1);
    expect(getActive().fingerprint).toEqual([2]);
    expect(getActive().strength).toBe(0.7);
  });
  it('setActive / setStrength', () => {
    saveProfile('A', [1], 0.5); saveProfile('B', [2], 0.5);
    setActive('A'); expect(getActive().name).toBe('A');
    setStrength('A', 0.9); expect(getActive().strength).toBe(0.9);
  });
  it('delete removes and clears active', () => {
    saveProfile('A', [1], 0.5);
    deleteProfile('A');
    expect(listProfiles()).toEqual([]);
    expect(getActive()).toBeNull();
  });
  it('corrupt storage -> empty, no throw', () => {
    localStorage.setItem('guitar-calibration-profiles', 'not json');
    expect(listProfiles()).toEqual([]);
    expect(getActive()).toBeNull();
  });
});
