// tests/profile-card-ui.test.js
import { describe, it, expect } from 'vitest';
import { renderProfileCard } from '../src/profile-card/ui.js';

const stats = { body: 60, warmth: 55, mids: 50, presence: 45, brightness: 70, air: 80 };

describe('renderProfileCard', () => {
  it('renders name, archetype, an svg, and 6 stat rows', () => {
    const el = document.createElement('div');
    renderProfileCard(el, { name: 'Strat', stats, archetype: 'Bright & Glassy' });
    expect(el.querySelector('.tc-name').textContent).toBe('Strat');
    expect(el.querySelector('.tc-archetype').textContent).toBe('Bright & Glassy');
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.querySelectorAll('.tc-stat')).toHaveLength(6);
  });
  it('clears previous content on re-render', () => {
    const el = document.createElement('div');
    renderProfileCard(el, { name: 'A', stats, archetype: 'Balanced' });
    renderProfileCard(el, { name: 'B', stats, archetype: 'Balanced' });
    expect(el.querySelectorAll('.tone-card')).toHaveLength(1);
  });
});
