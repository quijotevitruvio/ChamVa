import { useEffect, useMemo, useRef, useState } from 'react';
import { drawTitle, layoutTitle } from '../../video/engine/titleDraw';
import type { TitleStyle } from '../../video/model';
import { TITLE_CATEGORIES, TITLE_PAIRS, TITLE_PRESETS, type TitleCategory, type TitlePair, type TitlePreset } from '../../video/title/presets';

const SW = 480;
const SH = 270;

/** Versión que sube cuando se carga una fuente (las muestras se repintan). */
function useFontsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const on = () => setV((x) => x + 1);
    fonts.addEventListener('loadingdone', on);
    return () => fonts.removeEventListener('loadingdone', on);
  }, []);
  return v;
}

/** Muestra de un estilo: se pinta con la MISMA función que la exportación (`drawTitle`), no con CSS. */
export function StyleSwatch({ text, style, anim, bg, version, label }: { text: string; style: TitleStyle; anim?: TitlePreset['anim']; bg?: string; version: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let alive = true;
    const paint = () => {
      if (!alive) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const g = ctx.createLinearGradient(0, 0, SW, SH);
      g.addColorStop(0, bg ?? '#3a4a63');
      g.addColorStop(1, bg ?? '#1c2230');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SW, SH);
      const first = text.split('\n').slice(0, 2).join('\n');
      // la muestra ajusta el tamaño para que el texto llene el cuadro (≈ 84 % del ancho, ≤ 30 % del alto por línea)
      const one = { ...style, maxWidth: 8 };
      const m0 = layoutTitle(ctx, first, one, SW, SH);
      const nl = first.split(String.fromCharCode(10)).length;
      const k = Math.max(0.2, Math.min((0.84 * SW) / Math.max(1, m0.width), (0.3 * SH) / (Math.max(1, m0.fontPx) * nl)));
      drawTitle(ctx, SW, SH, {
        text: first,
        style: { ...style, fontSize: style.fontSize * k, strokeWidth: style.strokeWidth * k, shadowBlur: style.shadowBlur * k, shadowX: style.shadowX * k, shadowY: style.shadowY * k, letterSpacing: style.letterSpacing * k, maxWidth: 0.92 },
        anim: anim?.karaoke ? { karaoke: anim.karaoke } : undefined,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
        lt: 1,
        dur: 3,
        alpha: 1,
      });
    };
    const fam = style.fontFamily;
    const desc = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}40px "${fam}"`;
    paint();
    if (document.fonts?.load) void document.fonts.load(desc).then(paint, () => {});
    return () => {
      alive = false;
    };
  }, [text, style, anim, bg, version]);
  return <canvas ref={ref} width={SW} height={SH} className="vx-swatch" role="img" aria-label={label} />;
}

interface Props {
  /** hay un texto seleccionado al que se puede aplicar el estilo */
  canApply: boolean;
  onAdd: (p: TitlePreset) => void;
  onApply: (p: TitlePreset) => void;
  onAddPair: (p: TitlePair) => void;
  onAddPlain: () => void;
}

/** Pestaña «Texto»: galería de estilos de título con muestras y pares de fuentes. */
export function TextPanel({ canApply, onAdd, onApply, onAddPair, onAddPlain }: Props) {
  const version = useFontsVersion();
  const [cat, setCat] = useState<TitleCategory | 'Todos' | 'Pares'>('Todos');
  const [mode, setMode] = useState<'add' | 'apply'>('add');
  const list = useMemo(() => (cat === 'Todos' || cat === 'Pares' ? TITLE_PRESETS : TITLE_PRESETS.filter((p) => p.category === cat)), [cat]);
  const useApply = canApply && mode === 'apply';
  return (
    <div className="vx-tabbody">
      <div className="vx-tabbar-row">
        <label className="vx-inline">
          <span>Categoría</span>
          <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Categoría de estilos">
            <option value="Todos">Todos ({TITLE_PRESETS.length})</option>
            {TITLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="Pares">Pares de fuentes ({TITLE_PAIRS.length})</option>
          </select>
        </label>
        {canApply && (
          <label className="vx-inline">
            <span>Al pulsar</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'add' | 'apply')} aria-label="Qué hace pulsar un estilo">
              <option value="add">Añadir en el cabezal</option>
              <option value="apply">Aplicar al texto elegido</option>
            </select>
          </label>
        )}
        <button type="button" onClick={onAddPlain}>🅣 Texto simple</button>
      </div>
      <div className="vx-swatches" role="list">
        {cat === 'Pares'
          ? TITLE_PAIRS.map((p) => (
              <button type="button" role="listitem" key={p.id} className="vx-swatch-btn" onClick={() => onAddPair(p)} title={`Añadir par «${p.name}» (título y cuerpo) en el cabezal`}>
                <StyleSwatch text={p.title.text} style={p.title.style} version={version} label={`Par ${p.name}`} />
                <span className="vx-swatch-name">{p.name} · {p.title.style.fontFamily} + {p.body.style.fontFamily}</span>
              </button>
            ))
          : list.map((p) => (
              <button type="button" role="listitem" key={p.id} className="vx-swatch-btn" onClick={() => (useApply ? onApply(p) : onAdd(p))} title={useApply ? `Aplicar «${p.name}»` : `Añadir «${p.name}» en el cabezal`}>
                <StyleSwatch text={p.text} style={p.style} anim={p.anim} bg={p.previewBg} version={version} label={p.name} />
                <span className="vx-swatch-name">{p.name}{p.anim?.karaoke ? ' ♪' : ''}</span>
              </button>
            ))}
      </div>
    </div>
  );
}
