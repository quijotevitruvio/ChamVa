import { SupportCorner } from './SupportCorner';
import { useRef, useState } from 'react';
import './homephoto.css';
import { APP_VERSION } from '../branding';
import type { SavedDesign } from '../io/designs';
import { PURPOSES } from '../editor/core/purposes';
import { Icon } from './Icon';
import { DesignFolders } from './DesignFolders';
import { t } from '../i18n';
import { SizeFields } from './SizeFields';
import { DEFAULT_DPI, type Unit } from '../editor/core/units';
import type { SizeValue } from './sizeFieldsLogic';

interface Props {
  designs: SavedDesign[];
  hasLicense: boolean;
  onNewDesign: (size: { width: number; height: number; name: string; unit?: Unit; dpi?: number }) => void;
  // Abre la foto como diseño nuevo con el lienzo a su medida (sin elegir tamaño).
  onEditPhoto: (file: File) => void;
  onContinue: () => void;
  onEditVideo: () => void;
  onOpenDesign: (d: SavedDesign) => void;
  // La biblioteca (carpetas, etiquetas, papelera) modifica la lista guardada.
  onDesignsChange: (list: SavedDesign[]) => void;
  onSettings: () => void;
}

const GROUPS = ['Redes sociales', 'Impresión', 'Trabajo'] as const;

// Pantalla de inicio: "¿Qué vas a crear?" con tamaños por caso de uso,
// diseños recientes y acceso al editor de video.
export function HomeScreen({
  designs,
  hasLicense,
  onNewDesign,
  onEditPhoto,
  onContinue,
  onEditVideo,
  onOpenDesign,
  onDesignsChange,
  onSettings,
}: Props) {
  const photoInput = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('Redes sociales');
  const [sv, setSv] = useState<SizeValue>({ width: 1080, height: 1080, unit: 'px', dpi: DEFAULT_DPI });

  return (
    <div className="home-overlay">
      <div className="home-brand">ChamVa</div>
      <div className="home-cards home-photo-row">
        <button className="home-card home-photo" onClick={() => photoInput.current?.click()}>
          <span className="home-ico">
            <Icon name="image" size={28} />
          </span>
          <span className="home-title">{t('Editar una foto')}</span>
          <span className="home-photo-hint">{t('Sin elegir medidas: el lienzo mide lo mismo que la foto')}</span>
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onEditPhoto(f);
          }}
        />
      </div>
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
              onClick={() =>
                onNewDesign({
                  width: p.width,
                  height: p.height,
                  name: p.label,
                  // Impresión: los tamaños están a 300 ppp, el diseño se piensa en cm.
                  ...(p.group === 'Impresión' ? { unit: 'cm' as Unit, dpi: 300 } : {}),
                })
              }
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
          <SizeFields value={sv} onChange={setSv} showPresets={false} compact />
          <button
            className="primary"
            onClick={() =>
              onNewDesign({
                width: sv.width,
                height: sv.height,
                name: 'Diseño sin título',
                unit: sv.unit,
                dpi: sv.dpi,
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
          <DesignFolders designs={designs} onChange={onDesignsChange} onOpen={onOpenDesign} />
        </>
      )}

      <SupportCorner hasLicense={hasLicense} />

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
