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

export function renderChain(container, modules, onParamChange) {
  container.innerHTML = '';
  modules.forEach((m, index) => {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = m.schema.label;
    group.appendChild(legend);
    for (const p of m.schema.params) {
      const row = document.createElement('label');
      row.className = 'knob';
      const name = document.createElement('span');
      name.textContent = p.label;
      const val = document.createElement('span');
      val.className = 'val';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(p.min);
      slider.max = String(p.max);
      slider.step = String(p.step);
      slider.value = String(m.params[p.key] ?? p.default);
      val.textContent = slider.value + (p.unit ? ' ' + p.unit : '');
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        val.textContent = slider.value + (p.unit ? ' ' + p.unit : '');
        onParamChange(index, p.key, v);
      });
      row.append(name, slider, val);
      group.appendChild(row);
    }
    container.appendChild(group);
  });
}
