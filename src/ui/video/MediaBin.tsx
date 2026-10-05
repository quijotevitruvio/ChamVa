import { useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import * as VM from '../../video/model';
import { fmtDur } from './ClipView';
import type { MediaCache } from './mediaCache';
import { MEDIA_MIME } from './Timeline';

interface Props {
  project: VM.VideoProject;
  cache: MediaCache;
  onImport: (files: File[]) => void;
  onAdd: (mediaId: string) => void;
  onRemove: (mediaId: string) => void;
  onAddText: () => void;
  /** abre el diálogo «Grabar» (pantalla, cámara, pantalla + cámara, micrófono) */
  onOpenRecord: () => void;
  /** abre el selector de plantillas de video */
  onOpenTemplates: () => void;
  /** pestaña activa y su contenido (V4) */
  tab: BinTab;
  onTab: (t: BinTab) => void;
  textPanel: ReactNode;
  subtitlePanel: ReactNode;
  /** V6: transiciones, efectos y ajustes */
  transPanel: ReactNode;
  fxPanel: ReactNode;
  adjustPanel: ReactNode;
  /** biblioteca de sonidos CC0 incluida (carga perezosa: solo se monta con la pestaña abierta) */
  soundsPanel: ReactNode;
}

export type BinTab = 'media' | 'sounds' | 'text' | 'subs' | 'trans' | 'fx' | 'adjust';
const TABS: { id: BinTab; label: string }[] = [
  { id: 'media', label: 'Medios' },
  { id: 'sounds', label: 'Sonidos' },
  { id: 'text', label: 'Texto' },
  { id: 'subs', label: 'Subtítulos' },
  { id: 'trans', label: 'Transiciones' },
  { id: 'fx', label: 'Efectos' },
  { id: 'adjust', label: 'Ajustes' },
];

const ICON = { video: '🎬', audio: '🎵', image: '🖼' } as const;

/** Panel de medios: importar, ver lo importado y arrastrarlo a la línea de tiempo. */
export function MediaBin({ project, cache, onImport, onAdd, onRemove, onAddText, onOpenRecord, onOpenTemplates, tab, onTab, textPanel, subtitlePanel, transPanel, fxPanel, adjustPanel, soundsPanel }: Props) {
  useSyncExternalStore(cache.subscribe, cache.getVersion);
  const file = useRef<HTMLInputElement>(null);
  const used = VM.usedMediaIds(project);
  const items = Object.values(project.media);
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.findIndex((t) => t.id === tab);
    const n = e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    onTab(n.id);
    requestAnimationFrame(() => document.getElementById('vx-tab-' + n.id)?.focus());
  };
  return (
    <aside className={`vx-bin${tab === 'subs' ? ' wide' : ''}`} aria-label="Medios, sonidos, texto, subtítulos, transiciones, efectos y ajustes">
      <div className="vx-tabs" role="tablist" aria-label="Panel de medios" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.id} id={'vx-tab-' + t.id} type="button" role="tab" aria-selected={tab === t.id} aria-controls={'vx-tabpanel-' + t.id} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sounds' && <div id="vx-tabpanel-sounds" role="tabpanel" aria-labelledby="vx-tab-sounds" className="vx-tabpanel">{soundsPanel}</div>}
      {tab === 'text' && <div id="vx-tabpanel-text" role="tabpanel" aria-labelledby="vx-tab-text" className="vx-tabpanel">{textPanel}</div>}
      {tab === 'subs' && <div id="vx-tabpanel-subs" role="tabpanel" aria-labelledby="vx-tab-subs" className="vx-tabpanel">{subtitlePanel}</div>}
      {tab === 'trans' && <div id="vx-tabpanel-trans" role="tabpanel" aria-labelledby="vx-tab-trans" className="vx-tabpanel">{transPanel}</div>}
      {tab === 'fx' && <div id="vx-tabpanel-fx" role="tabpanel" aria-labelledby="vx-tab-fx" className="vx-tabpanel">{fxPanel}</div>}
      {tab === 'adjust' && <div id="vx-tabpanel-adjust" role="tabpanel" aria-labelledby="vx-tab-adjust" className="vx-tabpanel">{adjustPanel}</div>}
      {tab === 'media' && (
      <>
      <div className="vx-bin-head">
        <button type="button" className="primary" onClick={() => file.current?.click()}>＋ Importar</button>
        <button type="button" onClick={onAddText}>🅣 Texto</button>
        <button type="button" onClick={onOpenRecord} title="Grabar pantalla, cámara o micrófono">⏺ Grabar</button>
        <button type="button" onClick={onOpenTemplates} title="Empezar desde una plantilla de video">▦ Plantillas</button>
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
      </>
      )}
    </aside>
  );
}
