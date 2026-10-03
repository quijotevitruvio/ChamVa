// Estado del proyecto de video: modelo v2 + historial de deshacer + guardado en
// IndexedDB + importación de archivos. Toda edición pasa por `commit` (un paso de
// deshacer; con `group`, los cambios seguidos del mismo grupo son uno solo).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as VM from '../../video/model';
import { idbDelete, idbGet, idbSet } from '../../io/idb';
import { toast } from '../toast';
import { MediaCache } from './mediaCache';
import { placeMedia } from './editing';

export const idbIo: VM.KvIo = { get: idbGet, set: idbSet, delete: idbDelete };

export type FileKind = 'video' | 'audio' | 'image';

export function kindOfFile(f: Pick<File, 'type' | 'name'>): FileKind | null {
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('image/')) return 'image';
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}

export function probeDuration(blob: Blob, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(el.duration || 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

export function useVideoProject() {
  const [hist, setHistState] = useState(() => VM.createHistory(VM.createProject()));
  const histRef = useRef(hist);
  const setHist = (h: VM.VideoHistory) => {
    histRef.current = h;
    setHistState(h);
  };
  const project = hist.present;
  const cache = useMemo(() => new MediaCache(), []);
  const storeRef = useRef<VM.VideoProjectStore | null>(null);
  storeRef.current ??= new VM.VideoProjectStore(idbIo);
  const restored = useRef(false);
  const [loaded, setLoaded] = useState(false);

  /** Un cambio con paso de deshacer. Devuelve el proyecto resultante (síncrono: se pueden encadenar). */
  const commit = (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string): VM.VideoProject => {
    const h = VM.commit(histRef.current, fn(histRef.current.present), { group });
    setHist(h);
    return h.present;
  };
  const endGroup = () => {
    if (histRef.current.group !== null) setHist(VM.endGroup(histRef.current));
  };
  const undo = () => setHist(VM.undo(histRef.current));
  const redo = () => setHist(VM.redo(histRef.current));

  // carga (un guardado de V1 se migra; el original se respalda antes del primer guardado)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await storeRef.current!.load();
        if (!alive) return;
        if (res.from === 'future') toast('Este proyecto de video es de una versión más nueva de ChamVa: no se modificará.', 'error');
        if (res.from === 1 || res.from === 'unknown' || res.fromBackup) console.info('[video] proyecto migrado a v2', res.report);
        if (res.report.repaired.length) console.warn('[video] valores reparados al migrar:', res.report.repaired);
        const past = await VM.loadUndo(idbIo, res.project);
        if (!alive) return;
        setHist({ ...VM.createHistory(res.project), past });
        if (res.project.tracks.some((t) => t.clips.length)) toast('Proyecto de video recuperado', 'info');
      } finally {
        restored.current = true;
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // guardado diferido
  useEffect(() => {
    if (!restored.current) return;
    const id = setTimeout(async () => {
      const store = storeRef.current!;
      if (!store.writable) return;
      if (await store.save(project)) await VM.saveUndo(idbIo, histRef.current.past, project);
    }, 2000);
    return () => clearTimeout(id);
  }, [project]);

  // Se libera al desmontar de verdad (no en la doble ejecución de efectos de StrictMode, que es síncrona).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => alive.current || cache.dispose());
    };
  }, [cache]);

  const reset = () => {
    cache.clear();
    setHist(VM.createHistory(VM.createProject()));
    void storeRef.current!.clear();
  };

  /**
   * Importa archivos al proyecto. Con `place`, además los coloca (en la pista/instante pedidos o al final
   * de la pista principal). Devuelve los ids de los clips creados.
   */
  const importFiles = async (files: File[], place?: { trackId?: string; at?: number } | false): Promise<{ clipIds: string[]; mediaIds: string[] }> => {
    const clipIds: string[] = [];
    const mediaIds: string[] = [];
    let at = place ? place.at : undefined;
    let skipped = 0;
    for (const file of files) {
      const kind = kindOfFile(file);
      if (!kind) {
        skipped++;
        continue;
      }
      const duration = kind === 'image' ? 0 : await probeDuration(file, kind);
      if (kind !== 'image' && !duration) {
        toast(`No se pudo leer «${file.name}» (formato no compatible con este navegador).`, 'error');
        continue;
      }
      const id = VM.uid();
      mediaIds.push(id);
      commit((p0) => {
        const p = VM.addMedia(p0, { id, kind, name: file.name, duration, blob: file });
        if (!place) return p;
        const r = placeMedia(p, { id, kind, duration }, { trackId: place.trackId, at, name: file.name });
        clipIds.push(r.clipId);
        return r.p;
      });
      if (place && at !== undefined) {
        const m = VM.findClip(histRef.current.present, clipIds[clipIds.length - 1]);
        if (m) at = VM.clipEnd(m.clip); // varios archivos: uno detrás de otro
      }
    }
    if (skipped) toast(`${skipped} archivo(s) no son de video, audio ni imagen y se ignoraron.`, 'info');
    return { clipIds, mediaIds };
  };

  return { hist, project, commit, endGroup, undo, redo, canUndo: VM.canUndo(hist), canRedo: VM.canRedo(hist), cache, loaded, reset, importFiles, histRef };
}
