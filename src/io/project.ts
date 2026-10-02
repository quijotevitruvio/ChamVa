import type { Background, Doc } from '../editor/core/types';
import { downloadBlob } from './export';
import { normalizeLayoutFields } from '../editor/core/layout';
import { normalizePattern } from '../editor/core/patterns';
import { normalizeOrganization } from '../editor/core/organize';
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
  const g = (doc as { guides?: unknown }).guides as { x?: unknown; y?: unknown } | undefined;
  if (g && typeof g === 'object') {
    const nums = (a: unknown) =>
      Array.isArray(a) ? a.filter((n): n is number => typeof n === 'number' && isFinite(n)) : [];
    doc.guides = { x: nums(g.x), y: nums(g.y) };
  } else delete doc.guides;
  return normalizeOrganization(doc);
}

export function saveProject(pages: Doc[], pageIndex: number) {
  const project: Project = {
    kind: 'chamva-project',
    version: 2,
    pageIndex,
    pages,
  };
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
  if (data && data.kind === 'chamva-project' && Array.isArray(data.pages)) {
    pages = data.pages;
    pageIndex = data.pageIndex ?? 0;
  } else if (data && Array.isArray(data.layers)) {
    pages = [data as Doc];
  } else {
    throw new Error('Archivo de proyecto inválido');
  }
  pages = pages.map(normalizeBackground);
  return { kind: 'chamva-project', version: 2, pageIndex, pages };
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
