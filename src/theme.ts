// Tema de la interfaz: sigue al sistema por defecto, o fijo claro / oscuro /
// alto contraste. Con «Sistema», prefers-contrast: more activa el alto contraste
// (reglas al final de App.css).
export type Theme = 'system' | 'light' | 'dark' | 'contrast';
const KEY = 'chamva.theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'contrast' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme = getTheme()) {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* sin almacenamiento: vale solo para esta sesión */
  }
  applyTheme(t);
}
