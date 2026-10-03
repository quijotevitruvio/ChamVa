// Editor de video multipista (V2b). Este archivo solo orquesta: el estado vive en
// `video/useVideoProject`, la reproducción en `video/previewEngine`, la lógica pura en
// `video/editing`, `video/timelineMath` y `video/transformMath`, y cada zona de la
// pantalla es un componente de `src/ui/video/`. Toda edición pasa por el modelo
// (`src/video/model`) y por su historial de deshacer.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as VM from '../video/model';
import { toast } from './toast';
import { AutoSubsDialog } from './video/AutoSubsDialog';
import * as AS from './video/autoSubs';
import { Inspector } from './video/Inspector';
import { MediaBin, type BinTab } from './video/MediaBin';
import { SubtitlePanel } from './video/SubtitlePanel';
import { TextPanel } from './video/TextPanel';
import { PreviewPanel, Transport } from './video/PreviewPanel';
import { Timeline, type TimelineApi } from './video/Timeline';
import { Toolbar } from './video/Toolbar';
import { PreviewEngine } from './video/previewEngine';
import * as E from './video/editing';
import * as T from './video/timelineMath';
import { probeDuration, useVideoProject } from './video/useVideoProject';
import { useExporter } from './video/useExporter';
import './video/video.css';

function useMediaQuery(q: string): boolean {
  const mq = useMemo(() => window.matchMedia(q), [q]);
  return useSyncExternalStore(
    (fn) => {
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => mq.matches,
  );
}

const isTyping = (el: HTMLElement | null) => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
  }
  return false;
};

