// src/theme.js
export function resolveTheme(systemPrefersDark, override) {
  if (override === 'light' || override === 'dark') return override;
  return systemPrefersDark ? 'dark' : 'light';
}
