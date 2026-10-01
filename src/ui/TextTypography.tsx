import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/state/store';
import type { TextLayer } from '../editor/core/types';
import { scriptTarget } from '../editor/core/richText';
import {
  CASE_LABELS,
  FIELD_LABELS,
  FIELD_NAMES,
  changeCase,
  convertFractions,
  fieldsForDoc,
  type CaseMode,
} from '../editor/core/textMacros';
import { t } from '../i18n';
import './typography.css';

// Tipografía avanzada del texto (Propiedades → Más opciones → Texto): ajustar al
// cuadro, sangría y párrafos, capitular, columnas, tabulaciones, superíndice /
// subíndice, mayúsculas, campos dinámicos y kerning. La lógica está en
// editor/core/typography.ts y textMacros.ts.

// El cuadro de texto del panel conserva su selección aunque pierda el foco.
function panelTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea.text-edit');
}

const num = (v: string, min: number, max: number): number | undefined => {
  const n = Number(v);
  if (!Number.isFinite(n) || v.trim() === '') return undefined;
  return Math.max(min, Math.min(max, n));
};

export function TextTypography({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const styleTextRange = useEditor((s) => s.styleTextRange);
  const checkpoint = useEditor((s) => s.checkpoint);
  const doc = useEditor((s) => s.doc);
  const pages = useEditor((s) => s.pages);
  const [pairText, setPairText] = useState('');
  const [pairVal, setPairVal] = useState(-2);
  const [stopsText, setStopsText] = useState((layer.tabStops ?? []).join(', '));
  const lastId = useRef(layer.id);
  useEffect(() => {
    if (lastId.current !== layer.id) {
      lastId.current = layer.id;
      setStopsText((layer.tabStops ?? []).join(', '));
      setPairText('');
    }
  }, [layer.id, layer.tabStops]);

  const id = layer.id;
  const selection = () => {
    const ta = panelTextarea();
    if (!ta) return { a: layer.text.length, b: layer.text.length };
    return {
      a: Math.min(ta.selectionStart, layer.text.length),
      b: Math.min(ta.selectionEnd, layer.text.length),
    };
  };
  // Inserta texto en el cursor (o reemplaza la selección).
  const insertAtCursor = (s: string) => {
    const { a, b } = selection();
    updateLayer(id, { text: layer.text.slice(0, a) + s + layer.text.slice(b) });
    const ta = panelTextarea();
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = a + s.length;
      }
    });
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    shown?: string,
  ): ReactNode => (
    <label className="prop">
      {t(label)}: {shown ?? Math.round(value)}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={checkpoint}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );

  // --- caja y autoajuste ---
  const hasBox = !!layer.boxWidth && layer.boxWidth > 0;
  const setBox = (on: boolean) => {
    if (!on) {
      updateLayer(id, { boxWidth: undefined, boxHeight: undefined, autoFit: undefined, columns: undefined });
      return;
    }
    updateLayer(id, { boxWidth: Math.round(Math.max(120, Math.min(doc.width * 0.6, layer.fontSize * 12))) });
  };
  const hasBoxH = !!layer.boxHeight && layer.boxHeight > 0;

  // --- sup / sub ---
  const rangeSel = () => {
    const { a, b } = selection();
    return b > a ? { a, b } : null;
  };
  const toggleScript = (which: 'sup' | 'sub') => {
    const r = rangeSel();
    if (!r) return;
    styleTextRange(id, r.a, r.b, { script: scriptTarget(layer, r.a, r.b, which) });
  };

  // --- mayúsculas ---
  const applyCase = (mode: CaseMode) => {
    const r = rangeSel();
    const text = r ? changeCase(layer.text, mode, r.a, r.b) : changeCase(layer.text, mode);
    if (text !== layer.text) updateLayer(id, { text }); // mismo largo: los estilos por palabra siguen igual
  };

  // --- campos ---
  const fields = fieldsForDoc(doc, pages);

  // --- kerning ---
  const kern = layer.kerning ?? {};
  const pickPair = () => {
    const { a, b } = selection();
    const txt = layer.text;
    if (b - a === 2) setPairText(txt.slice(a, b));
    else if (a === b && a > 0 && a < txt.length) setPairText(txt.slice(a - 1, a + 1));
  };
  const setKern = (pair: string, v: number | undefined) => {
    const next = { ...kern };
    if (v === undefined || v === 0) delete next[pair];
    else next[pair] = v;
    updateLayer(id, { kerning: Object.keys(next).length ? next : undefined });
  };
  const pair = [...pairText].slice(0, 2).join('');
  const validPair = [...pair].length === 2;

  return (
    <>
      <div className="more-group ty">
        <span className="more-title">{t('Caja y autoajuste')}</span>
        <div className="row text-row">
          <button className={hasBox ? 'active' : ''} style={{ flex: 1 }} onClick={() => setBox(!hasBox)}>
            {t('Caja de ancho fijo')} {hasBox ? '✓' : ''}
          </button>
        </div>
        {hasBox && (
          <>
            <div className="ty-grid">
              <label>
                {t('Ancho')}
                <input
                  type="number"
                  min={20}
                  value={Math.round(layer.boxWidth!)}
                  onFocus={checkpoint}
                  onChange={(e) => {
                    const v = num(e.target.value, 20, 20000);
                    if (v !== undefined) updateLayerLive(id, { boxWidth: v });
                  }}
                />
              </label>
              <label>
                {t('Alto')}
                <input
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={hasBoxH ? Math.round(layer.boxHeight!) : ''}
                  onFocus={checkpoint}
                  onChange={(e) => {
                    const v = num(e.target.value, 0, 20000);
                    updateLayerLive(id, { boxHeight: v ? v : undefined, autoFit: v ? layer.autoFit : undefined });
                  }}
                />
              </label>
            </div>
            <div className="row text-row">
              <button
                className={layer.autoFit ? 'active' : ''}
                style={{ flex: 1 }}
                disabled={!hasBoxH}
                title={t('Reduce o amplía la letra hasta que el texto quepa en el cuadro')}
                onClick={() => updateLayer(id, { autoFit: !layer.autoFit })}
              >
                {t('Ajustar al cuadro')} {layer.autoFit ? '✓' : ''}
              </button>
            </div>
            {!hasBoxH && <p className="rail-hint">{t('Pon un alto para poder ajustar al cuadro y usar columnas fijas.')}</p>}
            {layer.autoFit && (
              <div className="ty-grid">
                <label>
                  {t('Mín. px')}
                  <input
                    type="number"
                    min={1}
                    value={layer.fitMin ?? 6}
                    onFocus={checkpoint}
                    onChange={(e) => updateLayerLive(id, { fitMin: num(e.target.value, 1, 2000) })}
                  />
                </label>
                <label>
                  {t('Máx. px')}
                  <input
                    type="number"
                    min={1}
                    value={layer.fitMax ?? Math.round(layer.fontSize)}
                    onFocus={checkpoint}
                    onChange={(e) => updateLayerLive(id, { fitMax: num(e.target.value, 1, 2000) })}
                  />
                </label>
              </div>
            )}
            <div className="ty-grid">
              <label>
                {t('Columnas')}
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={layer.columns ?? 1}
                  onFocus={checkpoint}
                  onChange={(e) => {
                    const v = num(e.target.value, 1, 6);
                    updateLayerLive(id, { columns: v && v > 1 ? Math.round(v) : undefined });
                  }}
                />
              </label>
              <label>
                {t('Separación')}
                <input
                  type="number"
                  min={0}
                  value={layer.columnGap ?? 0}
                  disabled={(layer.columns ?? 1) < 2}
                  onFocus={checkpoint}
                  onChange={(e) => updateLayerLive(id, { columnGap: num(e.target.value, 0, 500) })}
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Párrafos')}</span>
        {slider('Sangría', layer.indent ?? 0, 0, 200, 2, (v) => updateLayerLive(id, { indent: v || undefined }), `${Math.round(layer.indent ?? 0)} px`)}
        {slider(
          'Espacio entre párrafos',
          layer.paragraphSpacing ?? 0,
          0,
          200,
          2,
          (v) => updateLayerLive(id, { paragraphSpacing: v || undefined }),
          `${Math.round(layer.paragraphSpacing ?? 0)} px`,
        )}
        <div className="ty-grid">
          <label>
            {t('Capitular')}
            <select
              value={layer.dropCap ?? 'none'}
              onChange={(e) => {
                const v = e.target.value as 'none' | 'first' | 'all';
                updateLayer(id, { dropCap: v === 'none' ? undefined : v });
              }}
            >
              <option value="none">{t('Sin capitular')}</option>
              <option value="first">{t('Solo la primera letra')}</option>
              <option value="all">{t('Cada párrafo')}</option>
            </select>
          </label>
          <label>
            {t('Líneas')}
            <select
              value={layer.dropCapLines ?? 3}
              disabled={!layer.dropCap || layer.dropCap === 'none'}
              onChange={(e) => updateLayer(id, { dropCapLines: Number(e.target.value) })}
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Tabulaciones')}</span>
        <div className="row text-row">
          <button style={{ flex: 1 }} onClick={() => insertAtCursor('\t')} title={t('Inserta un carácter de tabulación en el cursor')}>
            ⇥ {t('Insertar tabulación')}
          </button>
        </div>
        <div className="ty-grid">
          <label>
            {t('Relleno')}
            <select
              value={layer.tabLeader ?? 'none'}
              onChange={(e) => {
                const v = e.target.value as 'none' | 'dots' | 'dashes';
                updateLayer(id, { tabLeader: v === 'none' ? undefined : v });
              }}
            >
              <option value="none">{t('Vacío')}</option>
              <option value="dots">{t('Puntos ......')}</option>
              <option value="dashes">{t('Guiones ------')}</option>
            </select>
          </label>
          <label>
            {t('Paradas (px)')}
            <input
              type="text"
              placeholder={t('cada 4 em')}
              value={stopsText}
              onChange={(e) => setStopsText(e.target.value)}
              onBlur={() => {
                const stops = stopsText
                  .split(/[\s,;]+/)
                  .map(Number)
                  .filter((n) => Number.isFinite(n) && n > 0)
                  .sort((x, y) => x - y);
                updateLayer(id, { tabStops: stops.length ? stops : undefined });
              }}
            />
          </label>
        </div>
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Superíndice, subíndice y fracciones')}</span>
        <div className="row text-row">
          <button
            style={{ flex: 1 }}
            disabled={!rangeSel()}
            title={t('Superíndice de la selección (x²)')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleScript('sup')}
          >
            x²
          </button>
          <button
            style={{ flex: 1 }}
            disabled={!rangeSel()}
            title={t('Subíndice de la selección (H₂O)')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleScript('sub')}
          >
            x₂
          </button>
          <button
            style={{ flex: 2 }}
            className={layer.fractions ? 'active' : ''}
            title={t('Dibuja 1/2, 3/4… como fracciones (½ ¾) sin cambiar el texto')}
            onClick={() => updateLayer(id, { fractions: !layer.fractions || undefined })}
          >
            ½ {t('Auto')} {layer.fractions ? '✓' : ''}
          </button>
        </div>
        <p className="rail-hint">{t('Selecciona letras en el cuadro de texto y pulsa x² o x₂.')}</p>
        <div className="row text-row">
          <button
            style={{ flex: 1 }}
            onClick={() => {
              const text = convertFractions(layer.text);
              if (text !== layer.text) updateLayer(id, { text });
            }}
            title={t('Sustituye 1/2, 3/4… por ½, ¾ en el propio texto')}
          >
            {t('Convertir fracciones del texto')}
          </button>
        </div>
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Cambiar mayúsculas')}</span>
        <label className="prop">
          {rangeSel() ? t('Se aplica a la selección') : t('Se aplica a todo el texto')}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) applyCase(e.target.value as CaseMode);
            }}
          >
            <option value="">{t('Elegir…')}</option>
            {(Object.keys(CASE_LABELS) as CaseMode[]).map((m) => (
              <option key={m} value={m}>
                {CASE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Campos dinámicos')}</span>
        <select
          value=""
          title={t('Se sustituyen al dibujar y exportar; el texto guardado conserva el marcador')}
          onChange={(e) => {
            if (e.target.value) insertAtCursor(`{{${e.target.value}}}`);
          }}
        >
          <option value="">{t('Insertar campo…')}</option>
          {FIELD_NAMES.map((n) => (
            <option key={n} value={n}>
              {t(FIELD_LABELS[n])} · {`{{${n}}}`}
            </option>
          ))}
        </select>
        <p className="rail-hint ty-values">
          {FIELD_NAMES.map((n) => `{{${n}}} = ${fields[n] || '—'}`).join('  ·  ')}
        </p>
      </div>

      <div className="more-group ty">
        <span className="more-title">{t('Kerning por parejas')}</span>
        <div className="ty-grid">
          <label>
            {t('Pareja')}
            <input
              type="text"
              value={pairText}
              maxLength={4}
              placeholder="AV"
              onChange={(e) => {
                setPairText(e.target.value);
                const p = [...e.target.value].slice(0, 2).join('');
                if ([...p].length === 2 && kern[p] !== undefined) setPairVal(kern[p]);
              }}
            />
          </label>
          <label>
            {t('Ajuste (px)')}
            <input
              type="number"
              step={0.5}
              value={validPair && kern[pair] !== undefined ? kern[pair] : pairVal}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setPairVal(v);
                if (validPair) setKern(pair, v);
              }}
            />
          </label>
        </div>
        <div className="row text-row">
          <button style={{ flex: 1 }} onMouseDown={(e) => e.preventDefault()} onClick={pickPair} title={t('Toma las dos letras junto al cursor del cuadro de texto')}>
            {t('Tomar del cursor')}
          </button>
          <button
            style={{ flex: 1 }}
            disabled={!validPair || pairVal === 0}
            onClick={() => setKern(pair, pairVal)}
          >
            {t('Aplicar')}
          </button>
        </div>
        {Object.keys(kern).length > 0 && (
          <div className="ty-chips">
            {Object.entries(kern).map(([k, v]) => (
              <button key={k} className="ty-chip" title={t('Quitar')} onClick={() => setKern(k, undefined)}>
                {k} {v > 0 ? '+' : ''}
                {v} ✕
              </button>
            ))}
          </div>
        )}
        <p className="rail-hint">{t('Coloca el cursor entre dos letras del cuadro de texto y pulsa «Tomar del cursor».')}</p>
      </div>
    </>
  );
}
