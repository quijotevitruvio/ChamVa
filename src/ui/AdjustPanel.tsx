import { useEffect, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { DEFAULT_ADJUST, type HslFamily, type ImageAdjust, type ImageLayer } from '../editor/core/types';
import { ADJUST_PRESETS, autoEnhance, processImage } from '../editor/core/imageProcessing';
import { computeHistogram, isNeutralLevels, type Histogram } from '../editor/core/levels';
import { HSL_FAMILIES, hasHslMix } from '../editor/core/hslMixer';
import { hasCurves } from '../editor/core/curves';
import { CurvesEditor } from './CurvesEditor';
import { LevelsEditor } from './LevelsEditor';
import './adjust2.css';
import { EffectsSection } from './EffectsSection';

type NumKey = Exclude<keyof ImageAdjust, 'outlineColor' | 'invert' | 'curves' | 'levels' | 'hslMix' | 'fx'>;

interface SliderDef {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
}

const SECTIONS: { title: string; sliders: SliderDef[] }[] = [
  {
    title: 'Luz',
    sliders: [
      { key: 'exposure', label: 'Exposición', min: -100, max: 100, step: 1, neutral: 0 },
      { key: 'brightness', label: 'Brillo', min: 0, max: 2, step: 0.01, neutral: 1 },
      { key: 'contrast', label: 'Contraste', min: 0, max: 2, step: 0.01, neutral: 1 },
      { key: 'highlights', label: 'Luces', min: -1, max: 1, step: 0.01, neutral: 0 },
      { key: 'shadows', label: 'Sombras', min: -1, max: 1, step: 0.01, neutral: 0 },
    ],
  },
  {
    title: 'Color',
    sliders: [
      { key: 'hue', label: 'Matiz', min: -180, max: 180, step: 1, neutral: 0 },
      { key: 'saturate', label: 'Saturación', min: 0, max: 2, step: 0.01, neutral: 1 },
      { key: 'vibrance', label: 'Intensidad', min: -1, max: 1, step: 0.01, neutral: 0 },
      { key: 'temperature', label: 'Temperatura', min: -1, max: 1, step: 0.01, neutral: 0 },
      { key: 'tint', label: 'Tinte', min: -1, max: 1, step: 0.01, neutral: 0 },
    ],
  },
  {
    title: 'Detalle',
    sliders: [
      { key: 'sharpen', label: 'Nitidez', min: 0, max: 1, step: 0.01, neutral: 0 },
      { key: 'clarity', label: 'Claridad', min: 0, max: 100, step: 1, neutral: 0 },
      { key: 'blur', label: 'Desenfoque', min: 0, max: 30, step: 0.5, neutral: 0 },
      { key: 'grain', label: 'Grano', min: 0, max: 1, step: 0.01, neutral: 0 },
      { key: 'denoise', label: 'Reducir ruido (luz)', min: 0, max: 100, step: 1, neutral: 0 },
      { key: 'denoiseColor', label: 'Reducir ruido (color)', min: 0, max: 100, step: 1, neutral: 0 },
      { key: 'dehaze', label: 'Quitar neblina', min: 0, max: 100, step: 1, neutral: 0 },
    ],
  },
  {
    title: 'Lente',
    sliders: [
      { key: 'lensDistortion', label: 'Distorsión (barril / cojín)', min: -100, max: 100, step: 1, neutral: 0 },
      { key: 'lensVignette', label: 'Corregir viñeteo', min: 0, max: 100, step: 1, neutral: 0 },
    ],
  },
  {
    title: 'Efectos',
    sliders: [
      { key: 'grayscale', label: 'Blanco y negro', min: 0, max: 100, step: 1, neutral: 0 },
      { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, neutral: 0 },
      { key: 'threshold', label: 'Umbral (0 = apagado)', min: 0, max: 255, step: 1, neutral: 0 },
      { key: 'vignette', label: 'Viñeta', min: 0, max: 1, step: 0.01, neutral: 0 },
      { key: 'pixelate', label: 'Pixelado', min: 0, max: 50, step: 1, neutral: 0 },
      { key: 'posterize', label: 'Posterizar', min: 0, max: 1, step: 0.01, neutral: 0 },
      { key: 'outline', label: 'Contorno sticker', min: 0, max: 40, step: 1, neutral: 0 },
    ],
  },
];

const fmt = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2));

