import type { Background, Doc } from '../editor/core/types';
import { downloadBlob } from './export';
import { normalizeLayoutFields } from '../editor/core/layout';
import { normalizePattern } from '../editor/core/patterns';
import { normalizeOrganization } from '../editor/core/organize';
import { normalizeImageCrops } from '../editor/core/imageCrop';
import { normalizeLayerMasks } from '../editor/core/layerMask';
import { isUnit, isValidDpi } from '../editor/core/units';

// Extensión propia (JSON por dentro). Permite asociar la app a estos archivos
// en Windows (doble clic → abrir en ChamVa). Los .chamva.json antiguos siguen
// abriendo igual: el lector solo mira el contenido.
const PROJECT_EXT = 'chamva';

export interface Project {
  kind: 'chamva-project';
  version: number;
  pageIndex: number;
  pages: Doc[];
  // Identidad del diseño (opcionales: los archivos antiguos no la traen y se abren
  // con la de siempre, el id de su primera página).
  designId?: string;
  designName?: string;
}

export interface ProjectMeta {
  designId?: string;
  designName?: string | null;
}

// Solo cadenas no vacías y de longitud razonable; cualquier otra cosa se ignora.
const metaStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && v.length <= 500 ? v : undefined;

function withMeta(project: Project, meta?: ProjectMeta | null): Project {
  const designId = metaStr(meta?.designId);
  const designName = metaStr(meta?.designName ?? undefined);
  return { ...project, ...(designId ? { designId } : {}), ...(designName ? { designName } : {}) };
}

// Unidad y dpi opcionales: se descartan los valores inválidos (el diseño se ve igual, en px).
function normalizeUnits(doc: Doc) {
  if (!isUnit(doc.unit)) delete doc.unit;
  if (!isValidDpi(doc.dpi)) delete doc.dpi;
}

function normalizeBackground(doc: Doc): Doc {
  const bg = doc.background as unknown;
  if (typeof bg === 'string') doc.background = { type: 'solid', color: bg };
  else if (!bg || typeof bg !== 'object')
    doc.background = { type: 'transparent' } as Background;
  if (doc.background.type === 'pattern')
    doc.background = { type: 'pattern', pattern: normalizePattern(doc.background.pattern) };
  normalizeLayoutFields(doc);
  normalizeUnits(doc);
  if (Array.isArray(doc.layers)) {
    normalizeImageCrops(doc);
    normalizeLayerMasks(doc); // máscaras de capa: quita las inválidas (sin campo = como siempre)
  }
  const g = (doc as { guides?: unknown }).guides as { x?: unknown; y?: unknown } | undefined;
  if (g && typeof g === 'object') {
    const nums = (a: unknown) =>
      Array.isArray(a) ? a.filter((n): n is number => typeof n === 'number' && isFinite(n)) : [];
    doc.guides = { x: nums(g.x), y: nums(g.y) };
  } else delete doc.guides;
  return normalizeOrganization(doc);
}

export function saveProject(pages: Doc[], pageIndex: number, meta?: ProjectMeta) {
  const project: Project = withMeta(
    {
      kind: 'chamva-project',
      version: 2,
      pageIndex,
      pages,
    },
    meta,
  );
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json',
  });
  const base = (pages[0]?.name || 'chamva').replace(/[^\w\-]+/g, '_');
  downloadBlob(blob, `${base}.${PROJECT_EXT}`);
}

// Parsea el texto de un proyecto (para archivos abiertos vía doble clic en Tauri).
export function parseProject(text: string): Project {
  const data = JSON.parse(text);
  let pages: Doc[];
  let pageIndex = 0;
  let meta: ProjectMeta | undefined;
  if (data && data.kind === 'chamva-project' && Array.isArray(data.pages)) {
    pages = data.pages;
    pageIndex = data.pageIndex ?? 0;
    meta = { designId: data.designId, designName: data.designName };
  } else if (data && Array.isArray(data.layers)) {
    pages = [data as Doc];
  } else {
    throw new Error('Archivo de proyecto inválido');
  }
  pages = pages.map(normalizeBackground);
  return withMeta({ kind: 'chamva-project', version: 2, pageIndex, pages }, meta);
}

// Abre un .chamva: ZIP portátil (se detecta por la firma) o JSON (formato clásico).
export async function readProjectFile(file: File): Promise<Project> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { isZip } = await import('./zipRead');
  if (isZip(bytes)) {
    const { portableBytesToJson } = await import('./portableProject');
    return parseProject(portableBytesToJson(bytes));
  }
  return parseProject(new TextDecoder().decode(bytes));
}
