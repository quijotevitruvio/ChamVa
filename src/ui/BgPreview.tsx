import { useRef, useState } from 'react';
import type { EdgeMode } from '../ai/bgcore';
import { t } from '../i18n';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';

// Vista previa del recorte: antes/después sobre tablero, cambiar el modo de
// bordes y reprocesar, o pasar al pincel para retocar a mano.
export function BgPreview({
  original,
  result,
  edges,
  busy,
  engineLabel,
  onEdgesChange,
  onUse,
  onRefine,
  onCancel,
}: {
  original: string;
  result: string;
  edges: EdgeMode;
  busy: boolean;
  engineLabel?: string;
  onEdgesChange: (m: EdgeMode) => void;
  onUse: () => void;
  onRefine: () => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onCancel, busy });
  const [showOriginal, setShowOriginal] = useState(false);
  const [dark, setDark] = useState(false);
  return (
    <div className="donate-overlay" onClick={() => !busy && onCancel()}>
      <div className="bgp-card" ref={cardRef} aria-label={t('Resultado del recorte')} onClick={(e) => e.stopPropagation()}>
        <div className="bgp-head">
          <h3>✂ {t('Resultado del recorte')}</h3>
          <CloseButton onClick={onCancel} />
          <div className="row">
            <button
              className={!showOriginal ? 'active' : ''}
              onPointerDown={() => setShowOriginal(true)}
              onPointerUp={() => setShowOriginal(false)}
              onPointerLeave={() => setShowOriginal(false)}
              title="Mantén pulsado para ver el original"
            >
              👁 {t('Ver original')}
            </button>
            <button onClick={() => setDark((d) => !d)} title="Fondo de prueba">
              {dark ? '⬜' : '⬛'}
            </button>
          </div>
        </div>
        <div className={`bgp-stage ${dark ? 'dark' : ''}`}>
          <img src={showOriginal ? original : result} alt="" />
          {busy && <div className="bgp-busy">…</div>}
        </div>
        <div className="bgp-foot">
          {engineLabel && <span className="dl-hint">{engineLabel}</span>}
          <label className="dl-row">
            {t('Bordes')}
            <select
              value={edges}
              disabled={busy}
              onChange={(e) => onEdgesChange(e.target.value as EdgeMode)}
            >
              <option value="auto">{t('Automático')}</option>
              <option value="photo">{t('Foto (suave)')}</option>
              <option value="graphic">{t('Logo / texto (nítido)')}</option>
              <option value="none">{t('Sin refinar')}</option>
            </select>
          </label>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>
            ✕ {t('Cancelar')}
          </button>
          <button onClick={onRefine} disabled={busy}>
            🪄 {t('Retocar con pincel')}
          </button>
          <button className="primary" onClick={onUse} disabled={busy}>
            ✓ {t('Usar recorte')}
          </button>
        </div>
      </div>
    </div>
  );
}
