// Coloca lo grabado en el proyecto (puro): el clip principal en una pista nueva en el cabezal y, si la cámara se grabó
// aparte, su clip en otra pista nueva encima (con la transformación de una burbuja pequeña en la esquina, editable después).
import * as VM from '../../video/model';
import { baseMime, MODE_LABEL, recordingName, type BubbleCfg, type RecordMode } from '../../video/record/recordCore';
import { placeMedia, withNewTrack } from './editing';

export interface RecordedItem {
  role: 'main' | 'camera';
  blob: Blob;
  mime: string;
  duration: number;
  hasVideo: boolean;
}

/** Cuántas grabaciones de ese modo hay ya (para numerar: «Grabación de pantalla 3»). */
export function nextRecordingNumber(p: VM.VideoProject, mode: RecordMode, role: 'main' | 'camera' = 'main'): number {
  const prefix = role === 'camera' ? 'Cámara' : MODE_LABEL[mode];
  // «Grabación de pantalla 2.webm» cuenta; «Grabación de pantalla con cámara 1.webm» no
  const mine = (name: string) => name.startsWith(prefix + ' ') && /^\d+\./.test(name.slice(prefix.length + 1));
  return Object.values(p.media).filter((m) => mine(m.name)).length + 1;
}

/** Transformación de la cámara grabada aparte: esquina inferior derecha, ~28 % del encuadre. */
export function cameraTransform(b: BubbleCfg): VM.Transform {
  const scale = Math.max(0.15, Math.min(0.5, b.size * 1.15));
  const half = scale / 2 + 0.03;
  return { x: Math.max(half, Math.min(1 - half, half + b.px * (1 - 2 * half))), y: Math.max(half, Math.min(1 - half, half + b.py * (1 - 2 * half))), scale, rotation: 0, opacity: 1 };
}

export interface PlaceResult {
  p: VM.VideoProject;
  clipIds: string[];
  mediaIds: string[];
}

export function placeRecordings(p0: VM.VideoProject, items: RecordedItem[], mode: RecordMode, at: number, bubble: BubbleCfg, ids: { media?: () => string; clip?: () => string } = {}): PlaceResult {
  const newMedia = ids.media ?? VM.uid;
  const newClip = ids.clip ?? VM.uid;
  let p = p0;
  const clipIds: string[] = [];
  const mediaIds: string[] = [];
  // el clip principal primero (queda debajo), la cámara aparte después (queda encima)
  for (const it of [...items].sort((a, b) => (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1))) {
    const kind: VM.MediaKind = it.hasVideo ? 'video' : 'audio';
    const mediaId = newMedia();
    const name = recordingName(mode, nextRecordingNumber(p, mode, it.role), it.mime, it.role);
    p = VM.addMedia(p, { id: mediaId, kind, name, duration: it.duration, blob: it.blob.type ? it.blob : new Blob([it.blob], { type: baseMime(it.mime) }) });
    const clipId = newClip();
    // 'camera' (aparte): pista nueva propia; el principal: pista nueva siempre (no se mezcla con clips existentes)
    const nt = withNewTrack(p, kind === 'audio' ? 'audio' : 'video', it.role === 'camera' ? 'Cámara' : MODE_LABEL[mode]);
    p = nt.p;
    const r = placeMedia(p, { id: mediaId, kind, duration: it.duration }, { trackId: nt.id, at, name, clipId });
    p = r.p;
    if (it.role === 'camera') p = VM.updateClip(p, clipId, { transform: cameraTransform(bubble), volume: 0 });
    clipIds.push(clipId);
    mediaIds.push(mediaId);
  }
  return { p, clipIds, mediaIds };
}
