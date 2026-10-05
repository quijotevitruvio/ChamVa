// Sección «FFmpeg» de Ajustes (solo escritorio). v0.9.0 no incluye FFmpeg (el
// build BtbN se descartó por licencias mixtas): se dice tal cual, sin URL, hash
// ni carpeta para instalarlo a mano. Si algún día hay un build incluido, se
// muestra la versión, la licencia que declara y el estado de la copia propia.
import { useEffect, useState } from 'react';
import { externalClick } from '../../io/openExternal';
import { isNativeDesktop, nativeStatus } from './bridge';
import type { NativeStatus } from './types';

/** Texto para el usuario cuando esta versión no trae FFmpeg nativo. */
export const FFMPEG_NOT_INCLUDED = 'La conversión con FFmpeg nativo no está incluida en esta versión; llegará en una próxima actualización.';

export function installLine(s: NativeStatus): string | null {
  const i = s.install;
  if (!i) return null;
  switch (i.action) {
    case 'skipped':
      return 'Copia verificada: misma versión, no se copió nada.';
    case 'installed':
      return 'Copia preparada desde el instalador (SHA-256 verificado).';
    case 'repaired':
      return `Copia reparada desde el instalador${i.detail ? ` (${i.detail.replace(/^se reparó la copia de FFmpeg: /, '')})` : ''}.`;
    case 'failed':
      return `No se pudo preparar la copia propia${i.detail ? `: ${i.detail}` : ''}.`;
    default:
      return null;
  }
}

export function FfmpegLicenseSection() {
  const [s, setS] = useState<NativeStatus | null>(null);
  const [showLicense, setShowLicense] = useState(false);
  useEffect(() => {
    let alive = true;
    nativeStatus().then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  if (!isNativeDesktop() || !s) return null;
  if (!s.included || !s.available) {
    return (
      <div className="settings-section" data-testid="ffmpeg-license">
        <span className="settings-label">FFmpeg</span>
        <p className="support-desc" data-testid="ffmpeg-not-included">
          {FFMPEG_NOT_INCLUDED} Mientras tanto, los videos que ChamVa no abre se pueden convertir a MP4 (H.264) con otro programa. El resto de ChamVa funciona igual.
        </p>
      </div>
    );
  }
  const ver = s.version?.replace(/^ffmpeg version /, '').split(' ')[0] ?? s.pinnedVersion;
  const line = installLine(s);
  return (
    <div className="settings-section" data-testid="ffmpeg-license">
      <span className="settings-label">FFmpeg (componente de terceros)</span>
      <p className="support-desc">
        ChamVa usa FFmpeg {ver} para convertir video: un programa aparte, con su propia licencia{s.license ? ` (declara ${s.license})` : ''}.
      </p>
      {line && <p className="support-desc" data-testid="ffmpeg-install">{line}</p>}
      {s.sourceReleaseUrl && (
        <p className="support-desc">
          Código fuente completo y correspondiente y binario exacto:{' '}
          <a href={s.sourceReleaseUrl} onClick={externalClick}>
            {s.sourceReleaseUrl}
          </a>
          .
        </p>
      )}
      {s.licenseText && (
        <>
          <button className="link-btn" onClick={() => setShowLicense((v) => !v)} aria-expanded={showLicense}>
            {showLicense ? '▾' : '▸'} Ver la licencia
          </button>
          {showLicense && (
            <pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }} data-testid="ffmpeg-license-text">
              {s.licenseText}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
