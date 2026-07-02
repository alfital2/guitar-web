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
  for (const cat of categories) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'pb-cat';
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
