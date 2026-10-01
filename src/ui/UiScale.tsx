import { useEffect, useState, useSyncExternalStore } from 'react';
import { t, useLang } from '../i18n';
import { getShortcut, useShortcuts } from '../editor/core/shortcuts';
import './a11y.css';

// ---- Tamaño de la interfaz (85–150 %) ----
// Se aplica con `zoom` solo a las barras y paneles (ver a11y.css), nunca al
// lienzo: así Konva conserva sus coordenadas.
const SCALE_KEY = 'chamva.uiScale';
export const SCALE_MIN = 85;
export const SCALE_MAX = 150;

export const clampScale = (n: number) =>
  Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(Number.isFinite(n) ? n : 100)));

export function getUiScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return v ? clampScale(v) : 100;
  } catch {
    return 100;
  }
}

export function applyUiScale(pct: number = getUiScale()) {
  document.documentElement.style.setProperty('--ui-scale', String(clampScale(pct) / 100));
}

export function setUiScale(pct: number) {
  const v = clampScale(pct);
  try {
    if (v === 100) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, String(v));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  applyUiScale(v);
}

// ---- Modo concentración: solo el lienzo. Se recuerda durante la sesión. ----
let focus = false;
const fl = new Set<() => void>();
export const getFocusMode = () => focus;
export function setFocusMode(v: boolean) {
  focus = v;
  document.documentElement.toggleAttribute('data-focus', v);
  fl.forEach((f) => f());
}
export const toggleFocusMode = () => setFocusMode(!focus);
export function useFocusMode(): boolean {
  return useSyncExternalStore(
    (fn) => {
      fl.add(fn);
      return () => fl.delete(fn);
    },
    () => focus,
  );
}

/** Montar una vez en App: aplica el tamaño guardado y muestra el aviso del modo concentración. */
export function UiPrefs() {
  useLang();
  const on = useFocusMode();
  const keys = useShortcuts();
  useEffect(() => {
    applyUiScale();
  }, []);
  if (!on) return null;
  const k = keys.focus || getShortcut('focus');
  return (
    <button className="focus-pill" onClick={() => setFocusMode(false)}>
      {t('Modo concentración')} · {t('Salir')} (Esc{k ? ` / ${k}` : ''})
    </button>
  );
}

/** Control de Ajustes: deslizador con vista previa; se aplica al soltar. */
export function UiScaleSetting() {
  useLang();
  const [saved, setSaved] = useState(getUiScale);
  const [draft, setDraft] = useState(saved);
  const commit = (v: number) => {
    setUiScale(v);
    setSaved(clampScale(v));
  };
  return (
    <div className="scale-set">
      <div className="settings-row">
        <span>{t('Tamaño de la interfaz')}</span>
        <span className="settings-val">{draft} %</span>
      </div>
      <input
        type="range"
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={5}
        value={draft}
        aria-label={t('Tamaño de la interfaz')}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => commit(draft)}
        onBlur={() => draft !== saved && commit(draft)}
      />
      <div className="scale-preview" aria-hidden="true">
        <div style={{ zoom: draft / 100 / (saved / 100) }}>
          <button type="button" tabIndex={-1}>
            {t('Vista previa')}
          </button>
          <span>Aa 123</span>
        </div>
      </div>
      {saved !== 100 && (
        <button
          className="link-btn dim"
          onClick={() => {
            setDraft(100);
            commit(100);
          }}
        >
          {t('Restablecer')} 100 %
        </button>
      )}
    </div>
  );
}
