import { ASPECTS, QUALITIES, type Aspect, type Container, type Quality } from '../../video/engine/formats';
import type { ExportSupport } from '../../video/engine/encoderConfig';
import type { Fit } from '../../video/engine/timeline';
import { t } from '../../i18n';
import type { AudioFormat, AudioFormatInfo } from '../../video/engine/audioExport';
import { ModelManager } from './ModelManager';
import { AiCacheManager } from './AiCacheManager';

interface Props {
  onClose: () => void;
  onNew: () => void;
  canNew: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  binOpen: boolean;
  onToggleBin: () => void;
  // edición sobre la selección
  hasSelection: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  // exportación
  canExport: boolean;
  exporting: boolean;
  progress: number;
  label: string;
  onCancel: () => void;
  onExport: (c: Container) => void;
  support: ExportSupport | null;
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  res: Quality;
  setRes: (q: Quality) => void;
  fit: Fit;
  setFit: (f: Fit) => void;
  fps: number;
  setFps: (n: number) => void;
  /** subtítulos (V4) */
  hasSubs: boolean;
  burnSubs: boolean;
  setBurnSubs: (b: boolean) => void;
  onExportSubs: (f: 'srt' | 'vtt') => void;
  /** audio (V7): exportar solo el audio */
  audioFormat: AudioFormat;
  setAudioFormat: (f: AudioFormat) => void;
  audioFormats: AudioFormatInfo[];
  audioSupport: Record<AudioFormat, boolean> | null;
  canExportAudio: boolean;
  onExportAudio: () => void;
}

export function Toolbar(p: Props) {
  const { support } = p;
  return (
    <>
      <div className="vx-toolbar" role="toolbar" aria-label="Editor de video">
        <button type="button" onClick={p.onClose} title={t('Volver al diseño')}>← <span className="vx-hide-sm">{t('Volver al diseño')}</span></button>
        <span className="vx-title vx-hide-sm">🎬 {t('Editor de video')}</span>
        <button type="button" className="vx-show-sm" onClick={p.onToggleBin} aria-pressed={p.binOpen} aria-label="Medios" title="Medios">🗂</button>
        <button type="button" onClick={p.onUndo} disabled={!p.canUndo} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↶</button>
        <button type="button" onClick={p.onRedo} disabled={!p.canRedo} title="Rehacer (Ctrl+Mayús+Z / Ctrl+Y)" aria-label="Rehacer">↷</button>
        <span className="vx-sep" aria-hidden="true" />
        <button type="button" onClick={p.onSplit} disabled={!p.canExport} title="Dividir en el cabezal (S)" aria-label="Dividir en el cabezal">✂ <span className="vx-hide-sm">Dividir</span></button>
        <button type="button" className="vx-edit-btn" onClick={p.onDuplicate} disabled={!p.hasSelection} title="Duplicar (Ctrl+D)" aria-label="Duplicar">⧉ <span className="vx-hide-sm">Duplicar</span></button>
        <button type="button" className="vx-edit-btn" onClick={p.onDelete} disabled={!p.hasSelection} title="Eliminar (Supr)" aria-label="Eliminar">🗑 <span className="vx-hide-sm">Eliminar</span></button>
        <span className="spacer" />
        <button type="button" onClick={p.onNew} disabled={!p.canNew} title="Vaciar el proyecto de video" aria-label="Nuevo proyecto">🗑 <span className="vx-hide-sm">{t('Nuevo')}</span></button>
        <details className="vx-export-opts">
          <summary aria-label="Ajustes de exportación">⚙ <span className="vx-hide-sm">Ajustes</span></summary>
          <div className="vx-pop">
            <label>
              Proporción
              <select value={p.aspect} onChange={(e) => p.setAspect(e.target.value as Aspect)} disabled={p.exporting}>
                {ASPECTS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>
            <label>
              Resolución
              <select value={p.res} onChange={(e) => p.setRes(Number(e.target.value) as Quality)} disabled={p.exporting}>
                {QUALITIES.map((q) => {
                  const no4k = q.id === 2160 && !!support && !support.mp4_4k && !support.webm_4k;
                  return (
                    <option key={q.id} value={q.id} disabled={no4k}>
                      {q.label}
                      {no4k ? ' (no disponible en este equipo)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Encaje
              <select value={p.fit} onChange={(e) => p.setFit(e.target.value as Fit)} disabled={p.exporting}>
                <option value="contain">Encajar (bandas negras)</option>
                <option value="cover">Rellenar (recorta)</option>
              </select>
            </label>
            <label>
              Cuadros por segundo
              <select value={p.fps} onChange={(e) => p.setFps(Number(e.target.value))} disabled={p.exporting}>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <label className="vx-check" title="Si lo quitas, el video sale sin subtítulos en la imagen y puedes guardarlos aparte en un archivo .srt">
              <input type="checkbox" checked={p.burnSubs} disabled={p.exporting || !p.hasSubs} onChange={(e) => p.setBurnSubs(e.target.checked)} /> Incrustar subtítulos en el video
            </label>
            <span className="vx-pop-row">
              <button type="button" onClick={() => p.onExportSubs('srt')} disabled={!p.hasSubs} title="Guardar los subtítulos en un archivo .srt aparte">⬇ .srt</button>
              <button type="button" onClick={() => p.onExportSubs('vtt')} disabled={!p.hasSubs} title="Guardar los subtítulos en un archivo .vtt aparte">⬇ .vtt</button>
            </span>
            <span className="vx-pop-row">
              <label>
                Solo audio
                <select value={p.audioFormat} onChange={(e) => p.setAudioFormat(e.target.value as AudioFormat)} disabled={p.exporting} aria-label="Formato del audio">
                  {p.audioFormats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {p.audioSupport && !p.audioSupport[f.id] ? ' (se guarda como WAV)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={p.onExportAudio} disabled={!p.canExportAudio || p.exporting} title="Exportar solo el audio de la mezcla, con la sonoridad y el limitador del proyecto">
                ⬇ Audio
              </button>
            </span>
            <ModelManager />
            <AiCacheManager />
            <button type="button" onClick={() => p.onExport('webm')} disabled={!p.canExport || p.exporting || (!!support && support.webcodecs && !support.webm)} title="Exportar a WebM (VP9 + Opus)">
              ⬇ WebM
            </button>
          </div>
        </details>
        <button
          type="button"
          className="primary"
          onClick={() => p.onExport('mp4')}
          disabled={!p.canExport || p.exporting || (!!support && support.webcodecs && !support.mp4)}
          title={support && support.webcodecs && !support.mp4 ? 'Este equipo no puede codificar H.264: usa WebM' : 'Exportar a MP4 (H.264 + AAC), sin descargas'}
        >
          {p.exporting ? '… Procesando' : '⬇ MP4'}
        </button>
        <button type="button" className="vx-hide-sm vx-close-editor" onClick={p.onClose} aria-label={t('Volver al diseño')} title={t('Volver al diseño')}>
          ✕
        </button>
      </div>
      {p.exporting && (
        <div className="vx-progress-row" role="status">
          <div className="vx-progress">
            <div className="vx-progress-fill" style={{ width: `${Math.round(p.progress * 100)}%` }} />
            <span className="vx-progress-label">
              {t('Exportando')}… {Math.round(p.progress * 100)}%{p.label ? ` · ${p.label}` : ''}
            </span>
          </div>
          <button type="button" onClick={p.onCancel} title="Cancelar la exportación">✕ Cancelar</button>
        </div>
      )}
    </>
  );
}
