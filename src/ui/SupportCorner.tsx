import { AUTHOR, SUPPORT } from '../branding';
import { externalClick } from '../io/openExternal';
import { t } from '../i18n';
import catUrl from '../assets/sad-cat.png';

export function SupportCorner({ hasLicense }: { hasLicense: boolean }) {
  return (
    <div className="support-corner">
      <img className="support-corner-cat" src={catUrl} alt="" aria-hidden="true" draggable={false} />
      <div className="support-corner-links">
        <a href={AUTHOR.repo} onClick={externalClick} title={AUTHOR.repo}>
          ⭐ {t('Dale una estrella en GitHub')}
        </a>
        {/* Con licencia no se vuelve a pedir dinero; la estrella sí queda. */}
        {!hasLicense && (
          <a href={SUPPORT.sponsors} onClick={externalClick} title="GitHub Sponsors · Nequi · PayPal" className="coffee">
            ☕ {t('Invítame un café')}
          </a>
        )}
      </div>
    </div>
  );
}
