import { useEffect, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/state/store';
import type { TextHighlight, TextLayer, TextOutline } from '../editor/core/types';
import { HIGHLIGHT_DEFAULT_THICKNESS, MAX_EXTRUDE_DEPTH, MAX_OUTLINES, hasExtrude, hasHighlight, hasImageFill, hasInk, hasOutlines, hasPathText } from '../editor/core/textFx';
import { getThumb } from '../io/thumbs';
import { PathTextEditor } from './PathTextEditor';
import { toast } from './toast';
import './textfx.css';

// Efectos de texto avanzados (Propiedades → Texto → Más opciones → Efectos de texto):
// relleno con imagen, sombra larga / extrusión 3D, contornos múltiples, tinta
// desgastada, resaltador y texto sobre trazado. La lógica está en editor/core/textFx.ts.

type Upload = { id: string; src: string; naturalWidth: number; naturalHeight: number; name: string };

function Thumb({ u, onPick }: { u: Upload; onPick: () => void }) {
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
    <button className="tx-thumb" onClick={onPick} title={u.name} aria-label={`Usar ${u.name} como relleno`}>
      {src && <img src={src} alt="" draggable={false} />}
    </button>
  );
}

// Reduce la imagen a ≤ 800 px conservando la transparencia (se guarda dentro de la capa).
function shrinkForFill(src: string, maxSide = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      const k = Math.min(1, maxSide / Math.max(el.naturalWidth, el.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(el.naturalWidth * k));
      c.height = Math.max(1, Math.round(el.naturalHeight * k));
      c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/webp', 0.9));
    };
    el.onerror = () => reject(new Error('carga'));
    el.src = src;
  });
}

function Group({ title, active, children }: { title: string; active: boolean; children: ReactNode }) {
  return (
    <details className="tx-group">
      <summary>
        {title}
        {active ? ' •' : ''}
      </summary>
      <div className="tx-body">{children}</div>
    </details>
  );
}

