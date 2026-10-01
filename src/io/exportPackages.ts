// Paquetes de exportación: iconos de aplicación, favicon completo, hoja de
// sprites y rebanadas. La parte pura (listas, JSON, rectángulos, ICO) se prueba en
// Vitest; el dibujo usa canvas y el ZIP es el escritor propio de zip.ts.
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';
import { blobToBytes, zipToBlob, type ZipEntry } from './zip';

// ---------------------------------------------------------------- iconos ----

export type IconPlatform = 'android' | 'ios' | 'windows' | 'macos' | 'pwa';

export interface IconSpec {
  path: string; // ruta dentro del ZIP
  size: number;
  maskable?: boolean; // con margen de seguridad (10 % por lado) y fondo opaco
  opaque?: boolean; // sin transparencia (iOS)
}

export const ANDROID_ICONS: [string, number][] = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];
export const IOS_SIZES = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];
export const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256];
// .iconset de macOS: nombre → píxeles reales.
export const MAC_ICONSET: [string, number][] = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];
export const WINDOWS_ICO_SIZES = [16, 32, 48, 256];

export function iconPlan(platforms: IconPlatform[]): IconSpec[] {
  const out: IconSpec[] = [];
  if (platforms.includes('android')) {
    for (const [d, s] of ANDROID_ICONS) out.push({ path: `android/mipmap-${d}/ic_launcher.png`, size: s });
    out.push({ path: 'android/play-store-512.png', size: 512 });
  }
  if (platforms.includes('ios')) {
    for (const s of IOS_SIZES) out.push({ path: `ios/Icon-${s}.png`, size: s, opaque: true });
  }
  if (platforms.includes('windows')) {
    for (const s of WINDOWS_SIZES) out.push({ path: `windows/icon-${s}.png`, size: s });
  }
  if (platforms.includes('macos')) {
    for (const [n, s] of MAC_ICONSET) out.push({ path: `macos/icon.iconset/${n}`, size: s });
  }
  if (platforms.includes('pwa')) {
    out.push({ path: 'pwa/icon-192.png', size: 192 });
    out.push({ path: 'pwa/icon-512.png', size: 512 });
    out.push({ path: 'pwa/maskable-192.png', size: 192, maskable: true });
    out.push({ path: 'pwa/maskable-512.png', size: 512, maskable: true });
  }
  return out;
}

// .ico con entradas PNG a partir de PNG ya codificados.
export function buildIcoFromPngs(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const count = images.length;
  const header = 6 + count * 16;
  let offset = header;
  const buf = new Uint8Array(images.reduce((a, b) => a + b.data.length, header));
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    buf[e] = img.size >= 256 ? 0 : img.size;
    buf[e + 1] = img.size >= 256 ? 0 : img.size;
    view.setUint16(e + 4, 1, true);
    view.setUint16(e + 6, 32, true);
    view.setUint32(e + 8, img.data.length, true);
    view.setUint32(e + 12, offset, true);
    buf.set(img.data, offset);
    offset += img.data.length;
  });
  return buf;
}

export interface IconOptions {
  fit: 'contain' | 'cover';
  background: string; // fondo de los iconos opacos (iOS y maskable)
}

function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? blobToBytes(b).then(res) : rej(new Error('toBlob falló'))), 'image/png'),
  );
}

// Cuadrado size×size con el diseño dentro. `pad` = fracción de margen por lado.
function squareFrom(
  src: HTMLCanvasElement,
  size: number,
  fit: 'contain' | 'cover',
  pad: number,
  bg: string | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }
  const inner = size * (1 - 2 * pad);
  const k =
    fit === 'cover'
      ? Math.max(inner / src.width, inner / src.height)
      : Math.min(inner / src.width, inner / src.height);
  const dw = src.width * k;
  const dh = src.height * k;
  ctx.save();
  if (fit === 'cover') {
    ctx.beginPath();
    ctx.rect(size * pad, size * pad, inner, inner);
    ctx.clip();
  }
  ctx.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  ctx.restore();
  return out;
}

