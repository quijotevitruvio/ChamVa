// Exportación del proyecto: el motor (WebCodecs, en streaming a disco) o, si el
// navegador no tiene WebCodecs, grabación en tiempo real de la vista previa con MediaRecorder.
import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../../io/export';
import { canUseWebCodecs, probeExportSupport, type ExportSupport } from '../../video/engine/encoderConfig';
import { lowerQuality, outputSize, type Aspect, type Container, type Quality } from '../../video/engine/formats';
import { ExportUnsupportedError, renderProject } from '../../video/engine/render';
import { openSink } from '../../video/engine/sink';
import type { Fit } from '../../video/engine/timeline';
import { MIME, deliver } from '../../video/exportActions';
import * as VM from '../../video/model';
import { SUB_FILE, serializeSubtitles, type SubFormat } from '../../video/title/srt';
import { cuesOfTrack, subtitleTracks } from '../../video/title/subtitles';
import { toast } from '../toast';
import type { MediaCache } from './mediaCache';
import type { PreviewEngine } from './previewEngine';

export function useExporter(getProject: () => VM.VideoProject, cache: MediaCache, engine: PreviewEngine) {
  const [exporting, setExporting] = useState(false);
  const [res, setRes] = useState<Quality>(720); // lado corto en px
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [fit, setFit] = useState<Fit>('contain');
  const [fps, setFps] = useState(30);
  /** subtítulos quemados en la imagen (si no, solo van en el archivo .srt aparte) */
  const [burnSubs, setBurnSubs] = useState(true);
  const [progress, setProgress] = useState(0); // 0..1
  const [label, setLabel] = useState('');
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    probeExportSupport().then(setSupport).catch(() => setSupport(null));
  }, []);

  const recordFallback = async (mime: string, signal: AbortSignal): Promise<Blob> => {
    const project = getProject();
    const canvas = document.createElement('canvas');
    const size = outputSize(aspect, res > 1080 ? 1080 : res);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(fps);
    const total = Math.max(0.1, VM.projectDuration(project));
    setProgress(0);
    engine.audioStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    let raf = 0;
    const draw = () => {
      engine.drawFrame(ctx, canvas.width, canvas.height, engine.time);
      setProgress(Math.min(0.99, engine.time / total));
      raf = requestAnimationFrame(draw);
    };
    engine.seek(0);
    draw();
    rec.start();
    await new Promise<void>((done) => {
      engine.setOnEnded(done);
      signal.addEventListener('abort', () => {
        engine.pause();
        done();
      });
      engine.play();
    });
    engine.setOnEnded(null);
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    if (signal.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
    setProgress(1);
    return new Blob(chunks, { type: mime.split(';')[0] });
  };

  const run = async (container: Container) => {
    const project = getProject();
    if (VM.projectDuration(project) <= 0 || exporting) return;
    const filename = `chamva-video.${container}`;
    const ac = new AbortController();
    abort.current = ac;
    setProgress(0);
    setLabel('');
    const hasSubs = subtitleTracks(project).some((t) => !t.hidden && t.clips.length > 0);
    if (!canUseWebCodecs()) {
      if (!burnSubs && hasSubs) toast('Este navegador exporta grabando la vista previa: los subtítulos siempre quedan incrustados. Oculta la pista de subtítulos para quitarlos.', 'info');
      const mime =
        container === 'mp4'
          ? ['video/mp4;codecs=avc1,mp4a', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
          : ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) {
        toast(container === 'mp4' ? 'Este navegador no puede crear MP4. Exporta en WebM.' : 'Este navegador no puede crear WebM. Exporta en MP4.', 'error');
        return;
      }
      setExporting(true);
      setLabel('grabando en tiempo real');
      try {
        downloadBlob(await recordFallback(mime, ac.signal), filename);
      } catch (e) {
        if ((e as DOMException)?.name !== 'AbortError') toast('No se pudo exportar el video: ' + (e as Error).message, 'error');
      } finally {
        setExporting(false);
        setProgress(0);
        abort.current = null;
      }
      return;
    }
    // Pedir el destino primero (el selector de archivos exige el gesto del clic).
    let sink;
    try {
      sink = await openSink({ filename, mime: MIME[container] });
    } catch (e) {
      toast('No se pudo abrir el archivo de destino: ' + (e as Error).message, 'error');
      return;
    }
    if (!sink) return; // cancelado
    setExporting(true);
    const sizes: { width: number; height: number; label: string }[] = [];
    for (let q: Quality | null = res; q; q = lowerQuality(q)) {
      const sz = outputSize(aspect, q);
      sizes.push({ ...sz, label: `${sz.width}×${sz.height}` });
    }
    try {
      const result = await renderProject(project, {
        container,
        sizes,
        fps,
        images: cache.loadedImages(),
        burnSubtitles: burnSubs,
        fit,
        sink,
        signal: ac.signal,
        onNotice: (m) => toast(m, 'info'),
        onProgress: (p) => {
          setProgress(p.ratio);
          setLabel(p.stage === 'video' ? `fotograma ${p.frame}/${p.frames}${p.eta !== undefined ? ` · quedan ~${Math.ceil(p.eta)} s` : ''}` : p.stage);
        },
      });
      deliver(sink, result.blob, filename);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') toast('Exportación cancelada', 'info');
      else {
        console.error(e);
        toast(e instanceof ExportUnsupportedError ? e.message : 'No se pudo exportar el video: ' + (e as Error).message, 'error');
      }
    } finally {
      setExporting(false);
      setProgress(0);
      setLabel('');
      abort.current = null;
    }
  };

  /** Guarda los subtítulos de la primera pista con subtítulos en un archivo aparte. */
  const exportSubs = (format: SubFormat) => {
    const tr = subtitleTracks(getProject()).find((t) => t.clips.length > 0);
    if (!tr) {
      toast('No hay subtítulos que guardar', 'info');
      return;
    }
    const text = serializeSubtitles(cuesOfTrack(tr), format);
    void downloadBlob(new Blob([text], { type: SUB_FILE[format].mime + ';charset=utf-8' }), `chamva-video.${SUB_FILE[format].ext}`);
  };

  return { exporting, res, setRes, aspect, setAspect, fit, setFit, fps, setFps, burnSubs, setBurnSubs, exportSubs, progress, label, support, run, cancel: () => abort.current?.abort() };
}
