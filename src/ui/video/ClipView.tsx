import { memo, type CSSProperties } from 'react';
import type { Clip, MediaAsset, TrackKind } from '../../video/model';
import { clipDuration } from '../../video/model';
import { averageSpeed, isTimeSpecial } from '../../video/speed/clipTime';
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
  /** ancho (px) de la cuña de una transición de ENTRADA / SALIDA de un clip suelto (las de unión las dibuja la línea de tiempo) */
  tinPx?: number;
  toutPx?: number;
  /** V9b: % calculado de los efectos de IA del clip (undefined = sin efectos de IA), si se está calculando ahora y texto largo */
  aiPct?: number;
  aiRun?: boolean;
  aiTitle?: string;
}

const KIND_LABEL: Record<Clip['kind'], string> = { video: 'Video', audio: 'Audio', image: 'Imagen', text: 'Texto', subtitle: 'Subtítulo', adjust: 'Ajuste' };

/** Un bloque de la línea de tiempo. Memoizado: al hacer scroll o arrastrar otro clip no se repinta. */
export const ClipView = memo(function ClipView({ clip, locked, selected, pps, end, media, strip, wave, active, tinPx, toutPx, aiPct, aiRun, aiTitle }: Props) {
  const left = clip.start * pps;
  const width = Math.max(2, (end - clip.start) * pps);
  const style: CSSProperties = { left, width };
  const name = clip.kind === 'text' || clip.kind === 'subtitle' ? ((clip.text ?? '').replace(/\s*\n\s*/g, ' ') || KIND_LABEL[clip.kind]) : (clip.name ?? media?.name ?? KIND_LABEL[clip.kind]);
  // V8: con curva, bucle o congelado la tira de miniaturas se reparte con la velocidad media
  const speed = isTimeSpecial(clip) && !clip.freeze ? Math.max(0.01, averageSpeed(clip)) : clip.speed || 1;

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
      aria-label={`${KIND_LABEL[clip.kind]} ${name}, inicio ${clip.start.toFixed(1)} s, duración ${dur.toFixed(1)} s${locked ? ', pista bloqueada' : ''}${aiPct !== undefined ? `, ${aiTitle}` : ''}`}
    >
      {bg && <div className="vx-clip-bg" style={bg} />}
      {waveSvg}
      {tinPx ? <i className="vx-tw in" style={{ width: Math.min(width / 2, Math.max(8, tinPx)) }} title="Transición de entrada" aria-hidden="true" /> : null}
      {toutPx ? <i className="vx-tw out" style={{ width: Math.min(width / 2, Math.max(8, toutPx)) }} title="Transición de salida" aria-hidden="true" /> : null}
      {width > 34 && (
        <span className="vx-clip-label">
          <span className="vx-clip-name">{name}</span>
          {width > 90 && <span className="vx-clip-dur">{fmtDur(dur)}</span>}
          {width > 50 && (clip.curve || clip.reverse || clip.freeze || clip.loop || (clip.speed || 1) !== 1) && <span className="vx-clip-sp" title={speedTitle(clip)}>{speedBadge(clip)}</span>}
          {width > 60 && !!clip.fx?.length && <span className="vx-clip-fx" title={`${clip.fx.length} efecto(s)`}>fx</span>}
        </span>
      )}
      {aiPct !== undefined && (
        <span className={`vx-ai${aiPct >= 100 ? ' ok' : ''}${aiRun !== undefined ? ' run' : ''}`} title={aiTitle} aria-hidden="true">
          <i style={{ width: `${aiPct}%` }} />
          {width > 96 && <b>{aiRun !== undefined ? `Calculando · ${aiPct} %` : aiPct >= 100 ? 'IA calculada 100 %' : `IA ${aiPct} %`}</b>}
        </span>
      )}
      {(clip.fadeIn > 0 || clip.audioFadeIn > 0) && <i className="vx-fade in" style={{ width: Math.min(width / 2, Math.max(clip.fadeIn, clip.audioFadeIn) * pps) }} />}
      {(clip.fadeOut > 0 || clip.audioFadeOut > 0) && <i className="vx-fade out" style={{ width: Math.min(width / 2, Math.max(clip.fadeOut, clip.audioFadeOut) * pps) }} />}
      {!locked && <i className="vx-trim l" data-trim="in" aria-hidden="true" />}
      {!locked && <i className="vx-trim r" data-trim="out" aria-hidden="true" />}
    </div>
  );
});

function speedBadge(c: Clip): string {
  if (c.freeze) return '❄';
  return `${c.reverse ? '⟲' : ''}${c.curve ? '〜' : (c.speed || 1) !== 1 ? `${Number((c.speed || 1).toFixed(2)).toString().replace('.', ',')}×` : ''}${c.loop ? '↻' : ''}`;
}
function speedTitle(c: Clip): string {
  const parts: string[] = [];
  if (c.freeze) parts.push('fotograma congelado');
  if (c.curve) parts.push('curva de velocidad');
  else if ((c.speed || 1) !== 1) parts.push(`velocidad ${c.speed}×`);
  if (c.reverse) parts.push('invertido');
  if (c.loop) parts.push('en bucle');
  return parts.join(', ');
}