async function renderSource(doc: Doc, maxSize: number): Promise<HTMLCanvasElement> {
  const scale = Math.min(4, Math.max(1, maxSize / Math.max(doc.width, doc.height)));
  return renderDocToCanvas(doc, scale);
}

async function pngsFor(
  doc: Doc,
  specs: { size: number; maskable?: boolean; opaque?: boolean }[],
  opts: IconOptions,
): Promise<Uint8Array[]> {
  const max = Math.max(...specs.map((s) => s.size), 16);
  const src = await renderSource(doc, max);
  const out: Uint8Array[] = [];
  for (const s of specs) {
    const opaque = s.opaque || s.maskable;
    out.push(
      await canvasToPng(squareFrom(src, s.size, opts.fit, s.maskable ? 0.1 : 0, opaque ? opts.background : null)),
    );
  }
  return out;
}

export const APP_ICONS_README = `PAQUETE DE ICONOS DE APLICACIÓN — hecho con ChamVa

android/   mipmap-*/ic_launcher.png (48, 72, 96, 144, 192 px) y play-store-512.png.
           Copia cada carpeta mipmap-* a app/src/main/res/ de tu proyecto Android.
ios/       Icon-<tamaño>.png (20 a 1024 px), sin transparencia. Arrástralos al
           catálogo de activos (AppIcon) de Xcode; el de 1024 es el de la App Store.
windows/   icon-<tamaño>.png (16 a 256 px) e icon.ico (16, 32, 48 y 256 px).
macos/     icon.iconset/ con los PNG que pide macOS. En un Mac:
           iconutil -c icns icon.iconset
pwa/       icon-192.png y icon-512.png, y las versiones «maskable» (con 10 % de
           margen de seguridad y fondo opaco) para el manifiesto web:
           { "src": "pwa/maskable-512.png", "sizes": "512x512",
             "type": "image/png", "purpose": "maskable" }

Si el diseño no es cuadrado se ajusta (o se recorta) al cuadrado.
`;

export async function buildAppIconsZip(
  doc: Doc,
  platforms: IconPlatform[],
  opts: IconOptions,
): Promise<Blob> {
  const plan = iconPlan(platforms);
  const pngs = await pngsFor(doc, plan, opts);
  const entries: ZipEntry[] = plan.map((p, i) => ({ name: p.path, data: pngs[i] }));
  if (platforms.includes('windows')) {
    const icoPngs = await pngsFor(
      doc,
      WINDOWS_ICO_SIZES.map((size) => ({ size })),
      opts,
    );
    entries.push({
      name: 'windows/icon.ico',
      data: buildIcoFromPngs(WINDOWS_ICO_SIZES.map((size, i) => ({ size, data: icoPngs[i] }))),
    });
  }
  entries.push({ name: 'LEEME.txt', data: new TextEncoder().encode(APP_ICONS_README) });
  return zipToBlob(entries);
}

// --------------------------------------------------------------- favicon ----

export const FAVICON_PNGS: [string, number][] = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['android-chrome-192x192.png', 192],
  ['android-chrome-512x512.png', 512],
];
export const FAVICON_ICO_SIZES = [16, 32, 48];

