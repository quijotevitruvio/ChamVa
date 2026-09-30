import { APP_VERSION } from '../branding';
import type { SavedDesign } from '../io/designs';
import { Icon } from './Icon';
import { t } from '../i18n';

interface Props {
  designs: SavedDesign[];
  hasLicense: boolean;
  onNewDesign: () => void;
  onEditImages: () => void;
  onEditVideo: () => void;
  onOpenDesign: (d: SavedDesign) => void;
  onRemoveDesign: (id: string) => void;
  onSettings: () => void;
}

// Pantalla de inicio: acciones principales + galería de diseños recientes.
export function HomeScreen({
  designs,
  hasLicense,
  onNewDesign,
  onEditImages,
  onEditVideo,
  onOpenDesign,
  onRemoveDesign,
  onSettings,
}: Props) {
  return (
    <div className="home-overlay">
      <div className="home-brand">ChamVa</div>
      <p className="home-sub">{t('¿Qué quieres editar hoy?')}</p>
      <div className="home-cards">
        <button className="home-card" onClick={onNewDesign}>
          <span className="home-ico">
            <Icon name="image" size={48} />
          </span>
          <span className="home-title">{t('Nuevo diseño')}</span>
          <span className="home-desc">{t('Diseños, fotos, texto, formas, quitar fondo…')}</span>
        </button>
        <button className="home-card" onClick={onEditImages}>
          <span className="home-ico">
            <Icon name="layers" size={48} />
          </span>
          <span className="home-title">{t('Editar imágenes')}</span>
          <span className="home-desc">{t('Diseños, fotos, texto, formas, quitar fondo…')}</span>
        </button>
        <button className="home-card" onClick={onEditVideo}>
          <span className="home-ico">
            <Icon name="video" size={48} />
          </span>
          <span className="home-title">{t('Editar video')}</span>
          <span className="home-desc">{t('Recortar, audio, efectos de voz, exportar MP4…')}</span>
        </button>
      </div>

      {designs.length > 0 && (
        <>
          <p className="home-sub" style={{ marginTop: 28 }}>
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
