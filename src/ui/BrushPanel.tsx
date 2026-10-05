import { useEffect, useRef } from 'react';
import { BRUSHES, SIZE_MAX, SIZE_MIN, drawStroke, samplePoints } from '../editor/core/brush';
import type { BrushStyle } from '../editor/core/types';
import { useBrush } from '../editor/state/brushStore';
import { useTool } from '../editor/state/toolStore';
import { useEditor } from '../editor/state/store';
import { toHex6 } from '../editor/core/gradients';
import { t } from '../i18n';
import './brush.css';

const PW = 120;
const PH = 40;

// Dibuja un trazo de muestra con el pincel `style` (la misma geometría que el lienzo y la exportación).
function drawSample(cv: HTMLCanvasElement, style: BrushStyle, size: number, color: string, opacity: number, w = PW, h = PH) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = opacity;
  drawStroke(ctx, { brush: style, size, pts: samplePoints(w, h), seed: 7, color });
}

function Tile({ id, label, desc, size, color, current, onPick }: { id: BrushStyle; label: string; desc: string; size: number; color: string; current: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSample(ref.current, id, Math.min(18, size), color, 1);
  }, [id, size, color]);
  return (
    <button className="brush-tile" aria-pressed={current} title={t(desc)} onClick={onPick}>
      <canvas ref={ref} aria-hidden />
      <span>{t(label)}</span>
    </button>
  );
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="brush-slider">
      <span>{t(label)}</span>
      <output>
        {Math.round(value)}
        {unit}
      </output>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

// Atajos: [ ] = tamaño (B / E / Esc están en el registro de atajos y toolStore). Se monta una sola vez (riel).
export function BrushShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !(el instanceof HTMLInputElement && el.type === 'range')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const b = useBrush.getState();
      const k = e.key;
      // B / E / Esc los gestiona el registro de atajos y toolStore (herramienta única).
      if (k === '[' || k === ']') {
        e.preventDefault();
        const step = b.size < 10 ? 1 : b.size < 40 ? 2 : 5;
        b.setSize(b.size + (k === ']' ? step : -step));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

export function BrushPanel() {
  const store = useBrush();
  const curTool = useTool((s) => s.tool);
  // El estado «activo» y «herramienta» viven en toolStore; aquí se leen como antes.
  const b = { ...store, active: curTool === 'brush' || curTool === 'eraser', tool: (curTool === 'eraser' ? 'eraser' : 'brush') as 'brush' | 'eraser' };
  const preview = useRef<HTMLCanvasElement>(null);
  const recentDoc = useEditor((s) => s.doc.recentColors);
  const recentApp = useEditor((s) => s.recentColors);
  const brand = useEditor((s) => s.brandColors);
  const locked = useEditor((s) => !!s.doc.locked);

  useEffect(() => {
    if (preview.current) drawSample(preview.current, b.style, Math.min(b.size, 30), b.color, b.opacity, 240, 44);
  }, [b.style, b.size, b.color, b.opacity]);

  const swatches = [...new Set([...b.recent, ...(recentDoc ?? []), ...recentApp, ...brand].map(toHex6))].slice(0, 16);

  return (
    <div className="brush-panel">
      <div className="brush-mode" role="group" aria-label={t('Herramienta')}>
        <button aria-pressed={b.active && b.tool === 'brush'} onClick={() => b.setTool('brush')} title={t('Pincel (B)')}>
          {t('Pincel')} <kbd>B</kbd>
        </button>
        <button aria-pressed={b.active && b.tool === 'eraser'} onClick={() => b.setTool('eraser')} title={t('Borrador (E): borra el trazo completo que toques')}>
          {t('Borrador')} <kbd>E</kbd>
        </button>
      </div>
      {b.active && (
        <button className="primary" onClick={() => b.setActive(false)}>
          {t('Terminar de dibujar')} (Esc)
        </button>
      )}
      {locked && <p className="brush-hint">{t('Esta página está bloqueada: desbloquéala para dibujar.')}</p>}

      <div className="brush-grid" role="group" aria-label={t('Estilos de pincel')}>
        {BRUSHES.map((s) => (
          <Tile key={s.id} id={s.id} label={s.label} desc={s.desc} size={s.size} color={b.color} current={b.tool === 'brush' && b.style === s.id} onPick={() => b.setStyle(s.id)} />
        ))}
      </div>

      <canvas ref={preview} className="brush-preview-cur" style={{ width: '100%', height: 44 }} aria-label={t('Vista previa del pincel')} role="img" />

      <Slider label={b.tool === 'eraser' ? 'Tamaño del borrador' : 'Tamaño'} value={b.size} min={SIZE_MIN} max={SIZE_MAX} unit=" px" onChange={b.setSize} />
      <Slider label="Opacidad" value={Math.round(b.opacity * 100)} min={5} max={100} unit=" %" onChange={(v) => b.setOpacity(v / 100)} />
      <Slider label="Estabilizador" value={Math.round(b.smoothing * 100)} min={0} max={100} unit=" %" onChange={(v) => b.setSmoothing(v / 100)} />

      <div>
        <span className="rail-label">{t('Color')}</span>
        <div className="brush-colors">
          <input type="color" value={toHex6(b.color)} onChange={(e) => b.setColor(e.target.value)} aria-label={t('Color del pincel')} />
          {swatches.map((c) => (
            <button key={c} className="brush-sw" style={{ background: c }} aria-label={c} aria-pressed={toHex6(b.color) === c} onClick={() => b.setColor(c)} />
          ))}
        </div>
      </div>

      <p className="brush-hint">
        <kbd>B</kbd> {t('pincel')} · <kbd>E</kbd> {t('borrador')} · <kbd>[</kbd> <kbd>]</kbd> {t('tamaño')} · <kbd>Esc</kbd> {t('salir')}.
        <br />
        {t('Cada trazo es una capa: puedes moverlo, girarlo, escalarlo o borrarlo después.')}
      </p>
    </div>
  );
}