// Decodifica la imagen a un canvas pequeño (~256px) y devuelve sus píxeles.
function sampleImage(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(ctx.getImageData(0, 0, w, h));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Histograma en vivo: imagen reducida con los ajustes actuales EXCEPTO niveles y curvas
// (lo que reciben esas herramientas), recalculado con un pequeño retardo.
function useLiveHistogram(layer: ImageLayer, adj: ImageAdjust, enabled: boolean): Histogram | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [hist, setHist] = useState<Histogram | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => alive && setImg(el);
    el.src = layer.src;
    return () => {
      alive = false;
    };
  }, [layer.src, enabled]);
  const key = JSON.stringify({ ...adj, curves: undefined, levels: undefined });
  useEffect(() => {
    if (!enabled || !img) return;
    const t = setTimeout(() => {
      try {
        const small = { ...layer, adjust: { ...adj, curves: undefined, levels: undefined } } as ImageLayer;
        const c = processImage(img, small, 192);
        const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
        setHist(computeHistogram(px));
      } catch {
        setHist(null);
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, key, layer.filter, layer.flipX, layer.flipY, enabled]);
  return hist;
}

export function AdjustPanel({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const [busy, setBusy] = useState(false);
  const [famSel, setFamSel] = useState<HslFamily>('red');
  const [tonesOpen, setTonesOpen] = useState(false); // el histograma solo se calcula con curvas/niveles abiertos

  const adj: ImageAdjust = { ...DEFAULT_ADJUST, ...(layer.adjust ?? {}) };
  const hist = useLiveHistogram(layer, adj, tonesOpen);
  const famVal = adj.hslMix?.[famSel] ?? {};
  const setLive = (patch: Partial<ImageAdjust>) =>
    updateLayerLive(layer.id, { adjust: { ...(layer.adjust ?? DEFAULT_ADJUST), ...patch } });
  const setFinal = (patch: Partial<ImageAdjust>) =>
    updateLayer(layer.id, { adjust: { ...(layer.adjust ?? DEFAULT_ADJUST), ...patch } });

  const setFam = (patch: { h?: number; s?: number; l?: number }, live: boolean) => {
    const mix = { ...(adj.hslMix ?? {}), [famSel]: { ...famVal, ...patch } };
    (live ? setLive : setFinal)({ hslMix: hasHslMix(mix) ? mix : undefined });
  };

  const autoImprove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await sampleImage(layer.src);
      setFinal(autoEnhance(data));
    } catch {
      // imagen no legible: no hacemos nada
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button className="magic full" onClick={autoImprove} disabled={busy}>
        {busy ? 'Analizando…' : '✨ Auto-mejorar'}
      </button>

      <h4 className="rail-sub">Estilos de un clic</h4>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {ADJUST_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => updateLayer(layer.id, { adjust: { ...DEFAULT_ADJUST, ...p.adjust } })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button className="full" onClick={() => updateLayer(layer.id, { adjust: { ...DEFAULT_ADJUST } })}>
        ↺ Restablecer
      </button>

      {SECTIONS.map((sec) => (
        <div key={sec.title}>
          <h4 className="rail-sub">{sec.title}</h4>
          {sec.sliders.map((s) => {
            const value = (adj[s.key] as number | undefined) ?? s.neutral;
            return (
              <label className="prop" key={s.key}>
                {s.label}: {fmt(value, s.step)}
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={value}
                  onPointerDown={checkpoint}
                  onChange={(e) => setLive({ [s.key]: Number(e.target.value) })}
                />
              </label>
            );
          })}
          {sec.title === 'Efectos' && (
            <label className="prop" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={adj.invert === true}
                onChange={(e) => setFinal({ invert: e.target.checked })}
              />
              Invertir colores
            </label>
          )}
          {sec.title === 'Efectos' && (
            <label className="prop">
              Color del contorno
              <input
                type="color"
                value={adj.outlineColor ?? '#ffffff'}
                onPointerDown={checkpoint}
                onChange={(e) => setLive({ outlineColor: e.target.value })}
              />
            </label>
          )}
        </div>
      ))}

      <h4 className="rail-sub">Ajustes avanzados</h4>
      <details
        className="prop-section"
        onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setTonesOpen(true)}
      >
        <summary>Curvas de tono{hasCurves(adj.curves) ? ' •' : ''}</summary>
        <div className="prop-section-body">
          <CurvesEditor
            curves={adj.curves}
            hist={hist}
            onStart={checkpoint}
            onLive={(c) => setLive({ curves: c })}
            onFinal={(c) => setFinal({ curves: c })}
          />
        </div>
      </details>
      <details
        className="prop-section"
        onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setTonesOpen(true)}
      >
        <summary>Niveles{isNeutralLevels(adj.levels) ? '' : ' •'}</summary>
        <div className="prop-section-body">
          <LevelsEditor
            levels={adj.levels}
            hist={hist}
            onStart={checkpoint}
            onLive={(l) => setLive({ levels: l })}
            onFinal={(l) => setFinal({ levels: l })}
          />
        </div>
      </details>
      <details className="prop-section">
        <summary>Mezclador de color (HSL){hasHslMix(adj.hslMix) ? ' •' : ''}</summary>
        <div className="prop-section-body">
          <div className="adj2-fam">
            {HSL_FAMILIES.map((f) => {
              const v = adj.hslMix?.[f.id];
              const touched = !!v && ((v.h ?? 0) !== 0 || (v.s ?? 0) !== 0 || (v.l ?? 0) !== 0);
              return (
                <button key={f.id} className={famSel === f.id ? 'on' : ''} onClick={() => setFamSel(f.id)}>
                  <i style={{ background: f.swatch }} />
                  {f.label}
                  {touched && <b />}
                </button>
              );
            })}
          </div>
          {(
            [
              ['h', 'Tono'],
              ['s', 'Saturación'],
              ['l', 'Luminosidad'],
            ] as const
          ).map(([k, label]) => (
            <label className="prop" key={k}>
              {label}: {Math.round(famVal[k] ?? 0)}
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={famVal[k] ?? 0}
                onPointerDown={checkpoint}
                onChange={(e) => setFam({ [k]: Number(e.target.value) }, true)}
              />
            </label>
          ))}
          <div className="adj2-row">
            <button onClick={() => setFam({ h: 0, s: 0, l: 0 }, false)}>Restablecer esta familia</button>
            <button onClick={() => setFinal({ hslMix: undefined })} disabled={!hasHslMix(adj.hslMix)}>
              Restablecer todo
            </button>
          </div>
        </div>
      </details>

      <EffectsSection layer={layer} />
    </div>
  );
}
