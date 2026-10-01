import { useEffect, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/state/store';
import { DEFAULT_ADJUST, type FxBlend, type FxTexture, type ImageAdjust, type ImageFx, type ImageLayer } from '../editor/core/types';
import {
  GRADIENT_MAP_PRESETS,
  averageColor,
  hasImageFx,
  preloadFxImages,
  shrinkToDataUrl,
} from '../editor/core/imageEffects';
import { TEXTURE_KINDS, defaultTextureMode } from '../editor/core/proceduralTextures';
import { getThumb } from '../io/thumbs';
import { GradientEditor } from './GradientEditor';
import { RedEyeEditor } from './RedEyeEditor';
import { toast } from './toast';
import './effects.css';

const BLENDS: { id: FxBlend; label: string }[] = [
  { id: 'screen', label: 'Trama' },
  { id: 'multiply', label: 'Multiplicar' },
  { id: 'overlay', label: 'Superponer' },
  { id: 'softlight', label: 'Luz suave' },
];

const FALLBACK_GRADIENT = GRADIENT_MAP_PRESETS[0].gradient;

function Thumb({ u, onPick }: { u: { id: string; src: string; naturalWidth: number; naturalHeight: number; name: string }; onPick: () => void }) {
  const [src, setSrc] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    getThumb(u)
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(u.src));
    return () => {
      alive = false;
    };
  }, [u]);
  return (
    <button className="fx-thumb" onClick={onPick} title={u.name} aria-label={`Usar ${u.name}`}>
      {src && <img src={src} alt="" draggable={false} />}
    </button>
  );
}

interface SliderCtx {
  fx: ImageFx;
  setLive: (patch: Partial<ImageFx>) => void;
  checkpoint: () => void;
}

function Slider({
  c,
  k,
  label,
  min,
  max,
  step = 1,
  neutral = 0,
  unit = '',
}: {
  c: SliderCtx;
  k: keyof ImageFx;
  label: string;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  unit?: string;
}) {
  const v = typeof c.fx[k] === 'number' ? (c.fx[k] as number) : neutral;
  return (
    <label className="prop">
      {label}: {step >= 1 ? Math.round(v) : v.toFixed(2)}
      {unit}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onPointerDown={c.checkpoint}
        onChange={(e) => c.setLive({ [k]: Number(e.target.value) })}
      />
    </label>
  );
}

function Group({ title, active, children }: { title: string; active: boolean; children: ReactNode }) {
  return (
    <details className="prop-section">
      <summary>
        {title}
        {active ? ' •' : ''}
      </summary>
      <div className="prop-section-body fx-body">{children}</div>
    </details>
  );
}

