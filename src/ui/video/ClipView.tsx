import { memo, type CSSProperties } from 'react';
import type { Clip, MediaAsset, TrackKind } from '../../video/model';
import { clipDuration } from '../../video/model';
import type { Strip, Waveform } from './mediaCache';

export const fmtDur = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return sec < 10 && m === 0 ? `${sec.toFixed(1)} s` : `${m}:${Math.floor(sec).toString().padStart(2, '0')}`;
};

interface Props {
  clip: Clip;
  trackKind: TrackKind;
  locked: boolean;
  selected: boolean;
  pps: number;
  /** fin que se dibuja (los «hasta el final» llegan al final del proyecto) */
  end: number;
  media?: MediaAsset;
  strip?: Strip;
  wave?: Waveform;
  /** el clip se está arrastrando o recortando */
  active: boolean;
}

const KIND_LABEL: Record<Clip['kind'], string> = { video: 'Video', audio: 'Audio', image: 'Imagen', text: 'Texto', subtitle: 'Subtítulo' };

/** Un bloque de la línea de tiempo. Memoizado: al hacer scroll o arrastrar otro clip no se repinta. */
export const ClipView = memo(function ClipView({ clip, locked, selected, pps, end, media, strip, wave, active }: Props) {
  const left = clip.start * pps;
  const width = Math.max(2, (end - clip.start) * pps);
  const style: CSSProperties = { left, width };
  const name = clip.kind === 'text' || clip.kind === 'subtitle' ? ((clip.text ?? '').replace(/\s*\n\s*/g, ' ') || KIND_LABEL[clip.kind]) : (clip.name ?? media?.name ?? KIND_LABEL[clip.kind]);
  const speed = clip.speed || 1;

  let bg: CSSProperties | undefined;
  if (clip.kind === 'video') {
    if (strip && media && media.duration > 0) {
      // la tira cubre todo el medio: se muestra solo el tramo recortado
      bg = {
        backgroundImage: `url(${strip.url})`,
        backgroundSize: `${(media.duration * pps) / speed}px 100%`,
        backgroundPosition: `${-(clip.inP / speed) * pps}px 0`,
        backgroundRepeat: 'no-repeat',
      };
    } else if (media?.thumb) {
      bg = { backgroundImage: `url(${media.thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' };
    }
  }
  let waveSvg = null;
  if (clip.kind === 'audio' && wave && media && media.duration > 0) {
    const x0 = (clip.inP / media.duration) * wave.bins;
    const w = Math.max(1, ((clip.outP - clip.inP) / media.duration) * wave.bins);
    waveSvg = (
      <svg className="vx-wave" viewBox={`${x0} 0 ${w} 24`} preserveAspectRatio="none" aria-hidden="true">
        <path d={wave.path} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    );
  }
  const dur = clipDuration(clip);
  return (
    <div
      className={`vx-clip k-${clip.kind}${selected ? ' sel' : ''}${locked ? ' locked' : ''}${active ? ' active' : ''}`}
      style={style}
      data-clip={clip.id}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${KIND_LABEL[clip.kind]} ${name}, inicio ${clip.start.toFixed(1)} s, duración ${dur.toFixed(1)} s${locked ? ', pista bloqueada' : ''}`}
    >
      {bg && <div className="vx-clip-bg" style={bg} />}
      {waveSvg}
      {width > 34 && (
        <span className="vx-clip-label">
          <span className="vx-clip-name">{name}</span>
          {width > 90 && <span className="vx-clip-dur">{fmtDur(dur)}</span>}
        </span>
      )}
      {(clip.fadeIn > 0 || clip.audioFadeIn > 0) && <i className="vx-fade in" style={{ width: Math.min(width / 2, Math.max(clip.fadeIn, clip.audioFadeIn) * pps) }} />}
      {(clip.fadeOut > 0 || clip.audioFadeOut > 0) && <i className="vx-fade out" style={{ width: Math.min(width / 2, Math.max(clip.fadeOut, clip.audioFadeOut) * pps) }} />}
      {!locked && <i className="vx-trim l" data-trim="in" aria-hidden="true" />}
      {!locked && <i className="vx-trim r" data-trim="out" aria-hidden="true" />}
    </div>
  );
});
