// Lógica del worker de píxeles, SIN depender de `self`: la usa tanto `pixel.worker.ts` (real)
// como las pruebas (worker simulado en el mismo hilo). Misma función que el hilo principal
// (`runPixelStage`), así que el resultado es idéntico bit a bit.
import { DEFAULT_ADJUST, type ImageAdjust } from './types';
import { runOutlineStage, runPixelStage } from './imageProcessing';
import { resampleRGBA, type ResampleMethod } from './resample';
import { runSelJob, type SelJob } from './selection';
import { featherAlpha } from './layerMask';
import { poissonClone } from './retouch';

export interface PixelJobMsg {
  id: number;
  op: 'pixels' | 'outline' | 'resample' | 'sel' | 'maskFeather' | 'poisson';
  buffer: ArrayBuffer; // RGBA (se transfiere, no se copia); 'sel'/'maskFeather': RGBA o plano de 8 bits
  width: number;
  height: number;
  adj?: ImageAdjust; // pixels / outline
  scale?: number; // pixels / outline
  dw?: number; // resample: tamaño de destino
  dh?: number;
  method?: ResampleMethod;
  sel?: SelJob; // sel: trabajo de selección (selection.ts)
  radius?: number; // maskFeather: radio en píxeles del plano
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
    if (msg.op === 'poisson') {
      // Retoque (parche / eliminar mancha): buffer = destino RGBA | origen RGBA | máscara de 8 bits.
      const n = msg.width * msg.height;
      report(0, 'Retoque');
      const dest = new Uint8ClampedArray(msg.buffer, 0, n * 4);
      const src = new Uint8ClampedArray(msg.buffer, n * 4, n * 4);
      const mask = new Uint8Array(msg.buffer, n * 8, n);
      const out = poissonClone(dest, src, mask, msg.width, msg.height);
      report(1, 'Listo');
      post({ id: msg.id, done: true, buffer: out.buffer as ArrayBuffer }, [out.buffer as ArrayBuffer]);
      return;
    }
    if (msg.op === 'sel' || msg.op === 'maskFeather') {
      // Selección y máscaras: la misma función pura que en el hilo principal (resultado idéntico).
      report(0, msg.op === 'sel' ? 'Selección' : 'Máscara');
      const src = new Uint8Array(msg.buffer);
      const out =
        msg.op === 'sel' && msg.sel
          ? runSelJob(msg.sel, src, msg.width, msg.height)
          : featherAlpha(src, msg.width, msg.height, msg.radius ?? 0);
      report(1, 'Listo');
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
