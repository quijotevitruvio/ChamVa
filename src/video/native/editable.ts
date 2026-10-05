// ¿Puede el motor propio (demux + WebCodecs) abrir y decodificar este archivo?
// Se usa en la importación para decidir la ruta (directa, lenta con <video>,
// proxy con ffmpeg nativo o mensaje de que falta FFmpeg).
import { demux } from '../engine/demux';
import { chooseImportRoute, type ImportRoute } from './pure';
import { isNativeDesktop, nativeStatus } from './bridge';

export interface EditableCheck {
  demuxOk: boolean;
  decodable: boolean;
  /** por qué no (para el mensaje), si no se puede */
  reason?: string;
}

export async function checkEditable(blob: Blob): Promise<EditableCheck> {
  let file;
  try {
    file = await demux(blob);
  } catch (e) {
    return { demuxOk: false, decodable: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (file.skipped?.length) {
    const what = file.skipped.map((t) => t.replace(':', ' ')).join(', ');
    return { demuxOk: true, decodable: false, reason: `pistas que el editor no sabe leer: ${what}` };
  }
  try {
    const v = file.video;
    if (v) {
      if (typeof VideoDecoder === 'undefined') return { demuxOk: true, decodable: false, reason: 'sin WebCodecs' };
      const s = await VideoDecoder.isConfigSupported({ codec: v.codec, description: v.description, codedWidth: v.codedWidth, codedHeight: v.codedHeight });
      if (!s.supported) return { demuxOk: true, decodable: false, reason: `el códec de video ${v.codec} no se puede decodificar aquí` };
    }
    const a = file.audio;
    if (a && typeof AudioDecoder !== 'undefined') {
      const s = await AudioDecoder.isConfigSupported({ codec: a.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description });
      if (!s.supported) return { demuxOk: true, decodable: false, reason: `el códec de audio ${a.codec} no se puede decodificar aquí` };
    }
    return { demuxOk: true, decodable: !!(v || a) };
  } catch (e) {
    return { demuxOk: true, decodable: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Ruta de importación de un video (en escritorio; `htmlPlayable` = `<video>` dio duración). */
export async function importRouteFor(blob: Blob, htmlPlayable: boolean): Promise<{ route: ImportRoute; check: EditableCheck }> {
  const check = await checkEditable(blob);
  const desktop = isNativeDesktop();
  const st = desktop ? await nativeStatus() : null;
  return { route: chooseImportRoute({ ...check, htmlPlayable, desktop, nativeAvailable: !!st?.available }), check };
}
