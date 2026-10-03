import { useRef, useSyncExternalStore } from 'react';
import * as VM from '../../video/model';
import { fmtDur } from './ClipView';
import type { MediaCache } from './mediaCache';
import { MEDIA_MIME } from './Timeline';

interface Props {
  project: VM.VideoProject;
  cache: MediaCache;
  recording: boolean;
  onImport: (files: File[]) => void;
  onAdd: (mediaId: string) => void;
  onRemove: (mediaId: string) => void;
  onAddText: () => void;
  onToggleRecord: () => void;
}

const ICON = { video: '🎬', audio: '🎵', image: '🖼' } as const;

/** Panel de medios: importar, ver lo importado y arrastrarlo a la línea de tiempo. */
export function MediaBin({ project, cache, recording, onImport, onAdd, onRemove, onAddText, onToggleRecord }: Props) {
  useSyncExternalStore(cache.subscribe, cache.getVersion);
  const file = useRef<HTMLInputElement>(null);
  const used = VM.usedMediaIds(project);
  const items = Object.values(project.media);
  return (
    <aside className="vx-bin" aria-label="Medios">
      <div className="vx-bin-head">
        <button type="button" className="primary" onClick={() => file.current?.click()}>＋ Importar</button>
        <button type="button" onClick={onAddText}>🅣 Texto</button>
        <button type="button" className={recording ? 'on' : ''} aria-pressed={recording} onClick={onToggleRecord}>{recording ? '⏹ Detener' : '🎤 Grabar'}</button>
        <input
          ref={file}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onImport([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>
      <div
        className="vx-bin-list"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          onImport([...e.dataTransfer.files]);
        }}
      >
        {items.length === 0 && <p className="vx-note">Aún no hay medios. Importa archivos o suéltalos aquí; luego arrástralos a la línea de tiempo.</p>}
        {items.map((m) => {
          const strip = cache.stripOf(m.id);
          const url = m.kind === 'image' ? cache.urlOf(m) : '';
          return (
            <div
              key={m.id}
              className={`vx-media k-${m.kind}${m.missing ? ' missing' : ''}`}
              draggable={!m.missing}
              onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_MIME, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="vx-media-thumb" aria-hidden="true">
                {m.kind === 'image' && url ? (
                  <img src={url} alt="" draggable={false} />
                ) : m.kind === 'video' && (strip || m.thumb) ? (
                  <div className="vx-media-img" style={strip ? { backgroundImage: `url(${strip.url})`, backgroundSize: `${strip.frames * 100}% 100%` } : { backgroundImage: `url(${m.thumb})`, backgroundSize: 'cover' }} />
                ) : (
                  <span>{ICON[m.kind]}</span>
                )}
              </div>
              <div className="vx-media-info">
                <span className="vx-media-name" title={m.name}>{m.name}</span>
                <span className="vx-media-meta">
                  {ICON[m.kind]} {m.kind === 'image' ? 'Imagen' : fmtDur(m.duration)}
                  {m.missing ? ' · falta el archivo' : ''}
                </span>
              </div>
              <button type="button" className="mini" onClick={() => onAdd(m.id)} disabled={m.missing} aria-label={`Añadir ${m.name} a la línea de tiempo`} title="Añadir al cabezal">＋</button>
              {!used.has(m.id) && (
                <button type="button" className="mini" onClick={() => onRemove(m.id)} aria-label={`Quitar ${m.name} de los medios`} title="Quitar (no se usa)">✕</button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
