// src/calibration/ui.js
export function renderCalibrationControls(container, state, handlers) {
  container.innerHTML = '';
  const { profiles = [], activeName = null, strength = 0.65 } = state;

  const select = document.createElement('select');
  select.add(new Option('None', ''));
  for (const p of profiles) select.add(new Option(p.name, p.name));
  select.value = activeName ?? '';
  select.addEventListener('change', () => handlers.onSelect(select.value === '' ? null : select.value));

  const range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.01'; range.value = String(strength);
  range.addEventListener('input', () => handlers.onStrength(Number(range.value)));

  const btn = document.createElement('button');
  btn.textContent = 'Calibrate New Guitar';
  btn.addEventListener('click', () => handlers.onCalibrate());

  const sLabel = document.createElement('label'); sLabel.textContent = 'Guitar';
  const rLabel = document.createElement('label'); rLabel.textContent = 'Calibration strength';
  container.append(sLabel, select, rLabel, range, btn);
}
