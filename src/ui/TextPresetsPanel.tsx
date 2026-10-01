// Pestaña «Texto»: estilos de texto listos y pares de fuentes.
// Las tarjetas muestran la muestra con la fuente real (CSS) a escala reducida.
import { useState, type CSSProperties } from 'react';
import { useEditor } from '../editor/state/store';
import {
  FONT_PAIR_DEFS,
  PRESET_CATEGORIES,
  TEXT_PRESET_DEFS,
  type FontPairDef,
  type PresetCategory,
  type TextPresetDef,
} from '../editor/core/textPresets';
import { t } from '../i18n';
import './textpresets.css';

const CARD_SCALE = 0.3; // tamaño de referencia (1080) -> px en la tarjeta
const CARD_MIN = 15;
const CARD_MAX = 30;

function previewStyle(p: TextPresetDef): CSSProperties {
  const s = p.style;
  const size = Math.min(CARD_MAX, Math.max(CARD_MIN, (s.fontSize ?? 48) * CARD_SCALE));
  const r = size / (s.fontSize ?? 48);
  const css: CSSProperties = {
    fontFamily: `"${s.fontFamily}", sans-serif`,
    fontSize: size,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    letterSpacing: (s.letterSpacing ?? 0) * r,
    color: s.fill,
    textDecoration: s.underline ? 'underline' : 'none',
    lineHeight: 1.1,
  };
  if (s.shadow) {
    css.textShadow = `${(s.shadowX ?? 0) * r}px ${(s.shadowY ?? 0) * r}px ${(s.shadowBlur ?? 0) * r}px ${s.shadowColor}`;
  }
  if (s.textEffect === 'echo') {
    const step = size * 0.06;
    css.textShadow = [1, 2, 3, 4].map((i) => `${step * i}px ${step * i}px 0 ${s.effectColor}`).join(',');
  }
  if (s.textEffect === 'background') {
    css.background = s.effectColor;
    css.padding = '0.15em 0.4em';
    css.borderRadius = '0.2em';
  }
  if (s.strokeWidth) {
    (css as CSSProperties & Record<string, unknown>).WebkitTextStroke = `${Math.max(1, s.strokeWidth * r)}px ${s.strokeColor}`;
  }
  return css;
}

function PresetCard({ p }: { p: TextPresetDef }) {
  const add = useEditor((s) => s.addTextPreset);
  return (
    <button
      className="tp-card"
      style={{ background: p.previewBg }}
      title={p.name}
      aria-label={p.name}
      onClick={() => void add(p.id)}
    >
      <span className="tp-sample" style={previewStyle(p)}>
        {p.style.textTransform === 'upper' ? p.sample.toUpperCase() : p.sample}
      </span>
    </button>
  );
}

function PairCard({ p }: { p: FontPairDef }) {
  const add = useEditor((s) => s.addFontPair);
  const mk = (x: FontPairDef['title'], size: number): CSSProperties => ({
    fontFamily: `"${x.fontFamily}", sans-serif`,
    fontSize: size,
    fontWeight: x.bold ? 700 : 400,
    color: x.fill,
    textTransform: x.textTransform === 'upper' ? 'uppercase' : 'none',
    letterSpacing: (x.letterSpacing ?? 0) * 0.15,
    lineHeight: 1.1,
  });
  return (
    <button className="tp-pair" title={`${p.name}: ${p.title.fontFamily} + ${p.body.fontFamily}`} onClick={() => void add(p.id)}>
      <span style={mk(p.title, 20)}>{p.titleText}</span>
      <span style={mk(p.body, 11)}>{p.bodyText}</span>
      <small className="tp-pair-name">
        {p.title.fontFamily} + {p.body.fontFamily}
      </small>
    </button>
  );
}

export function TextPresetsPanel() {
  const [cat, setCat] = useState<PresetCategory>(PRESET_CATEGORIES[0]);
  const items = TEXT_PRESET_DEFS.filter((p) => p.category === cat);
  return (
    <div className="tp-root">
      <div className="tp-title">{t('Estilos de texto')}</div>
      <div className="tp-tabs" role="tablist">
        {PRESET_CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={c === cat} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>
            {t(c)}
          </button>
        ))}
      </div>
      <div className="tp-grid">
        {items.map((p) => (
          <PresetCard key={p.id} p={p} />
        ))}
      </div>
      <div className="tp-title">{t('Pares de fuentes')}</div>
      <div className="tp-pairs">
        {FONT_PAIR_DEFS.map((p) => (
          <PairCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}
