import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import { DEFAULT_ADJUST, type ImageAdjust, type ImageLayer } from '../editor/core/types';
import { ADJUST_PRESETS, autoEnhance } from '../editor/core/imageProcessing';

type NumKey = Exclude<keyof ImageAdjust, 'outlineColor'>;

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
      { key: 'brightness', label: 'Brillo', min: 0, max: 2, step: 0.01, neutral: 1 },
      { key: 'contrast', label: 'Contraste', min: 0, max: 2, step: 0.01, neutral: 1 },
      { key: 'highlights', label: 'Luces', min: -1, max: 1, step: 0.01, neutral: 0 },
      { key: 'shadows', label: 'Sombras', min: -1, max: 1, step: 0.01, neutral: 0 },
    ],
  },
  {
    title: 'Color',
    sliders: [
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
      { key: 'blur', label: 'Desenfoque', min: 0, max: 30, step: 0.5, neutral: 0 },
      { key: 'grain', label: 'Grano', min: 0, max: 1, step: 0.01, neutral: 0 },
    ],
  },
  {
    title: 'Efectos',
    sliders: [
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

export function AdjustPanel({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const [busy, setBusy] = useState(false);

  const adj: ImageAdjust = { ...DEFAULT_ADJUST, ...(layer.adjust ?? {}) };
  const setLive = (patch: Partial<ImageAdjust>) =>
    updateLayerLive(layer.id, { adjust: { ...(layer.adjust ?? DEFAULT_ADJUST), ...patch } });
  const setFinal = (patch: Partial<ImageAdjust>) =>
    updateLayer(layer.id, { adjust: { ...(layer.adjust ?? DEFAULT_ADJUST), ...patch } });

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
    </div>
  );
}
