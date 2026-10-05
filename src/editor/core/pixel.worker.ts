/// <reference lib="webworker" />
// Worker de procesado de píxeles (reducir ruido, neblina, nitidez, curvas, HSL, efectos…).
// Recibe un ArrayBuffer RGBA transferido, lo procesa con `runPixelStage` y lo devuelve.
import { handlePixelJob, type PixelJobMsg } from './pixelWorkerCore';

self.onmessage = (e: MessageEvent<PixelJobMsg>) => {
  handlePixelJob(e.data, (r, transfer) => (self as unknown as Worker).postMessage(r, transfer ?? []));
};
