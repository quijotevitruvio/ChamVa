// Carga y persistencia de fuentes propias (.ttf/.otf/.woff/.woff2).
const LS_FONTS = 'chamva.customFonts';

interface StoredFont {
  family: string;
  dataUrl: string;
}

function readStored(): StoredFont[] {
  try {
    return JSON.parse(localStorage.getItem(LS_FONTS) || '[]');
  } catch {
    return [];
  }
}

async function register(family: string, dataUrl: string): Promise<void> {
  const face = new FontFace(family, `url(${dataUrl})`);
  await face.load();
  document.fonts.add(face);
}

// Registra todas las fuentes guardadas y devuelve sus nombres.
export function loadStoredFonts(): string[] {
  const stored = readStored();
  stored.forEach((f) => {
    register(f.family, f.dataUrl).catch(() => {});
  });
  return stored.map((f) => f.family);
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
}

// Carga una fuente desde un archivo, la registra y la persiste. Devuelve el nombre.
export async function addFontFromFile(file: File): Promise<string> {
  const family =
    file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Fuente';
  const dataUrl = await fileToDataURL(file);
  await register(family, dataUrl);

  const stored = readStored();
  if (!stored.some((f) => f.family === family)) {
    stored.push({ family, dataUrl });
    try {
      localStorage.setItem(LS_FONTS, JSON.stringify(stored));
    } catch {
      // Si excede la cuota, la fuente queda solo para esta sesión.
    }
  }
  return family;
}
