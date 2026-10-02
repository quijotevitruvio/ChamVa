import { useEffect, useId, useState } from 'react';
import { DPI_CHOICES, PAPER_SIZES, UNITS, isValidDpi, MAX_DPI, MIN_DPI, type Unit } from '../editor/core/units';
import { PURPOSES } from '../editor/core/purposes';
import {
  applyPaper, applyPixels, changeDpi, changeUnit, commitField, fieldText, sanitize, summary,
  swapOrientation, type Axis, type SizeValue,
} from './sizeFieldsLogic';
import { t } from '../i18n';
import './sizefields.css';

interface Props {
  // width/height en PÍXELES (la verdad del diseño); unit y dpi solo cambian cómo se muestran.
  value: SizeValue;
  onChange: (v: SizeValue) => void;
  showPresets?: boolean;
  compact?: boolean;
}

const CUSTOM_DPI = 'custom';

// Ancho × alto con unidad (px, mm, cm, in, pt, pc), dpi, candado de proporción y tamaños de papel.
export function SizeFields({ value, onChange, showPresets = true, compact = false }: Props) {
  const id = useId();
  const v = sanitize(value);
  const [lock, setLock] = useState(false);
  const [dw, setDw] = useState(fieldText(v, 'width'));
  const [dh, setDh] = useState(fieldText(v, 'height'));
  const [customDpi, setCustomDpi] = useState(!DPI_CHOICES.includes(v.dpi));
  const [dpiText, setDpiText] = useState(String(v.dpi));

  // Si el valor cambia desde fuera (papel, unidad, dpi), los borradores se reescriben.
  const sig = `${v.width}|${v.height}|${v.unit}|${v.dpi}`;
  useEffect(() => {
    setDw(fieldText(v, 'width'));
    setDh(fieldText(v, 'height'));
    setDpiText(String(v.dpi));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const commit = (axis: Axis, text: string) => {
    const next = commitField(v, axis, text, lock);
    if (next) onChange(next);
    else {
      // Entrada inválida: se restaura lo anterior.
      setDw(fieldText(v, 'width'));
      setDh(fieldText(v, 'height'));
    }
  };
  const keyCommit = (axis: Axis) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(axis, axis === 'width' ? dw : dh);
    }
  };

  const commitDpi = (text: string) => {
    const n = Number(text.replace(',', '.'));
    if (isValidDpi(n)) onChange(changeDpi(v, Math.round(n)));
    else setDpiText(String(v.dpi));
  };

  const onPreset = (val: string) => {
    if (val.startsWith('paper:')) {
      const p = PAPER_SIZES.find((x) => x.id === val.slice(6));
      if (p) onChange(applyPaper(v, p));
    } else if (val.startsWith('purpose:')) {
      const p = PURPOSES.find((x) => x.id === val.slice(8));
      if (p) {
        // Los de impresión están pensados a 300 ppp; los de pantalla se quedan en px.
        if (p.group === 'Impresión') onChange(applyPixels(v, p.width, p.height, 300, v.unit === 'px' ? 'cm' : v.unit));
        else onChange(applyPixels(v, p.width, p.height, undefined, 'px'));
      }
    }
  };

  const dpiSelect = customDpi ? CUSTOM_DPI : String(v.dpi);
  const landscape = v.width > v.height;

  return (
    <div className={'size-fields' + (compact ? ' compact' : '')}>
      {showPresets && (
        <div className="sf-row">
          <select
            className="sf-select sf-grow"
            aria-label={t('Tamaños de papel')}
            value=""
            onChange={(e) => onPreset(e.target.value)}
          >
            <option value="">{t('Tamaños de papel…')}</option>
            <optgroup label={t('Papel')}>
              {PAPER_SIZES.filter((p) => p.group === 'Papel').map((p) => (
                <option key={p.id} value={'paper:' + p.id}>{p.label}</option>
              ))}
            </optgroup>
            <optgroup label={t('Impresión')}>
              {PAPER_SIZES.filter((p) => p.group === 'Impresión').map((p) => (
                <option key={p.id} value={'paper:' + p.id}>{p.label}</option>
              ))}
              {PURPOSES.filter((p) => p.group === 'Impresión').map((p) => (
                <option key={p.id} value={'purpose:' + p.id}>{p.label} ({p.hint})</option>
              ))}
            </optgroup>
            <optgroup label={t('Pantalla y redes')}>
              {PURPOSES.filter((p) => p.group !== 'Impresión').map((p) => (
                <option key={p.id} value={'purpose:' + p.id}>{p.label} ({p.hint})</option>
              ))}
            </optgroup>
          </select>
          <button
            type="button"
            className="sf-btn"
            title={landscape ? t('Cambiar a vertical') : t('Cambiar a horizontal')}
            aria-label={landscape ? t('Cambiar a vertical') : t('Cambiar a horizontal')}
            onClick={() => onChange(swapOrientation(v))}
          >
            <span className={'sf-orient' + (landscape ? ' land' : '')} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="sf-row">
        <label className="sf-field" htmlFor={id + 'w'}>
          <span>{t('Ancho')}</span>
          <input
            id={id + 'w'}
            type="text"
            inputMode="decimal"
            value={dw}
            onChange={(e) => setDw(e.target.value)}
            onBlur={() => commit('width', dw)}
            onKeyDown={keyCommit('width')}
          />
        </label>
        <button
          type="button"
          className={'sf-btn sf-lock' + (lock ? ' on' : '')}
          aria-pressed={lock}
          title={t('Mantener la proporción')}
          aria-label={t('Mantener la proporción')}
          onClick={() => setLock((l) => !l)}
        >
          {lock ? '🔒' : '🔓'}
        </button>
        <label className="sf-field" htmlFor={id + 'h'}>
          <span>{t('Alto')}</span>
          <input
            id={id + 'h'}
            type="text"
            inputMode="decimal"
            value={dh}
            onChange={(e) => setDh(e.target.value)}
            onBlur={() => commit('height', dh)}
            onKeyDown={keyCommit('height')}
          />
        </label>
        <label className="sf-field sf-unit" htmlFor={id + 'u'}>
          <span>{t('Unidad')}</span>
          <select id={id + 'u'} className="sf-select" value={v.unit} onChange={(e) => onChange(changeUnit(v, e.target.value as Unit))}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="sf-row">
        <label className="sf-field" htmlFor={id + 'd'}>
          <span>{t('Resolución')}</span>
          <select
            id={id + 'd'}
            className="sf-select"
            value={dpiSelect}
            onChange={(e) => {
              if (e.target.value === CUSTOM_DPI) setCustomDpi(true);
              else {
                setCustomDpi(false);
                onChange(changeDpi(v, Number(e.target.value)));
              }
            }}
          >
            {DPI_CHOICES.map((d) => (
              <option key={d} value={d}>{d} dpi</option>
            ))}
            <option value={CUSTOM_DPI}>{t('Personalizado…')}</option>
          </select>
        </label>
        {customDpi && (
          <label className="sf-field" htmlFor={id + 'dc'}>
            <span>dpi ({MIN_DPI}–{MAX_DPI})</span>
            <input
              id={id + 'dc'}
              type="text"
              inputMode="numeric"
              value={dpiText}
              onChange={(e) => setDpiText(e.target.value)}
              onBlur={() => commitDpi(dpiText)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDpi(dpiText);
                }
              }}
            />
          </label>
        )}
      </div>

      <p className="sf-summary" aria-live="polite">{summary(v)}</p>
    </div>
  );
}
