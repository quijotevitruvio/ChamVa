import type { Background, Doc } from '../editor/core/types';
import { downloadBlob } from './export';

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

function normalizeBackground(doc: Doc): Doc {
  const bg = doc.background as unknown;
  if (typeof bg === 'string') doc.background = { type: 'solid', color: bg };
  else if (!bg || typeof bg !== 'object')
    doc.background = { type: 'transparent' } as Background;
  return doc;
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

export function readProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        let pages: Doc[];
        let pageIndex = 0;
        if (data && data.kind === 'chamva-project' && Array.isArray(data.pages)) {
          pages = data.pages;
          pageIndex = data.pageIndex ?? 0;
        } else if (data && Array.isArray(data.layers)) {
          // Formato antiguo: un solo documento.
          pages = [data as Doc];
        } else {
          throw new Error('Archivo de proyecto inválido');
        }
        pages = pages.map(normalizeBackground);
        resolve({ kind: 'chamva-project', version: 2, pageIndex, pages });
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}
