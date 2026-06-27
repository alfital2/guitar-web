export function renderPresetPicker(container, presets, onSelect) {
  container.innerHTML = '';
  const select = document.createElement('select');
  presets.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = p.name;
    select.appendChild(o);
  });
  select.addEventListener('change', () => onSelect(presets[select.selectedIndex]));
  container.appendChild(select);
}
