// Acciones de exportación de video para la interfaz: eligen destino (diálogo de
// guardar / File System Access / descarga), lanzan el motor y avisan en español.
import type { Doc } from '../editor/core/types';
import { downloadBlob } from '../io/export';
import { rememberSaved } from '../io/nativeSave';
import { toast } from '../ui/toast';
import { canUseWebCodecs, findVideoConfig } from './engine/encoderConfig';
import type { Container } from './engine/formats';
import { renderDocAnimation } from './engine/renderDoc';
import { type ByteSink, openSink } from './engine/sink';

export const MIME: Record<Container, string> = { mp4: 'video/mp4', webm: 'video/webm' };

/** Entrega el resultado: descarga (modo Blob) o aviso de guardado (disco). */
export function deliver(sink: ByteSink, blob: Blob | null, filename: string) {
  if (blob) downloadBlob(blob, filename);
  else {
    if (sink.path) rememberSaved(sink.path);
    toast(`Video guardado${sink.path ? ': ' + sink.path : ''}`, 'success');
  }
}

/** «MP4 (animación)» del diseño, con el motor de video (sin GIF intermedio ni ffmpeg). */
export async function exportDocAnimationVideo(doc: Doc, baseName: string): Promise<void> {
  if (!canUseWebCodecs()) {
    toast('Este navegador no puede crear video (no tiene WebCodecs). Usa «GIF animado».', 'error');
    return;
  }
  // Si no hay H.264, WebM (VP9) en vez de fallar.
  let container: Container = 'mp4';
  if (!(await findVideoConfig('mp4', 1280, 720, 30))) {
    container = 'webm';
    toast('Este equipo no codifica H.264: la animación se guarda en WebM.', 'info');
  }
  const filename = `${baseName}.${container}`;
  const sink = await openSink({ filename, mime: MIME[container] });
  if (!sink) return; // cancelado en el diálogo
  try {
    const res = await renderDocAnimation(doc, { container, sink, onNotice: (m) => toast(m, 'info') });
    deliver(sink, res.blob, filename);
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return;
    console.error(e);
    toast('No se pudo exportar la animación: ' + (e as Error).message, 'error');
  }
}
