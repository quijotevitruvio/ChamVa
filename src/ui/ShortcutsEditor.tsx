import { useEffect, useState } from 'react';
import { t, useLang } from '../i18n';
import {
  ACTIONS,
  FIXED_KEYS,
  eventToCombo,
  findConflicts,
  isCustomized,
  resetAllShortcuts,
  resetShortcut,
  setCapturing,
  setShortcut,
  useShortcuts,
  validateCombo,
} from '../editor/core/shortcuts';
import './a11y.css';

// Editor de atajos (Ajustes → Atajos): pulsa «Cambiar» y luego la combinación.
export function ShortcutsEditor() {
  useLang();
  const keys = useShortcuts();
  const [capId, setCapId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!capId) return;
    setCapturing(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapId(null);
        setMsg('');
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // solo un modificador: esperar a la tecla
      const bad = validateCombo(combo);
      if (bad) {
        setMsg(t(bad));
        return;
      }
      const clash = findConflicts(capId, combo);
      if (clash.length) {
        const names = clash.map((id) => t(ACTIONS.find((a) => a.id === id)!.label)).join(', ');
        setMsg(`${combo}: ${t('ya lo usa')} «${names}»`);
        return;
      }
      setShortcut(capId, combo);
      setCapId(null);
      setMsg('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setCapturing(false);
    };
  }, [capId]);

  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <div className="sc-editor">
      {groups.map((g) => (
        <div key={g}>
          <span className="rail-sub">{t(g)}</span>
          {ACTIONS.filter((a) => a.group === g).map((a) => (
            <div className="sc-row" key={a.id}>
              <span className="sc-label">{t(a.label)}</span>
              <kbd className={capId === a.id ? 'listening' : ''}>
                {capId === a.id ? t('Pulsa la combinación…') : keys[a.id] || t('Sin atajo')}
              </kbd>
              <button
                className="link-btn"
                onClick={() => {
                  setMsg('');
                  setCapId(capId === a.id ? null : a.id);
                }}
              >
                {capId === a.id ? t('Cancelar') : t('Cambiar')}
              </button>
              {isCustomized(a.id) && (
                <button className="link-btn dim" onClick={() => resetShortcut(a.id)} aria-label={t('Restablecer')} title={t('Restablecer')}>
                  ↺
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <div>
        <span className="rail-sub">{t('Teclas fijas')}</span>
        <ul className="shortcut-list">
          {FIXED_KEYS.map(([k, d]) => (
            <li key={k}>
              <kbd>{k}</kbd>
              <span>{t(d)}</span>
            </li>
          ))}
        </ul>
      </div>
      {msg && (
        <p className="license-msg" role="alert">
          {msg}
        </p>
      )}
      <button className="link-btn dim" onClick={() => { resetAllShortcuts(); setMsg(''); setCapId(null); }}>
        {t('Restablecer todos los atajos')}
      </button>
    </div>
  );
}