export function VideoEditor({ onClose }: { onClose: () => void }) {
  const vp = useVideoProject();
  const { project, commit, endGroup, cache } = vp;
  const engine = useMemo(() => new PreviewEngine({ cache }), [cache]);
  const exporter = useExporter(() => vp.histRef.current.present, cache, engine);
  const compact = useMediaQuery('(max-width: 720px)');
  const [selection, setSelection] = useState<string[]>([]);
  const [pps, setPps] = useState(T.DEFAULT_PPS);
  const [snapOn, setSnapOn] = useState(true);
  const [binOpen, setBinOpen] = useState(false);
  const [binTab, setBinTab] = useState<BinTab>('media');
  const [recording, setRecording] = useState(false);
  const [marks, setMarks] = useState<AS.Marks>({ in: null, out: null });
  const [auto, setAuto] = useState<AS.AutoScope | null>(null);
  const [clipMenu, setClipMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const apiRef = useRef<TimelineApi | null>(null);
  const clipboard = useRef<E.ClipboardItem[]>([]);
  const micRec = useRef<MediaRecorder | null>(null);

  useLayoutEffect(() => engine.setProject(project), [engine, project]);
  const engineAlive = useRef(true);
  useEffect(() => {
    engineAlive.current = true;
    return () => {
      engineAlive.current = false;
      queueMicrotask(() => engineAlive.current || engine.dispose());
    };
  }, [engine]);
  // las imágenes se cargan por adelantado (la vista previa y la exportación las necesitan)
  useEffect(() => {
    for (const m of Object.values(project.media)) if (m.kind === 'image') cache.imageOf(m);
  }, [project.media, cache]);
  // la selección no puede apuntar a clips que ya no existen (borrados, deshacer)
  useEffect(() => {
    setSelection((s) => T.pruneSelection(project, s));
  }, [project]);

  // solo en desarrollo: acceso desde la consola para las pruebas del navegador
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__chamvaVideo = { engine, cache, getProject: () => vp.histRef.current.present, commit, selection: () => selection };
  });

  const duration = VM.projectDuration(project);
  const hasClips = project.tracks.some((t) => t.clips.length > 0);

  // ---------- acciones ----------
  const select = (ids: string[]) => setSelection(ids);

  const split = () => {
    const r = E.splitAt(vp.histRef.current.present, selection, engine.time);
    if (r.p === vp.histRef.current.present) return;
    commit(() => r.p);
  };
  const del = (ripple = false) => {
    if (!selection.length) return;
    commit((p) => E.deleteClips(p, selection, ripple));
    setSelection([]);
  };
  const dup = () => {
    if (!selection.length) return;
    const r = E.duplicateClips(vp.histRef.current.present, selection);
    commit(() => r.p);
    if (r.ids.length) setSelection(r.ids);
  };
  const copy = () => {
    clipboard.current = E.copyClips(vp.histRef.current.present, selection);
    if (clipboard.current.length) toast(`${clipboard.current.length} clip(s) copiado(s)`, 'info');
  };
  const paste = () => {
    if (!clipboard.current.length) return;
    const r = E.pasteClips(vp.histRef.current.present, clipboard.current, engine.time);
    commit(() => r.p);
    if (r.ids.length) setSelection(r.ids);
  };
  const nudge = (dt: number) => {
    if (!selection.length) return;
    commit((p) => E.moveClips(p, selection, dt), 'nudge');
  };

  const addMediaAt = (mediaId: string, trackId: string | null | undefined, at: number | undefined) => {
    const m = vp.histRef.current.present.media[mediaId];
    if (!m || m.missing) return;
    let clipId = '';
    commit((p) => {
      const r = E.placeMedia(p, { id: m.id, kind: m.kind, duration: m.duration }, { trackId: trackId === null ? '__new__' : trackId, at, name: m.name });
      clipId = r.clipId;
      return r.p;
    });
    if (clipId) setSelection([clipId]);
  };

  const addText = () => {
    let clipId = '';
    commit((p) => {
      const r = E.addTextClip(p, engine.time);
      clipId = r.clipId;
      return r.p;
    });
    setSelection([clipId]);
  };

  const addTitle = (preset: Parameters<typeof E.addTitleClip>[2]) => {
    let clipId = '';
    commit((p) => {
      const r = E.addTitleClip(p, engine.time, preset);
      clipId = r.clipId;
      return r.p;
    });
    setSelection([clipId]);
  };
  const addPair = (pair: Parameters<typeof E.addTitlePair>[2]) => {
    let ids: string[] = [];
    commit((p) => {
      const r = E.addTitlePair(p, engine.time, pair);
      ids = r.ids;
      return r.p;
    });
    setSelection(ids);
  };
  const selectedText = selection.length === 1 ? VM.findClip(project, selection[0]) : null;
  const canApplyStyle = !!selectedText && selectedText.clip.kind === 'text' && !selectedText.track.locked;
  const applyTitle = (preset: Parameters<typeof E.addTitleClip>[2]) => {
    if (selectedText) commit((p) => E.applyTitlePreset(p, selectedText.clip.id, preset));
  };

  const addTrack = (kind: VM.TrackKind) => commit((p) => E.withNewTrack(p, kind).p);

  const onImport = async (files: File[]) => {
    const empty = !vp.histRef.current.present.tracks.some((t) => t.clips.length);
    const r = await vp.importFiles(files, empty ? {} : false);
    if (r.clipIds.length) setSelection(r.clipIds.slice(-1));
    if (compact) setBinOpen(false);
  };
  const onDropFiles = async (files: File[], trackId: string | null, t: number) => {
    const r = await vp.importFiles(files, { trackId: trackId ?? '__new__', at: t });
    if (r.clipIds.length) setSelection(r.clipIds);
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const duration = await probeDuration(blob, 'audio');
        const n = Object.values(vp.histRef.current.present.media).filter((m) => m.kind === 'audio').length + 1;
        const id = VM.uid();
        let clipId = '';
        commit((p0) => {
          const p = VM.addMedia(p0, { id, kind: 'audio', name: `Grabación ${n}`, duration, blob });
          const r = E.placeMedia(p, { id, kind: 'audio', duration }, { name: `Grabación ${n}`, at: engine.time });
          clipId = r.clipId;
          return r.p;
        });
        setSelection([clipId]);
        setRecording(false);
      };
      micRec.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      toast('No se pudo acceder al micrófono: ' + (e as Error).message, 'error');
    }
  };
  const toggleRec = () => {
    if (recording) {
      micRec.current?.stop();
      micRec.current = null;
    } else void startRec();
  };

  const newProject = () => {
    engine.pause();
    vp.reset();
    setSelection([]);
    engine.seek(0);
  };

  // ---------- subtítulos automáticos (V5b) ----------
  const openAuto = (scope?: AS.AutoScope) => {
    const pr = vp.histRef.current.present;
    if (!pr.tracks.some((t) => t.clips.length)) {
      toast('Añade primero un video o un audio con voz', 'info');
      return;
    }
    engine.pause();
    setClipMenu(null);
    setAuto(scope ?? (AS.selectedMediaClip(pr, selection) ? 'clip' : AS.marksRange(marks) ? 'marks' : 'project'));
  };
  // el comando de la paleta (Ctrl+K) vive en App y avisa por un evento
  useEffect(() => {
    const on = () => openAuto();
    window.addEventListener('chamva:video-autosubs', on);
    return () => window.removeEventListener('chamva:video-autosubs', on);
  });
  useEffect(() => {
    if (!clipMenu) return;
    const off = () => setClipMenu(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && off();
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', off);
    };
  }, [clipMenu]);

  // ---------- atajos ----------
  // En fase de CAPTURA y sin propagar: el editor de diseño (App) escucha las mismas teclas
  // en window y, si no, deshacía/borraba en el diseño que queda detrás. Se re-registra en
  // cada render para leer el estado fresco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (isTyping(target)) return;
      if (auto) return; // con el diálogo abierto, el teclado es suyo
      // flechas sobre una pestaña del panel: cambian de pestaña (las atiende MediaBin), no mueven el cabezal
      if (target?.getAttribute('role') === 'tab' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      // Espacio / Intro sobre un botón de verdad lo pulsa (accesibilidad)
      if ((e.code === 'Space' || e.key === 'Enter') && target && (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY' || target.tagName === 'A')) return;
      if (mod && k === 'z' && !e.shiftKey) {
        handled();
        vp.undo();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        handled();
        vp.redo();
      } else if (mod && k === 'c') {
        handled();
        copy();
      } else if (mod && k === 'x') {
        handled();
        copy();
        del(false);
      } else if (mod && k === 'v') {
        handled();
        paste();
      } else if (mod && k === 'd') {
        handled();
        dup();
      } else if (mod && k === 'a') {
        handled();
        setSelection(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      } else if (!mod && !e.altKey && k === 't') {
        handled();
        openAuto();
      } else if (!mod && !e.altKey && (k === 'i' || k === 'o')) {
        handled();
        const t = Math.round(engine.time * 1000) / 1000;
        setMarks((m) => (k === 'i' ? { ...m, in: t } : { ...m, out: t }));
        toast(k === 'i' ? `Marca de entrada en ${AS.fmtMark(t)}` : `Marca de salida en ${AS.fmtMark(t)}`, 'info');
      } else if (e.code === 'Space') {
        handled();
        engine.toggle();
      } else if (!mod && !e.altKey && k === 'k') {
        handled();
        engine.pause();
      } else if (!mod && !e.altKey && k === 'l') {
        handled();
        engine.play();
      } else if (!mod && !e.altKey && k === 'j') {
        handled();
        engine.seek(engine.time - 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        handled();
        const step = e.shiftKey ? 1 : 1 / 30;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.altKey) nudge(dir * step);
        else engine.seek(engine.time + dir * step);
      } else if (e.key === 'Home') {
        handled();
        engine.seek(0);
      } else if (e.key === 'End') {
        handled();
        engine.seek(engine.duration);
      } else if (!mod && k === 's') {
        handled();
        split();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection.length) return;
        handled();
        del(e.shiftKey);
      } else if (e.key === 'Escape') {
        if (selection.length) {
          handled();
          setSelection([]);
        }
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        handled();
        apiRef.current?.zoomBy(1.4);
      } else if (!mod && (e.key === '-' || e.key === '_')) {
        handled();
        apiRef.current?.zoomBy(1 / 1.4);
      } else if (!mod && k === 'f') {
        handled();
        apiRef.current?.fit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const stopFileDefault = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };

  return (
    <div className={`vx-root${compact ? ' compact' : ''}${selection.length ? ' has-sel' : ''}${binTab === 'subs' && (!compact || binOpen) ? ' bin-wide' : ''}`} onPointerUp={endGroup} onDragOver={stopFileDefault} onDrop={stopFileDefault}>
      <div className="vx-top">
      <Toolbar
        onClose={onClose}
        onNew={newProject}
        canNew={hasClips || Object.keys(project.media).length > 0}
        onUndo={vp.undo}
        onRedo={vp.redo}
        canUndo={vp.canUndo}
        canRedo={vp.canRedo}
        binOpen={binOpen}
        onToggleBin={() => setBinOpen((v) => !v)}
        hasSelection={selection.length > 0}
        onSplit={split}
        onDelete={() => del(false)}
        onDuplicate={dup}
        canExport={duration > 0}
        exporting={exporter.exporting}
        progress={exporter.progress}
        label={exporter.label}
        onCancel={exporter.cancel}
        onExport={exporter.run}
        support={exporter.support}
        aspect={exporter.aspect}
        setAspect={exporter.setAspect}
        res={exporter.res}
        setRes={exporter.setRes}
        fit={exporter.fit}
        setFit={exporter.setFit}
        fps={exporter.fps}
        setFps={exporter.setFps}
        hasSubs={project.tracks.some((t) => t.kind === 'subtitle' && t.clips.length > 0)}
        burnSubs={exporter.burnSubs}
        setBurnSubs={exporter.setBurnSubs}
        onExportSubs={exporter.exportSubs}
      />
      </div>
        {(!compact || binOpen) && (
          <MediaBin
            project={project}
            cache={cache}
            recording={recording}
            onImport={onImport}
            onAdd={(id) => addMediaAt(id, undefined, engine.time)}
            onRemove={(id) =>
              commit((p) => {
                if (VM.usedMediaIds(p).has(id)) return p; // un medio en uso no se quita
                const media = { ...p.media };
                delete media[id];
                return { ...p, media };
              })
            }
            onAddText={addText}
            onToggleRecord={toggleRec}
            tab={binTab}
            onTab={setBinTab}
            textPanel={<TextPanel canApply={canApplyStyle} onAdd={addTitle} onApply={applyTitle} onAddPair={addPair} onAddPlain={addText} />}
            subtitlePanel={<SubtitlePanel project={project} engine={engine} selection={selection} setSelection={select} commit={commit} onAutoSubs={() => openAuto()} />}
          />
        )}
        <PreviewPanel engine={engine} project={project} selectedId={selection.length === 1 ? selection[0] : null} aspect={exporter.aspect} fit={exporter.fit} commit={commit} endGroup={endGroup} empty={!hasClips} />
      <div className="vx-tl-section">
        <div className="vx-tl-bar">
          <Transport engine={engine} duration={duration} snapOn={snapOn} onToggleSnap={() => setSnapOn((v) => !v)} />
          <div className="vx-zoom" role="group" aria-label="Zoom de la línea de tiempo">
            <button type="button" onClick={() => apiRef.current?.zoomBy(1 / 1.4)} aria-label="Alejar (−)" title="Alejar (−)">−</button>
            <button type="button" onClick={() => apiRef.current?.fit()} aria-label="Ajustar todo (F)" title="Ajustar todo (F)">⤢</button>
            <button type="button" onClick={() => apiRef.current?.zoomBy(1.4)} aria-label="Acercar (+)" title="Acercar (+)">＋</button>
          </div>
          <div className="vx-addtrack">
            <button type="button" onClick={() => addTrack('video')} title="Añadir una pista de video encima de las demás">＋ Pista video</button>
            <button type="button" onClick={() => addTrack('subtitle')} title="Añadir una pista de subtítulos">＋ Subtítulos</button>
            <button type="button" onClick={() => addTrack('audio')} title="Añadir una pista de audio">＋ Pista audio</button>
          </div>
        </div>
        <Timeline
          project={project}
          engine={engine}
          cache={cache}
          selection={selection}
          setSelection={select}
          pps={pps}
          setPps={setPps}
          commit={commit}
          endGroup={endGroup}
          snapOn={snapOn}
          compact={compact}
          apiRef={apiRef}
          onDropMedia={(id, trackId, t) => addMediaAt(id, trackId, t)}
          onDropFiles={onDropFiles}
          onAddTrack={addTrack}
          marks={marks}
          onClipMenu={(id, x, y) => setClipMenu({ id, x, y })}
        />
      </div>
      {clipMenu && (
        <ul className="vx-ctxmenu" role="menu" style={{ left: Math.min(clipMenu.x, window.innerWidth - 250), top: Math.min(clipMenu.y, window.innerHeight - 60) }} onPointerDown={(e) => e.stopPropagation()}>
          <li role="none">
            <button type="button" role="menuitem" autoFocus onClick={() => openAuto('clip')}>✨ Subtítulos automáticos de este clip…</button>
          </li>
        </ul>
      )}
      {auto && (
        <AutoSubsDialog
          getProject={() => vp.histRef.current.present}
          commit={commit}
          engine={engine}
          selection={selection}
          marks={marks}
          setMarks={setMarks}
          initialScope={auto}
          onClose={() => setAuto(null)}
          onApplied={(firstId) => {
            setBinTab('subs');
            setBinOpen(true);
            if (firstId) {
              setSelection([firstId]);
              const l = VM.findClip(vp.histRef.current.present, firstId);
              if (l) engine.seek(l.clip.start);
            }
          }}
        />
      )}
      <div className="vx-side">
        <Inspector project={project} selection={selection} commit={commit} onSplit={split} onDuplicate={dup} onDelete={del} onOpenSubtitles={() => { setBinTab('subs'); setBinOpen(true); }} />
      </div>
    </div>
  );
}
