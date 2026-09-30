// Carga y persistencia de fuentes propias (.ttf/.otf/.woff/.woff2).
// Se guardan en IndexedDB como Blob (antes iban en localStorage, cuyo límite de
// ~5 MB se agotaba con una o dos fuentes y fallaba en silencio).
import { idbGet, idbSet } from '../../io/idb';

const KEY = 'fonts';
const LS_FONTS_LEGACY = 'chamva.customFonts';

interface StoredFont {
  family: string;
  blob: Blob;
}

async function register(family: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
}

// Migra las fuentes del formato antiguo (dataURL en localStorage) a IndexedDB.
async function migrateLegacy(): Promise<StoredFont[]> {
  try {
    const raw = localStorage.getItem(LS_FONTS_LEGACY);
    if (!raw) return [];
    const old = JSON.parse(raw) as { family: string; dataUrl: string }[];
    const out: StoredFont[] = [];
    for (const f of old) {
      const blob = await (await fetch(f.dataUrl)).blob();
      out.push({ family: f.family, blob });
    }
    localStorage.removeItem(LS_FONTS_LEGACY);
    return out;
  } catch {
    return [];
  }
}

// Registra todas las fuentes guardadas y devuelve sus nombres.
export async function loadStoredFonts(): Promise<string[]> {
  let stored = (await idbGet<StoredFont[]>(KEY)) ?? [];
  const legacy = await migrateLegacy();
  if (legacy.length) {
    stored = [...stored, ...legacy.filter((l) => !stored.some((s) => s.family === l.family))];
    await idbSet(KEY, stored);
  }
  await Promise.all(stored.map((f) => register(f.family, f.blob).catch(() => {})));
  return stored.map((f) => f.family);
}

// Carga una fuente desde un archivo, la registra y la persiste. Devuelve el nombre.
export async function addFontFromFile(file: File): Promise<string> {
  const family =
    file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Fuente';
  await register(family, file);
  const stored = (await idbGet<StoredFont[]>(KEY)) ?? [];
  if (!stored.some((f) => f.family === family)) {
    stored.push({ family, blob: file });
    await idbSet(KEY, stored);
  }
  return family;
}