function Seg<T extends string>({ value, options, onPick, label }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Secciones «Efectos creativos» y «Retoque» del panel Ajustes de imagen.
export function EffectsSection({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const uploads = useEditor((s) => s.uploads);
  const [redEyeOpen, setRedEyeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fx: ImageFx = layer.adjust?.fx ?? {};
  const base = (): ImageAdjust => ({ ...DEFAULT_ADJUST, ...(layer.adjust ?? {}) });
  const setLive = (patch: Partial<ImageFx>) =>
    updateLayerLive(layer.id, { adjust: { ...base(), fx: { ...fx, ...patch } } });
  const setFinal = (patch: Partial<ImageFx>) =>
    updateLayer(layer.id, { adjust: { ...base(), fx: { ...fx, ...patch } } });

  const c: SliderCtx = { fx, setLive, checkpoint };

  const pickDouble = async (src: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const small = await shrinkToDataUrl(src, 900);
      const patch = { dblSrc: small, dblMode: fx.dblMode ?? 'screen', dblOpacity: (fx.dblOpacity ?? 0) > 0 ? fx.dblOpacity : 0.5 };
      await preloadFxImages({ ...DEFAULT_ADJUST, fx: patch });
      setFinal(patch);
    } catch {
      toast('No se pudo usar esa imagen.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const colorShadow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('carga'));
        el.src = layer.src;
      });
      const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const color = averageColor(ctx.getImageData(0, 0, c.width, c.height));
      updateLayer(layer.id, { shadow: true, shadowColor: color, shadowBlur: 28, shadowX: 0, shadowY: 14 });
    } catch {
      toast('No se pudo leer la imagen.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const texKind: FxTexture = fx.texKind ?? 'paper';
  const gradient = fx.gradMap ?? FALLBACK_GRADIENT;
  const redEyes = fx.redEyes ?? [];
  const dblReady = !!fx.dblSrc;

  return (
    <div className="fx">
      <h4 className="rail-sub">Efectos creativos</h4>
      <button
        className="full"
        onClick={() => updateLayer(layer.id, { adjust: { ...base(), fx: undefined } })}
        disabled={!hasImageFx(fx)}
      >
        Quitar efectos creativos
      </button>

      <Group title="Tilt-shift (maqueta)" active={(fx.tiltAmount ?? 0) > 0 || (fx.tiltSat ?? 0) > 0}>
        <Slider c={c} k="tiltAmount" label="Desenfoque" min={0} max={100} />
        <Slider c={c} k="tiltPos" label="Posición de la banda" min={0} max={1} step={0.01} neutral={0.5} />
        <Slider c={c} k="tiltWidth" label="Ancho de la banda" min={0} max={1} step={0.01} neutral={0.25} />
        <Slider c={c} k="tiltSat" label="Saturación extra" min={0} max={100} />
        <label className="fx-check">
          <input type="checkbox" checked={fx.tiltVertical === true} onChange={(e) => setFinal({ tiltVertical: e.target.checked })} />
          Banda vertical
        </label>
      </Group>

      <Group
        title="Desenfoque de movimiento, radial y zoom"
        active={(fx.motionDist ?? 0) > 0 || (fx.radialAmount ?? 0) > 0 || (fx.zoomAmount ?? 0) > 0}
      >
        <Slider c={c} k="motionDist" label="Movimiento: distancia" min={0} max={100} />
        <Slider c={c} k="motionAngle" label="Movimiento: ángulo" min={0} max={180} unit="°" />
        <Slider c={c} k="radialAmount" label="Radial (giro)" min={0} max={100} />
        <Slider c={c} k="zoomAmount" label="Zoom" min={0} max={100} />
        <Slider c={c} k="blurCx" label="Centro horizontal" min={0} max={1} step={0.01} neutral={0.5} />
        <Slider c={c} k="blurCy" label="Centro vertical" min={0} max={1} step={0.01} neutral={0.5} />
      </Group>

      <Group title="Aberración cromática y glitch" active={(fx.chroma ?? 0) > 0 || (fx.glitch ?? 0) > 0}>
        <Slider c={c} k="chroma" label="Aberración: distancia" min={0} max={100} />
        <Slider c={c} k="chromaAngle" label="Aberración: ángulo" min={0} max={180} unit="°" />
        <Slider c={c} k="glitch" label="Glitch: intensidad" min={0} max={100} />
        <Slider c={c} k="glitchSeed" label="Glitch: semilla" min={1} max={99} neutral={1} />
      </Group>

      <Group title="Trama de medios tonos (halftone)" active={(fx.htSize ?? 0) > 0}>
        <Slider c={c} k="htSize" label="Tamaño del punto (0 = apagado)" min={0} max={40} />
        <Slider c={c} k="htAngle" label="Ángulo de la trama" min={0} max={90} neutral={45} unit="°" />
        <label className="fx-check">
          <input type="checkbox" checked={fx.htColor === true} onChange={(e) => setFinal({ htColor: e.target.checked })} />
          Puntos de color
        </label>
      </Group>

      <Group title="Lápiz y cómic" active={(fx.sketchAmount ?? 0) > 0}>
        <Seg
          label="Estilo"
          value={fx.sketchMode ?? 'pencil'}
          options={[
            { id: 'pencil', label: 'Lápiz' },
            { id: 'comic', label: 'Cómic' },
          ]}
          onPick={(v) => setFinal({ sketchMode: v, sketchAmount: (fx.sketchAmount ?? 0) > 0 ? fx.sketchAmount : 100 })}
        />
        <Slider c={c} k="sketchAmount" label="Intensidad (0 = apagado)" min={0} max={100} />
      </Group>

      <Group title="Mapa de degradado (duotono / trítono)" active={!!fx.gradMap && (fx.gradMapAmount ?? 0) > 0}>
        <div className="fx-presets">
          {GRADIENT_MAP_PRESETS.map((p) => (
            <button
              key={p.id}
              className="fx-grad"
              title={p.label}
              aria-label={p.label}
              style={{ background: `linear-gradient(90deg, ${p.gradient.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})` }}
              onClick={() => setFinal({ gradMap: p.gradient, gradMapAmount: (fx.gradMapAmount ?? 0) > 0 ? fx.gradMapAmount : 100 })}
            />
          ))}
        </div>
        <div onPointerDown={checkpoint}>
          <GradientEditor
            value={{ ...gradient, kind: 'linear' }}
            onChange={(g) => setLive({ gradMap: g, gradMapAmount: (fx.gradMapAmount ?? 0) > 0 ? fx.gradMapAmount : 100 })}
          />
        </div>
        <Slider c={c} k="gradMapAmount" label="Intensidad (0 = apagado)" min={0} max={100} />
      </Group>

      <Group title="Resplandor (bloom)" active={(fx.glowAmount ?? 0) > 0}>
        <Slider c={c} k="glowAmount" label="Intensidad" min={0} max={100} />
        <Slider c={c} k="glowRadius" label="Radio" min={0} max={100} neutral={40} />
        <label className="prop">
          Color del resplandor
          <span className="fx-row">
            <input
              type="color"
              value={fx.glowColor || '#ffffff'}
              onPointerDown={checkpoint}
              onChange={(e) => setLive({ glowColor: e.target.value })}
            />
            <button onClick={() => setFinal({ glowColor: '' })} disabled={!fx.glowColor}>
              Color natural
            </button>
          </span>
        </label>
      </Group>

      <Group title="Texturas y superposiciones" active={(fx.texAmount ?? 0) > 0}>
        <div className="fx-presets">
          {TEXTURE_KINDS.map((k) => (
            <button
              key={k.id}
              className={texKind === k.id ? 'on' : ''}
              onClick={() => setFinal({ texKind: k.id, texMode: k.mode, texAmount: (fx.texAmount ?? 0) > 0 ? fx.texAmount : 0.5 })}
            >
              {k.label}
            </button>
          ))}
        </div>
        <Seg label="Fusión" value={fx.texMode ?? defaultTextureMode(texKind)} options={BLENDS} onPick={(v) => setFinal({ texMode: v })} />
        <Slider c={c} k="texAmount" label="Opacidad (0 = apagado)" min={0} max={1} step={0.01} />
        <Slider c={c} k="texScale" label="Escala del detalle" min={0.5} max={3} step={0.05} neutral={1} />
        <Slider c={c} k="texSeed" label="Variante" min={1} max={99} neutral={1} />
      </Group>

      <Group title="Doble exposición" active={dblReady && (fx.dblOpacity ?? 0) > 0}>
        {uploads.length === 0 ? (
          <p className="fx-hint">Sube imágenes a la galería (pestaña Subidos) para mezclarlas aquí.</p>
        ) : (
          <div className="fx-thumbs" aria-busy={busy}>
            {uploads.map((u) => (
              <Thumb key={u.id} u={u} onPick={() => pickDouble(u.src)} />
            ))}
          </div>
        )}
        {dblReady && (
          <>
            <Seg label="Fusión" value={fx.dblMode ?? 'screen'} options={BLENDS} onPick={(v) => setFinal({ dblMode: v })} />
            <Slider c={c} k="dblOpacity" label="Opacidad" min={0} max={1} step={0.01} neutral={0.5} />
            <button onClick={() => setFinal({ dblSrc: undefined })}>Quitar imagen</button>
          </>
        )}
      </Group>

      <h4 className="rail-sub">Retoque</h4>

      <Group title="Quitar ojos rojos" active={redEyes.length > 0}>
        <p className="fx-hint">Haz clic y arrastra sobre la pupila para marcar una zona.</p>
        <div className="fx-row">
          <button onClick={() => setRedEyeOpen((o) => !o)}>{redEyeOpen ? 'Cerrar vista' : 'Quitar ojos rojos'}</button>
          <button onClick={() => setFinal({ redEyes: undefined })} disabled={redEyes.length === 0}>
            Quitar zonas ({redEyes.length})
          </button>
        </div>
        {redEyeOpen && (
          <RedEyeEditor
            layer={layer}
            points={redEyes}
            onChange={(pts) => {
              checkpoint();
              setFinal({ redEyes: pts.length ? pts : undefined });
            }}
          />
        )}
      </Group>

      <Group title="Suavizar piel" active={(fx.skin ?? 0) > 0}>
        <Slider c={c} k="skin" label="Fuerza" min={0} max={100} />
        <p className="fx-hint">Suaviza solo los tonos de piel y conserva bordes y detalle.</p>
      </Group>

      <Group title="Sombra de color" active={layer.shadow}>
        <p className="fx-hint">Proyecta una sombra con el color medio de la imagen (ajústala luego en Sombra).</p>
        <div className="fx-row">
          <button onClick={colorShadow} disabled={busy}>
            Aplicar sombra de color
          </button>
          <button onClick={() => updateLayer(layer.id, { shadow: false })} disabled={!layer.shadow}>
            Quitar sombra
          </button>
        </div>
      </Group>
    </div>
  );
}
