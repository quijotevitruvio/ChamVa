import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { validCrop } from '../editor/core/imageCrop';
import { create } from 'zustand';
import type Konva from 'konva';
import { useEditor } from '../editor/state/store';
import { t } from '../i18n';
import './imagegeo.css';

// Modo de vista «antes/después»: solo en pantalla, no entra en exportación ni historial.
interface BAState {
  layerId: string | null;
  open: (id: string) => void;
  close: () => void;
}
export const useBeforeAfter = create<BAState>((set) => ({
  layerId: null,
  open: (id) => set({ layerId: id }),
  close: () => set({ layerId: null }),
}));

// Barra arrastrable montada sobre el lienzo: a la izquierda se ve la imagen original
// (`originalSrc` si existe, o la imagen sin ajustes ni filtros) y a la derecha, la editada
// (la que ya dibuja Konva debajo). Sigue a la capa aunque se haga zoom o se desplace el lienzo.
export function BeforeAfterSlider({
  nodeRefs,
}: {
  nodeRefs: MutableRefObject<Map<string, Konva.Node>>;
}) {
  const layerId = useBeforeAfter((s) => s.layerId);
  const close = useBeforeAfter((s) => s.close);
  const selectedId = useEditor((s) => s.selectedId);
  const layer = useEditor((s) => s.doc.layers.find((l) => l.id === layerId));
  const [pos, setPos] = useState(0.5);
  const [m, setM] = useState<number[] | null>(null);
  const mRef = useRef<number[] | null>(null);
  const dragging = useRef(false);

  // Se cierra al cambiar de selección o al desaparecer la capa.
  useEffect(() => {
    if (layerId && (selectedId !== layerId || !layer)) close();
  }, [layerId, selectedId, layer, close]);

  useEffect(() => {
    if (!layerId) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [layerId, close]);

  // Sigue la transformación de la capa en pantalla (zoom, paneo, arrastre).
  useEffect(() => {
    if (!layerId) return;
    let raf = 0;
    const tick = () => {
      const node = nodeRefs.current.get(layerId);
      const stage = node?.getStage();
      if (node && stage) {
        const r = stage.container().getBoundingClientRect();
        const a = node.getAbsoluteTransform().getMatrix();
        const next = [a[0], a[1], a[2], a[3], a[4] + r.left, a[5] + r.top];
        const prev = mRef.current;
        if (!prev || next.some((v, i) => Math.abs(v - prev[i]) > 0.01)) {
          mRef.current = next;
          setM(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [layerId, nodeRefs]);

  if (!layerId || !layer || layer.type !== 'image' || !m) return null;
  const w = layer.naturalWidth;
  const h = layer.naturalHeight;
  const [a, b, c, d, e, f] = m;

  const move = (ev: React.PointerEvent) => {
    if (!dragging.current) return;
    const det = a * d - b * c;
    if (!det) return;
    const X = ev.clientX - e;
    const Y = ev.clientY - f;
    const lx = (d * X - c * Y) / det; // x local de la capa
    setPos(Math.min(1, Math.max(0, lx / w)));
  };

  const before = layer.originalSrc ?? layer.src;
  const crop = validCrop(layer.crop);
  const sx = Math.hypot(a, b) || 1;
  const sy = Math.hypot(c, d) || 1;
  const flip = `scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`;

  return (
    <>
      <div className="ba-root">
        <div
          className="ba-frame"
          style={{ width: w, height: h, transform: `matrix(${a},${b},${c},${d},${e},${f})` }}
        >
          <div className="ba-before" style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }}>
            {crop ? (
              // Recorte no destructivo: la imagen completa desplazada dentro del marco; el volteo
              // se aplica al trozo (como processImage).
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', transform: flip }}>
                <img
                  src={before}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    maxWidth: 'none',
                    width: w / crop.w,
                    height: h / crop.h,
                    left: (-crop.x * w) / crop.w,
                    top: (-crop.y * h) / crop.h,
                  }}
                />
              </div>
            ) : (
              <img src={before} alt="" draggable={false} style={{ transform: flip }} />
            )}
          </div>
          <div className="ba-bar" style={{ left: `${pos * 100}%` }}>
            <div className="ba-line" style={{ width: 2 / sx, left: -1 / sx }} />
            <div
              className="ba-grip"
              onPointerDown={(ev) => {
                dragging.current = true;
                (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                ev.preventDefault();
                ev.stopPropagation();
              }}
              onPointerMove={move}
              onPointerUp={() => (dragging.current = false)}
              style={{ transform: `scale(${1 / sx}, ${1 / sy})` }}
            >
              ↔
            </div>
          </div>
        </div>
      </div>
      <div className="ba-chip">
        {t('Comparando: izquierda antes, derecha después')}
        <button onClick={close}>{t('Salir')}</button>
      </div>
    </>
  );
}
