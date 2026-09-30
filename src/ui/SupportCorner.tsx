import { AUTHOR, SUPPORT } from '../branding';
import { externalClick } from '../io/openExternal';
import { t } from '../i18n';

// Muñequito propio (no el Octocat: las normas de marca de GitHub no permiten
// animar ni modificar su logo).
function DancingBuddy() {
  return (
    <svg className="buddy" viewBox="0 0 64 80" width="62" height="78" aria-hidden="true">
      <g className="buddy-body">
        <line className="buddy-arm-l" x1="32" y1="40" x2="14" y2="30" />
        <line className="buddy-arm-r" x1="32" y1="40" x2="50" y2="30" />
        <line className="buddy-leg-l" x1="32" y1="56" x2="22" y2="74" />
        <line className="buddy-leg-r" x1="32" y1="56" x2="42" y2="74" />
        <rect x="22" y="34" width="20" height="24" rx="9" fill="var(--accent)" stroke="none" />
        <circle cx="32" cy="20" r="13" fill="#ffd9a8" stroke="none" />
        <circle cx="27" cy="18" r="2" fill="#222" stroke="none" />
        <circle cx="37" cy="18" r="2" fill="#222" stroke="none" />
        <path d="M26 24 Q32 29 38 24" fill="none" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function SupportCorner({ hasLicense }: { hasLicense: boolean }) {
  return (
    <div className="support-corner">
      <DancingBuddy />
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
