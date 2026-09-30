// Borrador Mágico: rellena la zona pintada con el contenido de alrededor
// (inpainting Telea, OpenCV.js). OpenCV va EMPAQUETADO con la app
// (@techstark/opencv-js): sin descargas en tiempo de ejecución, 100% offline.

let cvPromise: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    const mod: any = await import('@techstark/opencv-js');
    // Según la versión, el módulo exporta el objeto cv o una promesa de él.
    let cv = mod.default ?? mod;
    if (typeof cv?.then === 'function') cv = await cv;
    if (!cv.Mat && cv.ready) await cv.ready;
    if (!cv.Mat && cv.onRuntimeInitialized !== undefined) {
      await new Promise<void>((resolve) => {
        const prev = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => {
          prev?.();
          resolve();
        };
        if (cv.Mat) resolve();
      });
    }
    if (!cv.Mat) throw new Error('OpenCV no inicializó');
    return cv;
  })();
  return cvPromise;
}

// imageCanvas: imagen actual. maskCanvas: blanco donde rellenar, negro el resto.
export async function inpaintCanvas(
  imageCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCV();
  const src = cv.imread(imageCanvas); // RGBA
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

  const maskRgba = cv.imread(maskCanvas);
  const mask = new cv.Mat();
  cv.cvtColor(maskRgba, mask, cv.COLOR_RGBA2GRAY);
  cv.threshold(mask, mask, 10, 255, cv.THRESH_BINARY);

  const dst = new cv.Mat();
  cv.inpaint(rgb, mask, dst, 4, cv.INPAINT_TELEA);

  const rgba = new cv.Mat();
  cv.cvtColor(dst, rgba, cv.COLOR_RGB2RGBA);

  const out = document.createElement('canvas');
  out.width = imageCanvas.width;
  out.height = imageCanvas.height;
  cv.imshow(out, rgba);

  // Conservar el canal alfa original (las zonas transparentes siguen transparentes).
  const octx = out.getContext('2d')!;
  const orig = imageCanvas
    .getContext('2d')!
    .getImageData(0, 0, out.width, out.height);
  const now = octx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < now.data.length; i += 4) {
    now.data[i + 3] = orig.data[i + 3];
  }
  octx.putImageData(now, 0, 0);

  src.delete();
  rgb.delete();
  maskRgba.delete();
  mask.delete();
  dst.delete();
  rgba.delete();
  return out;
}
