// Borrador Mágico: rellena la zona pintada con el contenido de alrededor (inpainting
// clásico Telea, vía OpenCV.js). Local; OpenCV se descarga la 1ª vez y queda en caché.

const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js';
let cvPromise: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.cv && w.cv.Mat) {
      resolve(w.cv);
      return;
    }
    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => {
      // OpenCV.js inicializa el runtime WASM de forma asíncrona.
      const start = Date.now();
      const check = () => {
        const cv = (window as any).cv;
        if (cv && cv.Mat) resolve(cv);
        else if (Date.now() - start > 60000)
          reject(new Error('OpenCV tardó demasiado en iniciar'));
        else setTimeout(check, 100);
      };
      check();
    };
    script.onerror = () => reject(new Error('No se pudo descargar OpenCV'));
    document.body.appendChild(script);
  });
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
