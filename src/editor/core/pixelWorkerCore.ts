// Lógica del worker de píxeles, SIN depender de `self`: la usa tanto `pixel.worker.ts` (real)
// como las pruebas (worker simulado en el mismo hilo). Misma función que el hilo principal
// (`runPixelStage`), así que el resultado es idéntico bit a bit.
import { DEFAULT_ADJUST, type ImageAdjust } from './types';
import { runOutlineStage, runPixelStage } from './imageProcessing';
import { resampleRGBA, type ResampleMethod } from './resample';

export interface PixelJobMsg {
  id: number;
  op: 'pixels' | 'outline' | 'resample';
  buffer: ArrayBuffer; // RGBA (se transfiere, no se copia)
  width: number;
  height: number;
  adj?: ImageAdjust; // pixels / outline
  scale?: number; // pixels / outline
  dw?: number; // resample: tamaño de destino
  dh?: number;
  method?: ResampleMethod;
}

export type PixelReply =
  | { id: number; progress: number; label: string }
  | { id: number; done: true; buffer: ArrayBuffer }
  | { id: number; error: string };

const PROGRESS_EVERY_MS = 50; // el worker está ocupado: no inundar de mensajes

export function handlePixelJob(
  msg: PixelJobMsg,
  post: (r: PixelReply, transfer?: Transferable[]) => void,
  now: () => number = () => Date.now(),
) {
  try {
    const data = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
    let last = -Infinity;
    const report = (progress: number, label: string) => {
      const t = now();
      if (progress >= 1 || t - last >= PROGRESS_EVERY_MS) {
        last = t;
        post({ id: msg.id, progress, label });
      }
    };
    if (msg.op === 'resample') {
      const out = resampleRGBA(data.data, msg.width, msg.height, msg.dw ?? msg.width, msg.dh ?? msg.height, msg.method ?? 'bicubic', (f) =>
        report(f, 'Remuestreo'),
      );
      post({ id: msg.id, done: true, buffer: out.buffer as ArrayBuffer }, [out.buffer as ArrayBuffer]);
      return;
    }
    const adj = msg.adj ?? DEFAULT_ADJUST;
    const scale = msg.scale ?? 1;
    if (msg.op === 'outline') runOutlineStage(data, adj, scale);
    else runPixelStage(data, adj, scale, report);
    post({ id: msg.id, done: true, buffer: msg.buffer }, [msg.buffer]);
  } catch (e) {
    post({ id: msg.id, error: e instanceof Error ? e.message : String(e) });
  }
}
