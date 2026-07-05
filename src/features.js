// src/features.js — app-wide capability registry. Everything ships free
// today; this is the single switch point if features become plan-gated
// later. Entry points ask can('cap') — absent caps are ON (fail-open), so
// adding a cap name never dark-launches a lock. setCapability exists for
// tests/e2e and, later, for a license loader.

export const CAPS = ['tab.edit', 'tab.practice', 'tab.techniques', 'tab.file', 'tab.ascii'];

const registry = {};

export function can(cap) { return registry[cap] !== false; }

export function setCapability(cap, on) { registry[cap] = !!on; }
