// Sección «FFmpeg» de Ajustes (solo escritorio). Desde v0.9.1 el instalador de
// Windows x64 incluye el build propio de FFmpeg (LGPL-2.1-or-later, DLL compartidas,
// fuente en el Release propio): se muestra la versión, la licencia que declara el
// binario, el enlace a la fuente y el estado de la copia propia. En macOS/Linux no
// hay FFmpeg: se dice «no disponible en esta plataforma», sin URL, hash ni carpeta.
import { useEffect, useState } from 'react';
import { externalClick } from '../../io/openExternal';
import { isNativeDesktop, nativeStatus } from './bridge';
import type { NativeStatus } from './types';

/** Texto para el usuario cuando esta plataforma no trae FFmpeg nativo (web, Android, macOS, Linux). */
export const FFMPEG_NOT_AVAILABLE = 'La conversión con FFmpeg nativo no está disponible en esta plataforma.';

/**
 * Por qué no hay FFmpeg nativo, dicho con honestidad: sin estado (web/Android) o sin
 * build incluido → «no disponible en esta plataforma»; con build incluido pero sin poder
 * usarlo (copia dañada, instalador sin FFmpeg…) → el motivo real. `null` si está disponible.
 */
export function unavailableText(s: NativeStatus | null): string | null {
  if (!s || !s.included) return FFMPEG_NOT_AVAILABLE;
  if (s.available) return null;
  const why = (s.reason ?? '').trim().replace(/\.$/, '');
  return why ? `FFmpeg no se puede usar ahora: ${why}.` : 'FFmpeg no se puede usar ahora.';
}

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
    const line = s.included ? installLine(s) : null;
    return (
      <div className="settings-section" data-testid="ffmpeg-license">
        <span className="settings-label">FFmpeg</span>
        <p className="support-desc" data-testid="ffmpeg-not-included">
          {unavailableText(s)} Los videos que ChamVa no abre se pueden convertir a MP4 (H.264) con otro programa. El resto de ChamVa funciona igual.
        </p>
        {line && <p className="support-desc" data-testid="ffmpeg-install">{line}</p>}
      </div>
    );
  }
  const ver = s.version?.replace(/^ffmpeg version /, '').split(' ')[0] ?? s.pinnedVersion;
  const line = installLine(s);
  return (
    <div className="settings-section" data-testid="ffmpeg-license">
      <span className="settings-label">FFmpeg (componente de terceros)</span>
      <p className="support-desc">
        ChamVa usa FFmpeg {ver} para convertir video: un programa aparte (no enlazado con ChamVa), con su propia licencia{s.license ? ` (declara ${s.license})` : ''}. Sus bibliotecas son DLL compartidas que se pueden sustituir; las licencias de cada una van en la carpeta ffmpeg-licenses del programa.
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
