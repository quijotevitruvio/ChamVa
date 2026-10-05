// Biblioteca de sonidos incluida (public/sounds): tipos, validación del índice y búsqueda. Solo lógica pura (sin red ni DOM).
// El índice lo genera scripts/sounds/build-sounds.py; las pruebas comprueban que los archivos, los hashes y las licencias cuadran.

export interface SoundCategory {
  id: string;
  nombre: string;
}
export interface SoundEntry {
  id: string;
  nombre: string;
  categoria: string;
  /** segundos */
  duracion: number;
  etiquetas: string[];
  autor: string;
  /** página donde se verificó la licencia */
  fuente: string;
  licencia: string;
  /** SHA-256 (hex) del archivo tal como está en public/sounds */
  sha256: string;
  archivo: string;
  bytes: number;
  /** pensado para repetirse sin corte (ambientes, música en bucle) */
  bucle: boolean;
  canales: number;
}
export interface SoundIndex {
  version: number;
  verificado: string;
  licencias_permitidas: string[];
  presupuesto_bytes: number;
  categorias: SoundCategory[];
  sonidos: SoundEntry[];
}

/** Licencias que se aceptan en la biblioteca: solo dominio público / CC0. Cualquier otra rompe la prueba del índice. */
export const ALLOWED_SOUND_LICENSES = ['CC0-1.0'] as const;
/** Peso máximo de toda la biblioteca. */
export const SOUND_BUDGET_BYTES = 12 * 1024 * 1024;
const FILE_RE = /^[a-z0-9-]+\.ogg$/;
const SHA_RE = /^[0-9a-f]{64}$/;

/** Revisa el índice y devuelve la lista de problemas (vacía = correcto). */
export function checkSoundIndex(ix: SoundIndex, o: { allowed?: readonly string[]; budget?: number } = {}): string[] {
  const allowed = o.allowed ?? ALLOWED_SOUND_LICENSES;
  const budget = o.budget ?? SOUND_BUDGET_BYTES;
  const bad: string[] = [];
  const cats = new Set(ix.categorias.map((c) => c.id));
  const ids = new Set<string>();
  const files = new Set<string>();
  const hashes = new Map<string, string>();
  let total = 0;
  for (const s of ix.sonidos) {
    const w = (m: string) => bad.push(`${s.id || '(sin id)'}: ${m}`);
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) w('id vacío o con caracteres no permitidos');
    if (ids.has(s.id)) w('id repetido');
    ids.add(s.id);
    if (!s.nombre?.trim()) w('sin nombre');
    if (!cats.has(s.categoria)) w(`categoría desconocida «${s.categoria}»`);
    if (!(s.duracion > 0)) w('duración no válida');
    if (!Array.isArray(s.etiquetas) || !s.etiquetas.length) w('sin etiquetas');
    if (!s.autor?.trim()) w('sin autor');
    if (!/^https:\/\//.test(s.fuente ?? '')) w('la fuente debe ser una URL https');
    if (!allowed.includes(s.licencia)) w(`licencia no permitida «${s.licencia}»`);
    if (!SHA_RE.test(s.sha256 ?? '')) w('hash SHA-256 no válido');
    if (!FILE_RE.test(s.archivo ?? '')) w('nombre de archivo no válido');
    if (files.has(s.archivo)) w('archivo repetido');
    files.add(s.archivo);
    const prev = hashes.get(s.sha256);
    if (prev) w(`contenido duplicado de ${prev}`);
    else hashes.set(s.sha256, s.id);
    if (!(s.bytes > 0)) w('tamaño no válido');
    total += s.bytes || 0;
  }
  if (total > budget) bad.push(`peso total ${total} B supera el presupuesto de ${budget} B`);
  if (!ix.sonidos.length) bad.push('el índice está vacío');
  return bad;
}

/** Minúsculas y sin tildes: «Risa» y «risá» encuentran lo mismo. */
export const foldText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Filtra por categoría ('' = todas) y por texto: cada palabra debe aparecer en el nombre o en alguna etiqueta (sin tildes). */
export function filterSounds(list: readonly SoundEntry[], o: { query?: string; category?: string }): SoundEntry[] {
  const words = foldText(o.query ?? '').split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    if (o.category && s.categoria !== o.category) return false;
    if (!words.length) return true;
    const hay = foldText(s.nombre + ' ' + s.etiquetas.join(' ') + ' ' + s.id.replace(/-/g, ' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Ruta relativa (a la base de la app) del archivo; el hash en la URL renueva la caché si el sonido cambia. */
export const soundPath = (s: SoundEntry): string => `sounds/${s.archivo}?v=${s.sha256.slice(0, 10)}`;

export const totalSoundBytes = (ix: SoundIndex): number => ix.sonidos.reduce((n, s) => n + s.bytes, 0);

/** «0,4 s», «12 s», «1:14» */
export function fmtSoundDuration(sec: number): string {
  if (sec < 10) return `${sec.toFixed(1).replace('.', ',')} s`;
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec - m * 60)).padStart(2, '0')}`;
}
