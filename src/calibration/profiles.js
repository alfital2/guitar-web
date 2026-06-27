// src/calibration/profiles.js
const KEY = 'guitar-calibration-profiles';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { profiles: [], activeName: null };
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.profiles)) return { profiles: [], activeName: null };
    return { profiles: d.profiles, activeName: d.activeName ?? null };
  } catch {
    return { profiles: [], activeName: null };
  }
}
function write(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

export function listProfiles() { return read().profiles; }

export function saveProfile(name, fingerprint, strength) {
  const d = read();
  const prof = { name, fingerprint, strength };
  const i = d.profiles.findIndex((p) => p.name === name);
  if (i >= 0) d.profiles[i] = prof; else d.profiles.push(prof);
  d.activeName = name;
  write(d);
  return prof;
}

export function getActive() {
  const d = read();
  return d.profiles.find((p) => p.name === d.activeName) || null;
}

export function setActive(name) { const d = read(); d.activeName = name; write(d); }

export function setStrength(name, s) {
  const d = read();
  const p = d.profiles.find((x) => x.name === name);
  if (p) { p.strength = s; write(d); }
}

export function deleteProfile(name) {
  const d = read();
  d.profiles = d.profiles.filter((p) => p.name !== name);
  if (d.activeName === name) d.activeName = null;
  write(d);
}
