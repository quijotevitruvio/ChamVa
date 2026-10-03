// Proyecto portátil .chamva: un ZIP (método store, ver zip.ts) con
//   proyecto.json   el proyecto, con las imágenes sustituidas por «imagenes/<nombre>»
//   imagenes/       cada imagen embebida, una sola vez aunque se repita
//   LEEME.txt       explicación para quien lo abra sin ChamVa
// Se abre detectando la firma ZIP; los .chamva JSON antiguos siguen abriendo igual.
// Solo lo abre ChamVa (zipRead.ts lee únicamente ZIP «store»).
import type { Doc } from '../editor/core/types';
import { downloadBlob } from './export';
import { crc32, zipToBlob, type ZipEntry } from './zip';
import { readZip, type ZipFileEntry } from './zipRead';
import type { ProjectMeta } from './project';

export const PORTABLE_SCHEMA = 1;
const IMG_DIR = 'imagenes/';
const JSON_NAME = 'proyecto.json';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]),
);

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// «data:image/png;base64,AAAA» → { mime, bytes } (null si no es una data URL de imagen).
export function parseDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[\w.+-]+)((?:;[\w=.+-]+)*),(.*)$/s.exec(src);
  if (!m) return null;
  try {
    const bytes = m[2].includes(';base64')
      ? base64ToBytes(m[3])
      : new TextEncoder().encode(decodeURIComponent(m[3]));
    return { mime: m[1].toLowerCase(), bytes };
  } catch {
    return null;
  }
}

export interface PackedProject {
  json: string;
  images: { name: string; data: Uint8Array }[];
}

// Saca las imágenes embebidas (cualquier cadena data:image/… del proyecto).
export function packProject(project: unknown): PackedProject {
  const byUrl = new Map<string, string>();
  const images: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!v.startsWith('data:image/')) return v;
      const hit = byUrl.get(v);
      if (hit) return hit;
      const p = parseDataUrl(v);
      if (!p) return v;
      const ext = EXT_BY_MIME[p.mime] ?? 'bin';
      const base = `${crc32(p.bytes).toString(16).padStart(8, '0')}-${p.bytes.length.toString(36)}`;
      let name = `${IMG_DIR}${base}.${ext}`;
      for (let i = 2; used.has(name); i++) name = `${IMG_DIR}${base}_${i}.${ext}`; // misma huella, otro contenido
      used.add(name);
      images.push({ name, data: p.bytes });
      byUrl.set(v, name);
      return name;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  const body = walk(project) as Record<string, unknown>;
  return { json: JSON.stringify({ ...body, portableSchema: PORTABLE_SCHEMA }, null, 2), images };
}

// Inverso: cada cadena «imagenes/…» que exista en el ZIP vuelve a ser data URL.
export function unpackProject(files: ZipFileEntry[]): string {
  const jsonFile = files.find((f) => f.name === JSON_NAME);
  if (!jsonFile) throw new Error('El archivo no contiene proyecto.json');
  const urls = new Map<string, string>();
  for (const f of files) {
    if (!f.name.startsWith(IMG_DIR)) continue;
    const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    urls.set(f.name, `data:${mime};base64,${bytesToBase64(f.data)}`);
  }
  const data = JSON.parse(new TextDecoder().decode(jsonFile.data));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(IMG_DIR) ? (urls.get(v) ?? v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  const out = walk(data) as Record<string, unknown>;
  delete out.portableSchema;
  return JSON.stringify(out);
}

const README = `Proyecto portátil de ChamVa (esquema ${PORTABLE_SCHEMA})

Este archivo es un ZIP sin compresión con:
  proyecto.json   el diseño (páginas, capas, colores, textos)
  imagenes/       las imágenes usadas, tal cual (puedes abrirlas con cualquier visor)

Para seguir editando, ábrelo desde ChamVa (Archivo > Abrir proyecto).
Las fuentes propias no van dentro: instálalas o súbelas de nuevo en el otro equipo.
`;

export function buildPortableEntries(pages: Doc[], pageIndex: number, meta?: ProjectMeta): ZipEntry[] {
  const packed = packProject({
    kind: 'chamva-project',
    version: 2,
    pageIndex,
    pages,
    ...(meta?.designId ? { designId: meta.designId } : {}),
    ...(meta?.designName ? { designName: meta.designName } : {}),
  });
  const enc = new TextEncoder();
  return [
    { name: 'LEEME.txt', data: enc.encode(README) },
    { name: JSON_NAME, data: enc.encode(packed.json) },
    ...packed.images.map((i) => ({ name: i.name, data: i.data })),
  ];
}

export async function savePortableProject(pages: Doc[], pageIndex: number, meta?: ProjectMeta): Promise<void> {
  const base = (pages[0]?.name || 'chamva').replace(/[^\w\-]+/g, '_');
  await downloadBlob(zipToBlob(buildPortableEntries(pages, pageIndex, meta)), `${base}.chamva`);
}

// Texto JSON del proyecto a partir de los bytes de un ZIP portátil.
export function portableBytesToJson(bytes: Uint8Array): string {
  return unpackProject(readZip(bytes));
}
