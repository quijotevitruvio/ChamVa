// Descarga de imágenes con todas las opciones: selección, varios tamaños, peso
// objetivo, marca de agua, metadatos, plantilla de nombre y ZIP.
import type { Doc, Layer } from '../editor/core/types';
import { TRANSPARENT_BG } from '../editor/core/types';
import { useEditor } from '../editor/state/store';
import { exportableIndices, ALL_HIDDEN_MSG } from '../editor/core/pageOps';
import { downloadBlob, renderDocToCanvas, type ExportFormat } from './export';
import { exportDocToSvg } from './exportSvg';
import { getExtra, type ExtraSettings } from './exportExtra';
import { alphaBounds, bisectQuality, buildScaleSpecs, parseWidths, MAX_EXPORT_SIDE } from './exportTargets';
import { buildFileName, dateStamp, sanitizeFileName, uniqueName, type NameVars } from './fileNameTemplate';
import { addJpegMeta, addPngMeta, hasMeta } from './pngMeta';
import { fileDpi, setJpegDpi, setPngDpi } from './imageDpi';
import { applyWatermark, watermarkActive, watermarkSvg } from './watermark';
import { blobToBytes, zipToBlob, type ZipEntry } from './zip';
import { toast } from '../ui/toast';
import { resolveBlobFormat } from './rasterSupport';
import { BLEND_LABEL, svgInexactBlends } from '../editor/core/blend';

export type ExportScope = 'page' | 'all' | 'selection';

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif', svg: 'svg' };

const safeBase = (d: { name: string }) => (d.name || 'chamva').replace(/[^\w\-]+/g, '_');

// ---- cancelación (Esc) ----
let cancelFlag = false;
export function cancelExport() {
  cancelFlag = true;
}
function beginJob(announce: boolean): () => void {
  cancelFlag = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancelFlag = true;
  };
  window.addEventListener('keydown', onKey, true);
  if (announce) toast('Exportando… pulsa Esc para cancelar', 'info');
  return () => window.removeEventListener('keydown', onKey, true);
}

// ---- recorte a una o varias capas ----

// Devuelve un documento del tamaño exacto (caja de píxeles visibles) de las capas
// indicadas, con fondo transparente y las capas desplazadas. null si no se ve nada.
// Limitación: solo se ve lo que cae dentro del lienzo de la página.
export async function cropDocToLayers(doc: Doc, layers: Layer[]): Promise<Doc | null> {
  const probe: Doc = {
    ...doc,
    background: TRANSPARENT_BG,
    layers: layers.map((l) => ({ ...l, visible: true })) as Layer[],
  };
  const canvas = await renderDocToCanvas(probe, 1);
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const b = alphaBounds(data, canvas.width, canvas.height);
  if (!b) return null;
  return {
    ...probe,
    width: b.w,
    height: b.h,
    layers: probe.layers.map((l) => ({ ...l, x: l.x - b.x, y: l.y - b.y })) as Layer[],
  };
}

// Capas elegidas (grupo incluido) de la página actual.
export function selectedLayers(doc: Doc, selectedIds: string[]): Layer[] {
  const ids = new Set(selectedIds);
  return doc.layers.filter((l) => ids.has(l.id) && l.visible);
}

// ---- render de un archivo ----

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), mime, q),
  );
}

export interface RasterResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number; // calidad realmente usada
  fits: boolean; // false si no cabe en el peso objetivo ni con la calidad mínima
  format: ExportFormat; // formato REAL del blob (puede diferir del pedido si el equipo no lo soporta)
  degradedNote: string | null; // aviso en español si hubo degradación
}

