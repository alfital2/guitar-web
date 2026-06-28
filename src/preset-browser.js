// src/preset-browser.js
// Right-hand patch browser: GarageBand presets grouped by category. Clicking a
// row loads that patch's chain via onSelect.
export function renderPresetBrowser(container, categories, onSelect, activeName) {
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'pb-head';
  head.textContent = 'Patches';
  container.appendChild(head);

  for (const cat of categories) {
    const group = document.createElement('div');
    group.className = 'pb-group';
    const label = document.createElement('div');
    label.className = 'pb-group-label';
    label.textContent = cat.label;
    const list = document.createElement('div');
    list.className = 'pb-list';

    for (const preset of cat.presets) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pb-row' + (preset.name === activeName ? ' active' : '');
      row.dataset.preset = preset.name;
      const name = document.createElement('span');
      name.className = 'pb-name';
      name.textContent = preset.name;
      const desc = document.createElement('span');
      desc.className = 'pb-desc';
      desc.textContent = preset.song || '';
      row.append(name, desc);
      row.addEventListener('click', () => onSelect(preset));
      list.appendChild(row);
    }
    group.append(label, list);
    container.appendChild(group);
  }
}
