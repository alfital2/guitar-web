// src/preset-browser.js
// GarageBand-style patch library: a category column (Clean / Crunch) on the
// left, the selected category's patch names on the right, plus a search box.
// Clicking a patch loads it via onSelect.
let viewCat = null;   // category id currently shown in the patch column
let search = '';      // current search term

export function renderPresetBrowser(container, categories, onSelect, activeName, onCollapse) {
  // Default the viewed category to the active patch's category (so loading a
  // patch reveals its list), else the first category.
  if (viewCat == null || !categories.some((c) => c.id === viewCat)) {
    const activeCat = categories.find((c) => c.presets.some((p) => p.name === activeName));
    viewCat = activeCat ? activeCat.id : categories[0].id;
  }
  container.innerHTML = '';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'pb-search';
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = 'Search Sounds'; input.value = search;
  searchWrap.appendChild(input);
  if (onCollapse) {
    // Unified `.collapse-chev` style + aria-expanded pattern (same as the amp
    // and pedalboard chevrons); the sidebar is expanded whenever it's visible.
    const collapse = document.createElement('button');
    collapse.type = 'button'; collapse.className = 'pb-collapse collapse-chev';
    collapse.title = 'Hide patches'; collapse.setAttribute('aria-label', 'Hide patches');
    collapse.setAttribute('aria-expanded', 'true');
    collapse.textContent = '⟨';
    collapse.addEventListener('click', onCollapse);
    searchWrap.appendChild(collapse);
  }

  const split = document.createElement('div'); split.className = 'pb-split';
  const catsCol = document.createElement('div'); catsCol.className = 'pb-cats';
  const patchesCol = document.createElement('div'); patchesCol.className = 'pb-patches';

  const catRows = new Map();
  // Per-category identity glyph + tint (breaks the uniform text-wall look).
  const CAT_GLYPHS = {
    clean:    { d: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 2.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z', c: '#7fd4a8' },  // chime ring
    crunch:   { d: 'M9.5 1 3 9h4l-1.5 6L13 6.5H8.8L9.5 1z', c: '#f0a35e' },                                              // bolt
    artists:  { d: 'M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.2l-3.8 2 .7-4.2-3.1-3 4.3-.6L8 1.5z', c: '#e8c56a' },          // star
    showcase: { d: 'M8 1v4M8 11v4M1 8h4M11 8h4M3.5 3.5l2.5 2.5M10 10l2.5 2.5M12.5 3.5 10 6M6 10l-2.5 2.5', c: '#b48ae0', stroke: true }, // spark
    pro:      { d: 'M3 5h10v6H3zM5 3v2M8 3v2M11 3v2M5 11v2M8 11v2M11 11v2', c: '#6aa8e8', stroke: true },                 // chip
  };
  for (const cat of categories) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'pb-cat';
    const g = CAT_GLYPHS[cat.id];
    if (g) {
      const icon = document.createElement('span'); icon.className = 'pb-cat-glyph'; icon.style.color = g.c;
      icon.innerHTML = g.stroke
        ? `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${g.d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${g.d}" fill="currentColor"/></svg>`;
      row.appendChild(icon);
    }
    const label = document.createElement('span'); label.className = 'pb-cat-label'; label.textContent = cat.label;
    const chev = document.createElement('span'); chev.className = 'pb-chev'; chev.textContent = '›';
    row.append(label, chev);
    row.addEventListener('click', () => { viewCat = cat.id; paintCats(); paintPatches(); });
    catRows.set(cat.id, row);
    catsCol.appendChild(row);
  }

  function paintCats() {
    for (const [id, row] of catRows) row.classList.toggle('active', id === viewCat);
  }
  function paintPatches() {
    patchesCol.innerHTML = '';
    const cat = categories.find((c) => c.id === viewCat);
    const term = search.trim().toLowerCase();
    const items = cat.presets.filter((p) => !term
      || p.name.toLowerCase().includes(term) || (p.song || '').toLowerCase().includes(term));
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'pb-empty'; empty.textContent = 'No matches';
      patchesCol.appendChild(empty); return;
    }
    for (const preset of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pb-patch' + (preset.name === activeName ? ' active' : '');
      row.textContent = preset.name; row.title = preset.song || '';
      row.addEventListener('click', () => onSelect(preset));
      patchesCol.appendChild(row);
    }
  }
  input.addEventListener('input', () => { search = input.value; paintPatches(); });

  split.append(catsCol, patchesCol);
  container.append(searchWrap, split);
  paintCats();
  paintPatches();
}