// Renderiza `doc` a un archivo de imagen aplicando marca de agua, peso objetivo y metadatos.
export async function renderRasterBlob(
  doc: Doc,
  format: ExportFormat,
  scale: number,
  quality: number,
  extra: ExtraSettings,
  isCancelled?: () => boolean,
): Promise<RasterResult> {
  if (Math.max(doc.width, doc.height) * scale > MAX_EXPORT_SIDE) {
    throw new Error(`El tamaño supera ${MAX_EXPORT_SIDE} px por lado; reduce la escala`);
  }
  const backing = format === 'jpeg' && doc.background.type === 'transparent' ? '#ffffff' : undefined;
  const canvas = await renderDocToCanvas(doc, scale, backing);
  if (watermarkActive(extra.watermark)) await applyWatermark(canvas, extra.watermark);

  const mime = MIME[format];
  let q = quality;
  let fits = true;
  let blob: Blob;
  if (extra.maxKB > 0 && format !== 'png') {
    const limit = extra.maxKB * 1024;
    const hold: { b: Blob | null; q: number } = { b: null, q: quality };
    const res = await bisectQuality(
      async (qq) => {
        const b = await canvasToBlob(canvas, mime, qq);
        hold.b = b;
        hold.q = qq;
        return b.size;
      },
      limit,
      { isCancelled },
    );
    q = res.quality;
    fits = res.fits;
    // La última prueba no tiene por qué ser la elegida: se vuelve a codificar si hace falta.
    blob = hold.b && hold.q === q ? hold.b : await canvasToBlob(canvas, mime, q);
  } else {
    blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : quality);
  }

  // El navegador puede haber caído a PNG (AVIF/WebP no soportados): se usa el formato real.
  const res = resolveBlobFormat(blob.type, format);
  const real = res.format;
  // DPI del documento escrito en el archivo (PNG: pHYs; JPG: JFIF + EXIF). Se escala con la
  // exportación para que el tamaño físico no cambie (300 ppp a ×2 → 600 ppp en el archivo).
  const dpiFile = fileDpi(doc.dpi, scale);
  const withMeta = extra.metaOn && hasMeta(extra.meta);
  if ((real === 'png' || real === 'jpeg') && (withMeta || dpiFile)) {
    const bytes = await blobToBytes(blob);
    let out: Uint8Array;
    if (real === 'png') {
      out = withMeta ? addPngMeta(bytes, extra.meta) : bytes;
      if (dpiFile) out = setPngDpi(out, dpiFile);
    } else if (dpiFile) {
      out = setJpegDpi(bytes, dpiFile, withMeta ? extra.meta : undefined);
    } else {
      out = addJpegMeta(bytes, extra.meta);
    }
    blob = new Blob([out as BlobPart], { type: MIME[real] });
  }
  return { blob, width: canvas.width, height: canvas.height, quality: q, fits, format: real, degradedNote: res.message };
}

async function renderSvgBlob(doc: Doc, extra: ExtraSettings): Promise<Blob> {
  let svg = await exportDocToSvg(doc);
  // Modos de fusión que el SVG no reproduce igual en todos los visores: se avisa.
  const inexact = svgInexactBlends(doc.layers);
  if (inexact.length) toast(`En SVG, la fusión «${inexact.map((m) => BLEND_LABEL[m]).join(', ')}» puede verse distinta según el visor. Para un resultado idéntico exporta PNG.`, 'info');
  if (watermarkActive(extra.watermark)) {
    const i = svg.lastIndexOf('</svg>');
    if (i >= 0) svg = svg.slice(0, i) + watermarkSvg(doc.width, doc.height, extra.watermark) + svg.slice(i);
  }
  return new Blob([svg], { type: 'image/svg+xml' });
}

// ---- descarga principal ----