export function faviconHtml(themeColor = '#ffffff'): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<meta name="theme-color" content="${themeColor}">`,
  ].join('\n');
}

export function siteWebmanifest(name: string, themeColor = '#ffffff', bg = '#ffffff'): string {
  return JSON.stringify(
    {
      name,
      short_name: name.slice(0, 12),
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: themeColor,
      background_color: bg,
      display: 'standalone',
    },
    null,
    2,
  );
}

export async function buildFaviconZip(
  doc: Doc,
  name: string,
  opts: IconOptions & { themeColor: string },
): Promise<{ blob: Blob; html: string }> {
  const specs = FAVICON_PNGS.map(([, size]) => ({ size, opaque: size === 180 }));
  const pngs = await pngsFor(doc, specs, opts);
  const icoPngs = await pngsFor(
    doc,
    FAVICON_ICO_SIZES.map((size) => ({ size })),
    opts,
  );
  const html = faviconHtml(opts.themeColor);
  const entries: ZipEntry[] = FAVICON_PNGS.map(([n], i) => ({ name: n, data: pngs[i] }));
  entries.push({
    name: 'favicon.ico',
    data: buildIcoFromPngs(FAVICON_ICO_SIZES.map((size, i) => ({ size, data: icoPngs[i] }))),
  });
  const enc = new TextEncoder();
  entries.push({ name: 'site.webmanifest', data: enc.encode(siteWebmanifest(name, opts.themeColor)) });
  entries.push({ name: 'favicon-snippet.html', data: enc.encode(html + '\n') });
  entries.push({
    name: 'LEEME.txt',
    data: enc.encode(
      'FAVICON COMPLETO — hecho con ChamVa\n\nSube todos estos archivos (menos este LEEME) a la raíz de tu sitio y pega el contenido de favicon-snippet.html dentro de <head>.\n',
    ),
  });
  return { blob: zipToBlob(entries), html };
}

// --------------------------------------------------------------- sprites ----

export interface SpriteItem {
  name: string;
  w: number;
  h: number;
}
export type SpriteMode = 'grid' | 'strip-h' | 'strip-v';
export interface SpriteLayoutResult {
  width: number;
  height: number;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
}

// Coloca los elementos en una cuadrícula o tira. Cada celda mide lo que el
// elemento más grande; `gap` px de separación; cada marco guarda su tamaño real.
export function spriteLayout(
  items: SpriteItem[],
  mode: SpriteMode,
  columns: number,
  gap: number,
): SpriteLayoutResult {
  if (items.length === 0) return { width: 0, height: 0, frames: [] };
  const cw = Math.max(...items.map((i) => i.w));
  const ch = Math.max(...items.map((i) => i.h));
  const cols =
    mode === 'strip-h' ? items.length : mode === 'strip-v' ? 1 : Math.max(1, Math.min(columns, items.length));
  const rows = Math.ceil(items.length / cols);
  const frames = items.map((it, i) => ({
    name: it.name,
    x: (i % cols) * (cw + gap),
    y: Math.floor(i / cols) * (ch + gap),
    w: it.w,
    h: it.h,
  }));
  return { width: cols * cw + (cols - 1) * gap, height: rows * ch + (rows - 1) * gap, frames };
}

export function spriteJson(layout: SpriteLayoutResult, image = 'sprites.png'): string {
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const f of layout.frames) frames[f.name] = { x: f.x, y: f.y, w: f.w, h: f.h };
  return JSON.stringify({ meta: { image, size: { w: layout.width, h: layout.height } }, frames }, null, 2);
}

export function cssSafeName(s: string): string {
  const n = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return n || 'sprite';
}

export function spriteCss(layout: SpriteLayoutResult, image = 'sprites.png'): string {
  const lines = [`.sprite { background-image: url(${image}); background-repeat: no-repeat; display: inline-block; }`];
  for (const f of layout.frames) {
    lines.push(
      `.sprite-${cssSafeName(f.name)} { width: ${f.w}px; height: ${f.h}px; background-position: ${-f.x}px ${-f.y}px; }`,
    );
  }
  return lines.join('\n') + '\n';
}

// Nombres únicos: repite «nombre» → «nombre-2», «nombre-3»…
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = n || 'sprite';
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  });
}

// Recorta el borde transparente de un canvas (null si está vacío).
export function trimTransparent(c: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, -x0, -y0);
  return out;
}

export interface SpriteSource {
  name: string;
  canvas: HTMLCanvasElement;
}

// Una imagen por página (a su tamaño) o por capa visible (recortada a lo dibujado).
export async function spriteSources(pages: Doc[], source: 'pages' | 'layers'): Promise<SpriteSource[]> {
  const out: SpriteSource[] = [];
  if (source === 'pages') {
    for (const p of pages) out.push({ name: p.name, canvas: await renderDocToCanvas(p, 1) });
  } else {
    for (const p of pages) {
      for (const l of p.layers) {
        if (!l.visible) continue;
        const only: Doc = { ...p, background: { type: 'transparent' }, layers: [{ ...l, visible: true }] };
        const trimmed = trimTransparent(await renderDocToCanvas(only, 1));
        if (trimmed) out.push({ name: l.name || 'capa', canvas: trimmed });
      }
    }
  }
  return out;
}

export async function buildSprites(
  sources: SpriteSource[],
  mode: SpriteMode,
  columns: number,
  gap: number,
  withCss: boolean,
): Promise<{ blob: Blob; layout: SpriteLayoutResult }> {
  const names = uniqueNames(sources.map((s) => s.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')));
  const items = sources.map((s, i) => ({ name: names[i], w: s.canvas.width, h: s.canvas.height }));
  const layout = spriteLayout(items, mode, columns, gap);
  const sheet = document.createElement('canvas');
  sheet.width = Math.max(1, layout.width);
  sheet.height = Math.max(1, layout.height);
  const ctx = sheet.getContext('2d')!;
  layout.frames.forEach((f, i) => ctx.drawImage(sources[i].canvas, f.x, f.y));
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: 'sprites.png', data: await canvasToPng(sheet) },
    { name: 'sprites.json', data: enc.encode(spriteJson(layout)) },
  ];
  if (withCss) entries.push({ name: 'sprites.css', data: enc.encode(spriteCss(layout)) });
  return { blob: zipToBlob(entries), layout };
}

// -------------------------------------------------------------- rebanadas ----

export interface SliceRect {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string; // «01», «02»… (fila a fila)
}

// Líneas de corte (px) → rectángulos. Ignora líneas fuera del lienzo o repetidas.
export function sliceRects(width: number, height: number, xs: number[], ys: number[]): SliceRect[] {
  const norm = (arr: number[], max: number) => {
    const v = [...new Set(arr.map((n) => Math.round(n)).filter((n) => n > 0 && n < max))].sort((a, b) => a - b);
    return [0, ...v, max];
  };
  const X = norm(xs, Math.round(width));
  const Y = norm(ys, Math.round(height));
  const out: SliceRect[] = [];
  const total = (X.length - 1) * (Y.length - 1);
  const pad = Math.max(2, String(total).length);
  for (let r = 0; r < Y.length - 1; r++) {
    for (let c = 0; c < X.length - 1; c++) {
      out.push({
        x: X[c],
        y: Y[r],
        w: X[c + 1] - X[c],
        h: Y[r + 1] - Y[r],
        name: String(out.length + 1).padStart(pad, '0'),
      });
    }
  }
  return out;
}

// Líneas de una cuadrícula uniforme N columnas × M filas.
export function uniformLines(width: number, height: number, cols: number, rows: number) {
  const mk = (n: number, size: number) =>
    Array.from({ length: Math.max(0, Math.round(n) - 1) }, (_, i) => Math.round(((i + 1) * size) / Math.round(n)));
  return { xs: mk(cols, width), ys: mk(rows, height) };
}

export async function buildSlicesZip(
  doc: Doc,
  xs: number[],
  ys: number[],
  format: 'png' | 'jpeg',
  baseName: string,
): Promise<Blob> {
  const src = await renderDocToCanvas(doc, 1, format === 'jpeg' ? '#ffffff' : undefined);
  const rects = sliceRects(doc.width, doc.height, xs, ys);
  const ext = format === 'png' ? 'png' : 'jpg';
  const base = (baseName || 'rebanada').replace(/[^\w-]+/g, '_');
  const entries: ZipEntry[] = [];
  for (const r of rects) {
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.getContext('2d')!.drawImage(src, -r.x, -r.y);
    const blob: Blob = await new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob falló'))), `image/${format}`, 0.92),
    );
    entries.push({ name: `${base}_${r.name}.${ext}`, data: await blobToBytes(blob) });
  }
  return zipToBlob(entries);
}
