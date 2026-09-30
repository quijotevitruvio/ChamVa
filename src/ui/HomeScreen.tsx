import { useState } from 'react';
import { APP_VERSION } from '../branding';
import type { SavedDesign } from '../io/designs';
import { PURPOSES } from '../editor/core/purposes';
import { Icon } from './Icon';
import { t } from '../i18n';

interface Props {
  designs: SavedDesign[];
  hasLicense: boolean;
  onNewDesign: (size: { width: number; height: number; name: string }) => void;
  onContinue: () => void;
  onEditVideo: () => void;
  onOpenDesign: (d: SavedDesign) => void;
  onRemoveDesign: (id: string) => void;
  onSettings: () => void;
}

const GROUPS = ['Redes sociales', 'Impresión', 'Trabajo'] as const;

// Pantalla de inicio: "¿Qué vas a crear?" con tamaños por caso de uso,
// diseños recientes y acceso al editor de video.
export function HomeScreen({
  designs,
  hasLicense,
  onNewDesign,
  onContinue,
  onEditVideo,
  onOpenDesign,
  onRemoveDesign,
  onSettings,
}: Props) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('Redes sociales');
  const [cw, setCw] = useState('1080');
  const [ch, setCh] = useState('1080');

  return (
    <div className="home-overlay">
      <div className="home-brand">ChamVa</div>
      <p className="home-sub">{t('¿Qué vas a crear hoy?')}</p>

      <div className="purpose-tabs">
        {GROUPS.map((g) => (
          <button key={g} className={group === g ? 'active' : ''} onClick={() => setGroup(g)}>
            {t(g)}
          </button>
        ))}
      </div>
      <div className="purpose-grid">
        {PURPOSES.filter((p) => p.group === group).map((p) => {
          const ratio = p.width / p.height;
          const w = ratio >= 1 ? 44 : 44 * ratio;
          const h = ratio >= 1 ? 44 / ratio : 44;
          return (
            <button
              key={p.id}
              className="purpose-card"
              onClick={() => onNewDesign({ width: p.width, height: p.height, name: p.label })}
              title={`${p.label} — ${p.hint}`}
            >
              <span className="purpose-shape" style={{ width: w, height: h }}>
                {p.icon}
              </span>
              <span className="purpose-label">{p.label}</span>
              <span className="purpose-hint">{p.hint}</span>
            </button>
          );
        })}
        <div className="purpose-card purpose-custom">
          <span className="purpose-label">{t('Tamaño personalizado')}</span>
          <span className="custom-size">
            <input type="number" min={1} value={cw} onChange={(e) => setCw(e.target.value)} aria-label="Ancho" />
            ×
            <input type="number" min={1} value={ch} onChange={(e) => setCh(e.target.value)} aria-label="Alto" />
          </span>
          <button
            className="primary"
            onClick={() =>
              onNewDesign({
                width: Math.max(1, Math.round(Number(cw) || 1080)),
                height: Math.max(1, Math.round(Number(ch) || 1080)),
                name: 'Diseño sin título',
              })
            }
          >
            {t('Crear')}
          </button>
        </div>
      </div>

      <div className="home-cards small">
        <button className="home-card" onClick={onContinue}>
          <span className="home-ico">
            <Icon name="layers" size={28} />
          </span>
          <span className="home-title">{t('Seguir con el último diseño')}</span>
        </button>
        <button className="home-card" onClick={onEditVideo}>
          <span className="home-ico">
            <Icon name="video" size={28} />
          </span>
          <span className="home-title">{t('Editar video')}</span>
        </button>
      </div>

      {designs.length > 0 && (
        <>
          <p className="home-sub" style={{ marginTop: 20 }}>
            {t('Diseños recientes')}
          </p>
          <div className="home-designs">
            {designs.map((d) => (
              <div
                key={d.id}
                className="home-design"
                onClick={() => onOpenDesign(d)}
                title={`${d.name} — ${new Date(d.updatedAt).toLocaleString()}`}
              >
                <img src={d.thumb} alt={d.name} />
                <span className="home-design-name">{d.name}</span>
                <button
                  className="upload-del"
                  title="Quitar de recientes"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveDesign(d.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="home-foot">
        {hasLicense && <span className="supporter-badge sm">★ Donante</span>}
        <button className="link-btn" onClick={onSettings}>
          ⚙ {t('Ajustes y licencia')}
        </button>
        <span className="home-version">v{APP_VERSION}</span>
      </div>
    </div>
  );
}
