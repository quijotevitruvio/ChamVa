import type { UpdateInfo } from '../updater';
import { t } from '../i18n';

export function UpdateBanner({
  update,
  pct,
  onInstall,
  onDismiss,
}: {
  update: UpdateInfo;
  pct: number | null;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="update-banner">
      <span>
        🎉 {t('Nueva versión disponible')}: <b>v{update.version}</b>
      </span>
      <span className="spacer" />
      {pct === null ? (
        <>
          <button className="primary" onClick={onInstall}>
            ⬇ {t('Actualizar ahora')}
          </button>
          <button onClick={onDismiss}>{t('Más tarde')}</button>
        </>
      ) : (
        <>
          <span>
            {t('Descargando actualización')}… {Math.round(pct * 100)}%
          </span>
          <div className="update-progress">
            <div style={{ width: `${pct * 100}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
