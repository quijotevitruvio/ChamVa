import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLayer } from '../editor/core/types';
import { MOCKUP_FRAMES, renderMockup, type MockupFrameId } from '../editor/core/mockups';
import { useEditor } from '../editor/state/store';
import { bakedCanvas } from './imagegeoUtil';
import { toast } from './toast';
import { t } from '../i18n';
import './imagegeo.css';

// Mockups en perspectiva: coloca la imagen seleccionada en un marco (teléfono, portátil,
// monitor, tarjeta) dibujado por código y crea una capa nueva con el resultado.
export function MockupDialog({ layer, onClose }: { layer: ImageLayer; onClose: () => void }) {
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState<MockupFrameId>('phone');
  const [yaw, setYaw] = useState(-18);
  const [pitch, setPitch] = useState(6);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [transparent, setTransparent] = useState(true);
  const [bg, setBg] = useState('#e6e6e6');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bakedCanvas(layer).then((c) => {
      if (cancelled) return;
      srcRef.current = c;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [layer]);

  const opts = (maxSide: number) => ({
    frame,
    yaw,
    pitch,
    fit,
    background: transparent ? null : bg,
    maxSide,
  });

  useEffect(() => {
    const src = srcRef.current;
    const pv = prevRef.current;
    if (!ready || !src || !pv) return;
    const out = renderMockup(src, src.width, src.height, opts(640));
    pv.width = out.width;
    pv.height = out.height;
    pv.getContext('2d')!.drawImage(out, 0, 0);
  }, [ready, frame, yaw, pitch, fit, transparent, bg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const apply = () => {
    const src = srcRef.current;
    if (!src) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const out = renderMockup(src, src.width, src.height, opts(2000));
        addImageLayer({
          src: out.toDataURL('image/png'),
          naturalWidth: out.width,
          naturalHeight: out.height,
          name: `Mockup ${MOCKUP_FRAMES.find((f) => f.id === frame)?.label ?? ''}`.trim(),
        });
        toast(t('Mockup creado como capa nueva'), 'success');
        onClose();
      } catch (e) {
        console.error(e);
        toast(t('No se pudo crear el mockup'), 'error');
        setBusy(false);
      }
    }, 20);
  };

  return createPortal(
    <div className="mask-overlay">
      <div className="mask-toolbar">
        <span className="mask-title">{t('Mockup')}</span>
        <div className="seg mock-frames">
          {MOCKUP_FRAMES.map((f) => (
            <button key={f.id} className={frame === f.id ? 'on' : ''} onClick={() => setFrame(f.id)}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={fit === 'cover' ? 'on' : ''} onClick={() => setFit('cover')}>
            {t('Rellenar')}
          </button>
          <button className={fit === 'contain' ? 'on' : ''} onClick={() => setFit('contain')}>
            {t('Ajustar')}
          </button>
        </div>
        <span className="spacer" />
        <button onClick={onClose}>{t('Cancelar')}</button>
        <button className="primary" onClick={apply} disabled={!ready || busy}>
          {busy ? '…' : t('Crear capa')}
        </button>
      </div>
      <div className="mask-toolbar">
        <div className="geo-tools">
          <span>{t('Giro')}</span>
          <input type="range" min={-60} max={60} value={yaw} onChange={(e) => setYaw(Number(e.target.value))} />
          <span>{yaw}°</span>
        </div>
        <div className="geo-tools">
          <span>{t('Inclinación')}</span>
          <input type="range" min={-40} max={40} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
          <span>{pitch}°</span>
        </div>
        <button
          onClick={() => {
            setYaw(0);
            setPitch(0);
          }}
        >
          {t('De frente')}
        </button>
        <label className="geo-check">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          {t('Fondo transparente')}
        </label>
        {!transparent && (
          <div className="mock-bgs">
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
          </div>
        )}
      </div>
      <div className="geo-stage">
        <div className="geo-pane single">
          <canvas ref={prevRef} />
        </div>
      </div>
      <p className="mask-hint">
        {t('La imagen seleccionada se coloca en el marco y el conjunto se inclina en perspectiva. Se crea una capa nueva; la original no cambia.')}
      </p>
    </div>,
    document.body,
  );
}
