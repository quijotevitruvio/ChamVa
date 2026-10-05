import { useEffect, useRef, useState } from 'react';
import type { Layer } from '../editor/core/types';
import type { LayerMask, VectorMaskShape } from '../editor/core/layerMask';
import { maskCanvasesNow, onMaskReady } from '../editor/core/maskRender';
import { useEditor } from '../editor/state/store';
import { useTool } from '../editor/state/toolStore';
import {
  addMask,
  applyMask,
  colorRangeSelect,
  copySelectionToLayer,
  deleteSelectionInLayer,
  deselectPixels,
  exportSelection,
  fillSelection,
  invertMask,
  invertPixels,
  maskToSelection,
  modifySelection,
  patchMask,
  removeMask,
  selectAllPixels,
  selectionToMask,
  toggleMaskEnabled,
  usePixelOpts,
  type AddMaskKind,
} from '../editor/state/pixelOps';
import { toast } from './toast';
import { t } from '../i18n';
import './maskpanel.css';

const run = (p: Promise<unknown> | unknown) =>
  Promise.resolve(p).catch((e) => {
    if ((e as Error)?.name !== 'AbortError') toast(String((e as Error)?.message ?? e), 'error');
  });

/** Miniatura de la máscara (blanco = visible). Clic: editar máscara/capa; Mayús+clic: activar/desactivar. */
export function MaskThumb({ layer, size = 22 }: { layer: Layer; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const editing = useEditor((s) => s.maskEditId === layer.id);
  const [v, setV] = useState(0);
  useEffect(() => onMaskReady(() => setV((n) => n + 1)), []);
  const mask = layer.mask;
  useEffect(() => {
    const c = ref.current;
    if (!c || !mask) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const mc = maskCanvasesNow(mask);
    if (mc) ctx.drawImage(mc.normal, 0, 0, c.width, c.height);
  }, [mask, v]);
  if (!mask) return null;
  const off = mask.enabled === false;
  return (
    <canvas
      ref={ref}
      width={size * 2}
      height={size * 2}
      className={`mask-thumb${editing ? ' on' : ''}${off ? ' off' : ''}`}
      style={{ width: size, height: size }}
      data-testid="mask-thumb"
      title={t('Máscara: clic para editarla (o volver a la capa); Mayús+clic la activa o desactiva')}
      onClick={(e) => {
        e.stopPropagation();
        const st = useEditor.getState();
        if (e.shiftKey) {
          toggleMaskEnabled(layer.id);
          return;
        }
        if (st.selectedId !== layer.id) st.selectLayer(layer.id);
        if (st.maskEditId === layer.id) st.setMaskEdit(null);
        else {
          st.setMaskEdit(layer.id);
          const tl = useTool.getState().tool;
          if (tl !== 'brush' && tl !== 'eraser') useTool.getState().setTool('brush');
        }
      }}
    />
  );
}

// `onStart`: punto de deshacer al empezar un gesto en vivo (los cambios en vivo no guardan historial).
function Slider({ label, min, max, step = 1, value, onChange, onStart }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; onStart?: () => void }) {
  return (
    <label className="mp-slider">
      <span>{t(label)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={onStart}
        onKeyDown={(e) => e.key.startsWith('Arrow') && onStart?.()}
      />
      <span className="mp-val">{Math.round(value * 100) / 100}</span>
    </label>
  );
}

function VectorControls({ layer, mask }: { layer: Layer; mask: LayerMask }) {
  const checkpoint = useEditor((s) => s.checkpoint);
  const sh = mask.shape!;
  const set = (patch: Partial<VectorMaskShape>) => patchMask(layer.id, { shape: { ...sh, ...patch } as VectorMaskShape }, true);
  return (
    <div className="mp-vector" onPointerDownCapture={checkpoint}>
      {(sh.type === 'ellipse' || sh.type === 'rect') && (
        <>
          <Slider label="Centro X" min={0} max={1} step={0.01} value={sh.cx} onChange={(v) => set({ cx: v })} />
          <Slider label="Centro Y" min={0} max={1} step={0.01} value={sh.cy} onChange={(v) => set({ cy: v })} />
          <Slider label="Ancho" min={0.01} max={1} step={0.01} value={sh.rx} onChange={(v) => set({ rx: v })} />
          <Slider label="Alto" min={0.01} max={1} step={0.01} value={sh.ry} onChange={(v) => set({ ry: v })} />
        </>
      )}
      {sh.type === 'linear' && (
        <>
          <Slider label="Empieza (oculto)" min={0} max={1} step={0.01} value={sh.y0} onChange={(v) => set({ y0: v })} />
          <Slider label="Termina (visible)" min={0} max={1} step={0.01} value={sh.y1} onChange={(v) => set({ y1: v })} />
          <Slider label="Inclinación" min={-1} max={1} step={0.01} value={sh.x1 - sh.x0} onChange={(v) => set({ x0: 0.5 - v / 2, x1: 0.5 + v / 2 })} />
        </>
      )}
      {sh.type === 'radial' && (
        <>
          <Slider label="Centro X" min={0} max={1} step={0.01} value={sh.cx} onChange={(v) => set({ cx: v })} />
          <Slider label="Centro Y" min={0} max={1} step={0.01} value={sh.cy} onChange={(v) => set({ cy: v })} />
          <Slider label="Radio visible" min={0} max={1} step={0.01} value={sh.r0} onChange={(v) => set({ r0: v })} />
          <Slider label="Radio oculto" min={0} max={1.5} step={0.01} value={sh.r1} onChange={(v) => set({ r1: v })} />
        </>
      )}
    </div>
  );
}

/** Sección «Máscara» del panel de propiedades. */
export function MaskPanel({ layer }: { layer: Layer }) {
  const maskEditId = useEditor((s) => s.maskEditId);
  const maskView = useEditor((s) => s.maskView);
  const setMaskEdit = useEditor((s) => s.setMaskEdit);
  const setMaskView = useEditor((s) => s.setMaskView);
  const checkpoint = useEditor((s) => s.checkpoint);
  const hasSel = useEditor((s) => !!s.pixelSel);
  const brush = usePixelOpts((s) => s.brush);
  const setBrush = usePixelOpts((s) => s.setBrush);
  const tool = useTool((s) => s.tool);
  const mask = layer.mask;
  const editing = maskEditId === layer.id;
  const add = (k: AddMaskKind) => run(addMask(k, layer.id));

  if (!mask) {
    return (
      <div className="mask-panel" data-testid="mask-panel">
        <p className="rail-sub">{t('Oculta partes de la capa sin borrarlas: blanco = visible, negro = oculto.')}</p>
        <div className="mp-grid">
          <button onClick={() => add('white')}>{t('Blanca (todo visible)')}</button>
          <button onClick={() => add('black')}>{t('Negra (todo oculto)')}</button>
          <button onClick={() => add('selection')} disabled={!hasSel} title={t('Usa la selección de la varita o el lazo')}>
            {t('Desde la selección')}
          </button>
          <button onClick={() => add('alpha')}>{t('Desde la transparencia')}</button>
          <button onClick={() => add('ellipse')}>{t('Elipse suave')}</button>
          <button onClick={() => add('rect')}>{t('Rectángulo suave')}</button>
          <button onClick={() => add('linear')}>{t('Degradado lineal')}</button>
          <button onClick={() => add('radial')}>{t('Degradado radial')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mask-panel" data-testid="mask-panel">
      <div className="mp-head">
        <MaskThumb layer={layer} size={40} />
        <div className="mp-state">
          <strong>{mask.kind === 'vector' ? t('Máscara vectorial') : t('Máscara de píxeles')}</strong>
          <span className="rail-sub">{mask.enabled === false ? t('Desactivada') : editing ? t('Editando la máscara') : t('Activa')}</span>
        </div>
      </div>
      <div className="mp-grid">
        <button
          aria-pressed={editing}
          onClick={() => {
            if (editing) setMaskEdit(null);
            else {
              setMaskEdit(layer.id);
              if (tool !== 'brush' && tool !== 'eraser') useTool.getState().setTool('brush');
            }
          }}
        >
          {editing ? t('Volver a la capa') : t('Pintar la máscara')}
        </button>
        <button aria-pressed={maskView} onClick={() => (editing ? setMaskView(!maskView) : (setMaskEdit(layer.id), setMaskView(true)))}>
          {t('Ver en rojo')}
        </button>
        <button onClick={() => toggleMaskEnabled(layer.id)}>{mask.enabled === false ? t('Activar') : t('Desactivar')}</button>
        <button onClick={() => invertMask(layer.id)}>{t('Invertir')}</button>
        <button onClick={() => run(maskToSelection(layer.id))}>{t('A selección')}</button>
        <button onClick={() => run(applyMask(layer.id))} title={t('Hornea la máscara en la capa (Ctrl+Z la recupera)')}>
          {t('Aplicar')}
        </button>
        <button className="danger" onClick={() => removeMask(layer.id)}>
          {t('Eliminar')}
        </button>
      </div>
      <Slider
        label={mask.kind === 'vector' ? 'Borde suave' : 'Desvanecer'}
        min={0}
        max={Math.max(50, Math.round(Math.max(mask.rect.w, mask.rect.h) / 8))}
        value={mask.feather ?? 0}
        onChange={(v) => patchMask(layer.id, { feather: v > 0 ? v : undefined }, true)}
        onStart={checkpoint}
      />
      {mask.kind === 'vector' && mask.shape && <VectorControls layer={layer} mask={mask} />}
      {editing && (
        <div className="mp-brush">
          <p className="rail-sub">
            {tool === 'eraser' ? t('Pintando NEGRO (ocultar).') : t('Pintando BLANCO (mostrar).')} {t('B mostrar · E ocultar · X alterna · [ ] tamaño')}
          </p>
          <div className="row">
            <button aria-pressed={tool === 'brush'} onClick={() => useTool.getState().setTool('brush')}>
              ⬜ {t('Mostrar')}
            </button>
            <button aria-pressed={tool === 'eraser'} onClick={() => useTool.getState().setTool('eraser')}>
              ⬛ {t('Ocultar')}
            </button>
          </div>
          <Slider label="Tamaño" min={1} max={600} value={brush.size} onChange={(v) => setBrush({ size: v })} />
          <Slider label="Dureza" min={0} max={1} step={0.01} value={brush.hardness} onChange={(v) => setBrush({ hardness: v })} />
          <Slider label="Opacidad" min={0.05} max={1} step={0.01} value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} />
        </div>
      )}
    </div>
  );
}

/** Opciones de la varita/lazo y acciones con la selección de píxeles. */
export function SelectionPanel() {
  const tool = useTool((s) => s.tool);
  const hasSel = useEditor((s) => !!s.pixelSel);
  const selected = useEditor((s) => s.doc.layers.find((l) => l.id === s.selectedId) ?? null);
  const o = usePixelOpts((s) => s.sel);
  const setO = usePixelOpts((s) => s.setSel);
  const [r, setR] = useState(4);
  const [fill, setFill] = useState('#000000');
  if (tool !== 'wand' && tool !== 'lasso' && !hasSel) return null;
  return (
    <div className="sel-panel" data-testid="selection-panel">
      <h4>{t('Selección de píxeles')}</h4>
      {tool === 'wand' && (
        <>
          <Slider label="Tolerancia" min={0} max={255} value={o.tolerance} onChange={(v) => setO({ tolerance: v })} />
          <label className="mp-check">
            <input type="checkbox" checked={o.contiguous} onChange={(e) => setO({ contiguous: e.target.checked })} /> {t('Contigua')}
          </label>
        </>
      )}
      {tool === 'lasso' && (
        <>
          <label className="mp-check">
            <input type="checkbox" checked={o.lassoPoly} onChange={(e) => setO({ lassoPoly: e.target.checked })} /> {t('Poligonal (clic por clic, doble clic cierra)')}
          </label>
          <label className="mp-check">
            <input type="checkbox" checked={o.lassoSmooth} onChange={(e) => setO({ lassoSmooth: e.target.checked })} /> {t('Suavizar el trazo')}
          </label>
        </>
      )}
      {(tool === 'wand' || tool === 'lasso') && (
        <>
          <label className="mp-check">
            <input type="checkbox" checked={o.antiAlias} onChange={(e) => setO({ antiAlias: e.target.checked })} /> {t('Suavizar bordes (antialias)')}
          </label>
          <label className="mp-check">
            <input type="checkbox" checked={o.sampleAll} onChange={(e) => setO({ sampleAll: e.target.checked })} /> {t('Usar todo el diseño (no solo la capa)')}
          </label>
          <p className="rail-sub">{t('Mayús suma · Alt resta · Mayús+Alt interseca')}</p>
        </>
      )}
      <div className="mp-range">
        <input type="color" value={o.rangeColor} onChange={(e) => setO({ rangeColor: e.target.value })} aria-label={t('Color del rango')} />
        <Slider label="Rango" min={1} max={255} value={o.rangeFuzz} onChange={(v) => setO({ rangeFuzz: v })} />
        <button onClick={() => run(colorRangeSelect('replace'))}>{t('Por color')}</button>
      </div>
      <div className="mp-grid">
        <button onClick={selectAllPixels}>{t('Todo')}</button>
        <button onClick={invertPixels}>{t('Invertir')}</button>
        <button onClick={deselectPixels} disabled={!hasSel}>
          {t('Quitar')}
        </button>
      </div>
      {hasSel && (
        <>
          <div className="mp-modify">
            <input type="number" min={1} max={500} value={r} onChange={(e) => setR(Math.max(1, Number(e.target.value) || 1))} aria-label={t('Píxeles')} />
            <button onClick={() => run(modifySelection('grow', r))}>{t('Expandir')}</button>
            <button onClick={() => run(modifySelection('grow', -r))}>{t('Contraer')}</button>
            <button onClick={() => run(modifySelection('smooth', r))}>{t('Suavizar')}</button>
            <button onClick={() => run(modifySelection('feather', r))}>{t('Desvanecer')}</button>
          </div>
          <div className="mp-grid">
            <button onClick={() => run(copySelectionToLayer(false))}>{t('Copiar a capa nueva')}</button>
            <button onClick={() => run(copySelectionToLayer(true))} disabled={!selected}>
              {t('Cortar a capa nueva')}
            </button>
            <button onClick={() => run(deleteSelectionInLayer())} disabled={!selected}>
              {t('Borrar (ocultar)')}
            </button>
            <button onClick={() => run(selectionToMask())} disabled={!selected}>
              {t('Convertir en máscara')}
            </button>
            <span className="mp-fill">
              <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} aria-label={t('Color de relleno')} />
              <button onClick={() => fillSelection(fill)}>{t('Rellenar')}</button>
            </span>
            <button onClick={() => run(exportSelection())}>{t('Exportar selección')}</button>
          </div>
        </>
      )}
    </div>
  );
}