function Seg<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="seg tx-seg">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function TextEffectsPlus({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const uploads = useEditor((s) => s.uploads) as Upload[];
  const [busy, setBusy] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const id = layer.id;

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, shown?: string) => (
    <label className="prop">
      {label}: {shown ?? (step >= 1 ? Math.round(value) : value.toFixed(2))}
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={checkpoint} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
  const colorRow = (label: string, value: string, onChange: (c: string) => void) => (
    <div className="row text-row">
      <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  // ---- Relleno con imagen ----
  const fill = layer.imageFill;
  const pickFill = async (src: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const small = await shrinkForFill(src);
      updateLayer(id, { imageFill: { src: small, fit: fill?.fit ?? 'cover', scale: fill?.scale ?? 1, x: fill?.x ?? 0, y: fill?.y ?? 0 } });
    } catch {
      toast('No se pudo usar esa imagen.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const setFill = (patch: Partial<NonNullable<TextLayer['imageFill']>>) => updateLayerLive(id, { imageFill: { ...fill!, ...patch } });

  // ---- Extrusión ----
  const ex = layer.extrude;
  const exMode = hasExtrude(layer) ? ex!.mode : 'none';
  const setExtrudeMode = (m: 'none' | 'long' | 'solid') => {
    if (m === 'none') return updateLayer(id, { extrude: undefined });
    updateLayer(id, {
      extrude: { depth: ex?.depth || 40, angle: ex?.angle ?? 45, color: ex?.color ?? (m === 'long' ? '#000000' : '#555555'), mode: m },
    });
  };
  const setExtrude = (patch: Partial<NonNullable<TextLayer['extrude']>>) => updateLayerLive(id, { extrude: { ...ex!, ...patch } });

  // ---- Contornos múltiples ----
  const outlines = layer.outlines ?? [];
  const setOutlines = (list: TextOutline[], live = false) => (live ? updateLayerLive : updateLayer)(id, { outlines: list.length ? list : undefined });

  // ---- Tinta ----
  const ink = layer.inkTexture;

  // ---- Resaltador ----
  const hl = layer.highlight;
  const hlMode = hl ? hl.mode : 'none';
  const setHlMode = (m: 'none' | TextHighlight['mode']) => {
    if (m === 'none') return updateLayer(id, { highlight: undefined });
    updateLayer(id, {
      highlight: {
        color: hl?.color ?? '#ffe600',
        opacity: hl?.opacity ?? 0.6,
        mode: m,
        thickness: hl && hl.mode === m ? hl.thickness : HIGHLIGHT_DEFAULT_THICKNESS[m],
      },
    });
  };
  const setHl = (patch: Partial<TextHighlight>, live = true) => (live ? updateLayerLive : updateLayer)(id, { highlight: { ...hl!, ...patch } });

  return (
    <div className="tx">
      <Group title="Relleno con imagen" active={hasImageFill(layer)}>
        {uploads.length === 0 ? (
          <p className="tx-hint">Sube imágenes a la galería (pestaña Subidos) para rellenar el texto con ellas.</p>
        ) : (
          <div className="tx-thumbs" aria-busy={busy}>
            {uploads.map((u) => (
              <Thumb key={u.id} u={u} onPick={() => pickFill(u.src)} />
            ))}
          </div>
        )}
        {fill && (
          <>
            <Seg
              value={fill.fit}
              options={[
                ['cover', 'Cubrir'],
                ['tile', 'Mosaico'],
              ]}
              onPick={(v) => updateLayer(id, { imageFill: { ...fill, fit: v } })}
            />
            {slider('Escala', fill.scale, 0.1, 4, 0.05, (v) => setFill({ scale: v }))}
            {slider('Desplazar X', fill.x, -500, 500, 1, (v) => setFill({ x: v }))}
            {slider('Desplazar Y', fill.y, -500, 500, 1, (v) => setFill({ y: v }))}
            <button onClick={() => updateLayer(id, { imageFill: undefined })}>Quitar imagen</button>
          </>
        )}
      </Group>

      <Group title="Sombra larga y extrusión 3D" active={hasExtrude(layer)}>
        <Seg
          value={exMode}
          options={[
            ['none', 'Ninguna'],
            ['long', 'Sombra larga'],
            ['solid', 'Extrusión'],
          ]}
          onPick={setExtrudeMode}
        />
        {hasExtrude(layer) && (
          <>
            {slider('Profundidad', ex!.depth, 1, MAX_EXTRUDE_DEPTH, 1, (v) => setExtrude({ depth: v }), `${Math.round(ex!.depth)} px`)}
            {slider('Ángulo', ex!.angle, 0, 360, 1, (v) => setExtrude({ angle: v }), `${Math.round(ex!.angle)}°`)}
            {colorRow('Color', ex!.color, (c) => updateLayer(id, { extrude: { ...ex!, color: c } }))}
          </>
        )}
      </Group>

      <Group title="Contornos múltiples" active={hasOutlines(layer)}>
        <p className="tx-hint">Anillos concéntricos, del interior al exterior (hasta {MAX_OUTLINES}).</p>
        {outlines.map((o, i) => (
          <div className="tx-ring" key={i}>
            <input
              type="color"
              value={o.color}
              aria-label={`Color del contorno ${i + 1}`}
              onChange={(e) => setOutlines(outlines.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
            />
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={o.width}
              aria-label={`Grosor del contorno ${i + 1}`}
              onPointerDown={checkpoint}
              onChange={(e) => setOutlines(outlines.map((x, j) => (j === i ? { ...x, width: Number(e.target.value) } : x)), true)}
            />
            <span className="tx-num">{Math.round(o.width)}</span>
            <button title="Quitar contorno" aria-label={`Quitar contorno ${i + 1}`} onClick={() => setOutlines(outlines.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button disabled={outlines.length >= MAX_OUTLINES} onClick={() => setOutlines([...outlines, { color: outlines.length % 2 ? '#000000' : '#ffffff', width: 4 }])}>
          Añadir contorno
        </button>
      </Group>

      <Group title="Tinta desgastada" active={hasInk(layer)}>
        {slider('Desgaste', (ink?.amount ?? 0) * 100, 0, 100, 1, (v) => updateLayerLive(id, { inkTexture: v > 0 ? { amount: v / 100, seed: ink?.seed ?? 1 } : undefined }), `${Math.round((ink?.amount ?? 0) * 100)} %`)}
        {ink && slider('Variante', ink.seed, 1, 99, 1, (v) => updateLayerLive(id, { inkTexture: { ...ink, seed: v } }))}
      </Group>

      <Group title="Resaltador" active={hasHighlight(layer)}>
        <Seg
          value={hlMode}
          options={[
            ['none', 'Ninguno'],
            ['marker', 'Marcador'],
            ['underline', 'Subrayado'],
            ['strike', 'Tachado'],
          ]}
          onPick={setHlMode}
        />
        {hl && (
          <>
            {colorRow('Color', hl.color, (c) => setHl({ color: c }, false))}
            {slider('Opacidad', hl.opacity, 0.1, 1, 0.05, (v) => setHl({ opacity: v }))}
            {slider('Grosor', hl.thickness, 0.05, 1.2, 0.01, (v) => setHl({ thickness: v }))}
            <p className="tx-hint">Se aplica a todo el texto (solo en texto recto).</p>
          </>
        )}
      </Group>

      <Group title="Texto sobre trazado" active={hasPathText(layer)}>
        <p className="tx-hint">El texto (primera línea) sigue una curva Bézier que ajustas en un editor aparte.</p>
        <div className="row">
          <button onClick={() => setPathOpen(true)}>{hasPathText(layer) ? 'Editar trazado…' : 'Crear trazado…'}</button>
          {hasPathText(layer) && <button onClick={() => updateLayer(id, { pathText: undefined })}>Quitar trazado</button>}
        </div>
        {hasPathText(layer) &&
          slider('Inicio sobre el trazado', layer.pathText!.offset ?? 0, -400, 1200, 1, (v) => updateLayerLive(id, { pathText: { ...layer.pathText!, offset: v } }), `${Math.round(layer.pathText!.offset ?? 0)} px`)}
      </Group>

      {pathOpen && <PathTextEditor layer={layer} onClose={() => setPathOpen(false)} />}
    </div>
  );
}