export async function runImageExport(opts: {
  format: string; // png | jpeg | webp | avif | svg
  scale: number;
  quality: number;
  scope: ExportScope;
}): Promise<void> {
  const { format, scale, quality, scope } = opts;
  const extra = getExtra();
  const st = useEditor.getState();
  const allPages = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));

  // Qué páginas (o recortes) se exportan.
  let targets: { doc: Doc; pagina: number }[];
  if (scope === 'selection') {
    const layers = selectedLayers(st.doc, st.selectedIds);
    if (!layers.length) {
      toast('Selecciona una capa o un grupo para exportar solo lo seleccionado.', 'info');
      return;
    }
    const cropped = await cropDocToLayers(st.doc, layers);
    if (!cropped) {
      toast('Lo seleccionado no se ve dentro del lienzo.', 'info');
      return;
    }
    targets = [{ doc: { ...cropped, name: st.doc.name }, pagina: st.pageIndex + 1 }];
  } else if (scope === 'all') {
    // Las páginas ocultas no se exportan; el número de página conserva el original.
    targets = exportableIndices(allPages).map((i) => ({ doc: allPages[i], pagina: i + 1 }));
    if (!targets.length) {
      toast(ALL_HIDDEN_MSG, 'info');
      return;
    }
  } else {
    targets = [{ doc: st.doc, pagina: st.pageIndex + 1 }];
  }

  const isSvg = format === 'svg';
  const specs = isSvg
    ? [{ scale: 1, label: '1x' }]
    : buildScaleSpecs(targets[0].doc.width, scale, extra.extraScales, parseWidths(extra.customWidths));
  const total = targets.length * specs.length;
  const multiPages = targets.length > 1;
  const multiScales = specs.length > 1;
  const ext = EXT[format] ?? format;
  const date = dateStamp();
  const end = beginJob(total > 1 || (extra.maxKB > 0 && format !== 'png'));

  try {
    const used = new Set<string>();
    const files: { name: string; blob: Blob }[] = [];
    const notes: string[] = [];
    let degradedNote: string | null = null;
    let n = 0;
    for (const t of targets) {
      for (const s of specs) {
        if (cancelFlag) {
          toast('Exportación cancelada', 'info');
          return;
        }
        n++;
        // En raster el ancho de un tamaño personalizado es exacto aunque cambie el redondeo.
        const w = Math.max(1, Math.round(t.doc.width * s.scale));
        const h = Math.max(1, Math.round(t.doc.height * s.scale));
        let blob: Blob;
        let fileExt = ext;
        let fits = true;
        if (isSvg) blob = await renderSvgBlob(t.doc, extra);
        else {
          const r = await renderRasterBlob(t.doc, format as ExportFormat, s.scale, quality, extra, () => cancelFlag);
          blob = r.blob;
          fits = r.fits;
          // Extensión y MIME REALES: nunca un PNG con extensión .avif.
          fileExt = EXT[r.format];
          if (r.degradedNote) degradedNote = r.degradedNote;
        }
        const vars: NameVars = {
          nombre: safeBase(t.doc),
          fecha: date,
          pagina: t.pagina,
          n,
          total,
          ancho: isSvg ? t.doc.width : w,
          alto: isSvg ? t.doc.height : h,
          escala: s.label,
          formato: fileExt,
        };
        const base = buildFileName(extra.template, vars, { multiPages, multiScales });
        if (!fits) notes.push(`${base}.${fileExt}: ${Math.round(blob.size / 1024)} KB`);
        files.push({ name: uniqueName(`${base}.${fileExt}`, used), blob });
      }
    }
    if (cancelFlag) {
      toast('Exportación cancelada', 'info');
      return;
    }

    if (files.length === 1) {
      await downloadBlob(files[0].blob, files[0].name);
    } else {
      const entries: ZipEntry[] = [];
      for (const f of files) entries.push({ name: f.name, data: await blobToBytes(f.blob) });
      const zipBase = safeBase(targets[0].doc) + (multiPages ? '_paginas' : '_tamanos');
      await downloadBlob(zipToBlob(entries), `${sanitizeFileName(zipBase)}.zip`);
    }
    if (degradedNote) toast(degradedNote, 'info');
    if (notes.length) {
      toast(
        `No cabe en ${extra.maxKB} KB ni con la calidad mínima (${notes.join(', ')}). Reduce la escala o sube el límite.`,
        'error',
      );
    }
  } catch (e) {
    // «Cancelar» de la barra de procesado: no es un error.
    if ((e as Error)?.name === 'AbortError') toast('Exportación cancelada', 'info');
    else throw e;
  } finally {
    end();
  }
}

// Un PNG recortado por cada capa visible de la página actual, en un ZIP con
// `capas.json` (posición original de cada capa).
export async function runLayersZip(scale: number): Promise<void> {
  const st = useEditor.getState();
  const doc = st.doc;
  const layers = doc.layers.filter((l) => l.visible);
  if (!layers.length) {
    toast('No hay capas visibles que exportar.', 'info');
    return;
  }
  const end = beginJob(layers.length > 1);
  try {
    const entries: ZipEntry[] = [];
    const index: unknown[] = [];
    const used = new Set<string>();
    const pad = String(layers.length).length;
    const clean = { ...getExtra(), maxKB: 0, metaOn: false, watermark: { ...getExtra().watermark, enabled: false } };
    let i = 0;
    for (const layer of layers) {
      if (cancelFlag) {
        toast('Exportación cancelada', 'info');
        return;
      }
      i++;
      const cropped = await cropDocToLayers(doc, [layer]);
      if (!cropped) continue; // capa invisible o fuera del lienzo
      const r = await renderRasterBlob(cropped, 'png', scale, 1, clean);
      const label = sanitizeFileName(layer.name || layer.type);
      const name = uniqueName(`${String(i).padStart(pad, '0')}_${label}.png`, used);
      entries.push({ name, data: await blobToBytes(r.blob) });
      // Posición de la caja recortada en el lienzo original (px del diseño).
      const origin = {
        x: Math.round(layer.x - (cropped.layers[0].x)),
        y: Math.round(layer.y - (cropped.layers[0].y)),
      };
      index.push({ archivo: name, capa: layer.name, x: origin.x, y: origin.y, ancho: cropped.width, alto: cropped.height });
    }
    if (!entries.length) {
      toast('Ninguna capa se ve dentro del lienzo.', 'info');
      return;
    }
    entries.push({
      name: 'capas.json',
      data: new TextEncoder().encode(
        JSON.stringify({ lienzo: { ancho: doc.width, alto: doc.height }, escala: scale, capas: index }, null, 2),
      ),
    });
    await downloadBlob(zipToBlob(entries), `${sanitizeFileName(safeBase(doc))}_capas.zip`);
  } finally {
    end();
  }
}
