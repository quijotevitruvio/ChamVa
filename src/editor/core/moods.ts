// Paletas por palabra o ambiente: un diccionario propio de ambientes con 5 colores
// base cada uno y variaciones deterministas (mismo texto + misma variación = mismos colores).
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './colorTools';

interface Mood {
  name: string;
  words: string[]; // sinónimos (sin tildes, minúsculas)
  colors: [string, string, string, string, string];
}

export const MOODS: Mood[] = [
  { name: 'Atardecer', words: ['atardecer', 'ocaso', 'puesta de sol', 'crepusculo'], colors: ['#2b1b4a', '#7a2f6b', '#d9455f', '#ff8c42', '#ffd29d'] },
  { name: 'Amanecer', words: ['amanecer', 'alba', 'aurora', 'madrugada'], colors: ['#fff1d6', '#ffd1a3', '#ff9f8a', '#c77dba', '#5b5f97'] },
  { name: 'Bosque', words: ['bosque', 'selva', 'arbol', 'naturaleza', 'jungla'], colors: ['#0b2b1d', '#1f5e3a', '#4c8c4a', '#9cc271', '#e3efc4'] },
  { name: 'Café', words: ['cafe', 'capuchino', 'latte', 'cafeteria', 'espresso'], colors: ['#2a1a10', '#5c3a21', '#8b5e3c', '#c9a27e', '#f1e3d3'] },
  { name: 'Minimalista', words: ['minimalista', 'minimal', 'sobrio', 'neutro', 'limpio'], colors: ['#111111', '#4a4a4a', '#9a9a9a', '#e2e2e2', '#fafafa'] },
  { name: 'Playa', words: ['playa', 'costa', 'verano', 'mar caribe', 'vacaciones'], colors: ['#0a6c8f', '#2ec4c9', '#f6e7c1', '#f2b880', '#ef7b5a'] },
  { name: 'Océano', words: ['oceano', 'mar', 'marino', 'agua', 'profundo'], colors: ['#03162f', '#0a3a68', '#1573a8', '#4fb3d9', '#bfe8f5'] },
  { name: 'Cielo', words: ['cielo', 'nube', 'nubes', 'aire', 'dia despejado'], colors: ['#0b5ea8', '#3b8fd9', '#8ec8f2', '#d6ecfa', '#ffffff'] },
  { name: 'Noche', words: ['noche', 'nocturno', 'oscuro', 'medianoche', 'luna'], colors: ['#05070f', '#0d1330', '#1b2a5c', '#4a5a9a', '#c7cdea'] },
  { name: 'Otoño', words: ['otono', 'hojas secas', 'cosecha', 'octubre'], colors: ['#3d1f0f', '#8a3b12', '#d1691f', '#e8a33d', '#f3dca2'] },
  { name: 'Invierno', words: ['invierno', 'nieve', 'frio', 'hielo', 'navidad blanca'], colors: ['#14213d', '#3a5a80', '#8fb3d1', '#dcebf5', '#ffffff'] },
  { name: 'Primavera', words: ['primavera', 'flores', 'jardin', 'floral', 'brote'], colors: ['#f7a8c4', '#fcd5ce', '#fff3b0', '#b5e48c', '#52b788'] },
  { name: 'Verano', words: ['verano', 'sol', 'tropical', 'calor', 'fruta'], colors: ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#1982c4'] },
  { name: 'Pastel', words: ['pastel', 'suave', 'dulce', 'tierno', 'bebe'], colors: ['#ffd6e0', '#ffe9c9', '#fffbc9', '#c9f2d9', '#cfe3ff'] },
  { name: 'Neón', words: ['neon', 'ciberpunk', 'cyberpunk', 'fluorescente', 'electrico'], colors: ['#0a0a1f', '#ff00c8', '#7a00ff', '#00e5ff', '#c6ff00'] },
  { name: 'Retro', words: ['retro', 'vintage', 'ochentas', 'antiguo', 'nostalgia'], colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'] },
  { name: 'Elegante', words: ['elegante', 'lujo', 'lujoso', 'premium', 'sofisticado'], colors: ['#0d0d0d', '#2b2b2b', '#6b5b3e', '#c8a96a', '#f3ead7'] },
  { name: 'Tierra', words: ['tierra', 'terracota', 'desierto', 'rustico', 'arcilla'], colors: ['#4a2c1a', '#8f4f2e', '#c97b4a', '#dfb48a', '#f3e2cf'] },
  { name: 'Lavanda', words: ['lavanda', 'relax', 'calma', 'spa', 'serenidad'], colors: ['#3c2a5c', '#6f56a8', '#a58fd6', '#d3c6ee', '#f4effb'] },
  { name: 'Menta', words: ['menta', 'fresco', 'frescura', 'limpieza', 'salud'], colors: ['#0f4c45', '#2a9d8f', '#7fd8be', '#c4f1e0', '#f1fcf7'] },
  { name: 'Fuego', words: ['fuego', 'lava', 'llama', 'caliente', 'pasion'], colors: ['#1a0000', '#7a0c0c', '#d92b1a', '#ff7a1a', '#ffd23f'] },
  { name: 'Hielo', words: ['glaciar', 'artico', 'polar', 'cristal'], colors: ['#0d3b66', '#2f78b3', '#7cc4e8', '#cdeefc', '#f5fcff'] },
  { name: 'Candy', words: ['candy', 'caramelo', 'golosina', 'fiesta', 'cumpleanos', 'infantil'], colors: ['#ff4d8d', '#ff9f1c', '#ffe14d', '#3ddc97', '#4cc9f0'] },
  { name: 'Corporativo', words: ['corporativo', 'empresa', 'negocios', 'profesional', 'oficina', 'finanzas'], colors: ['#0b2545', '#13315c', '#1d5fa8', '#8da9c4', '#eef4ed'] },
  { name: 'Tecnología', words: ['tecnologia', 'tech', 'futuro', 'digital', 'software', 'ciencia'], colors: ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#6fffe9'] },
  { name: 'Salud', words: ['medico', 'hospital', 'clinica', 'bienestar'], colors: ['#0b5d6b', '#1b9aaa', '#7fd1d1', '#e0f4f4', '#ffffff'] },
  { name: 'Romántico', words: ['romantico', 'amor', 'san valentin', 'boda', 'pasional'], colors: ['#590d22', '#a4133c', '#e5446d', '#ffb3c6', '#fff0f3'] },
  { name: 'Halloween', words: ['halloween', 'terror', 'miedo', 'brujas', 'calabaza'], colors: ['#0b0b0b', '#3b1d5a', '#7a2fb5', '#ff7a00', '#c8f26d'] },
  { name: 'Navidad', words: ['navidad', 'navideno', 'diciembre', 'fiestas'], colors: ['#7a0c1f', '#c8102e', '#0b5d3a', '#e8c66a', '#fff7e6'] },
  { name: 'Granja', words: ['granja', 'campo', 'rural', 'trigo', 'campesino'], colors: ['#6b4423', '#a67c3d', '#d8b45a', '#9aae5b', '#f4ecd2'] },
  { name: 'Industrial', words: ['industrial', 'metal', 'acero', 'urbano', 'concreto', 'cemento'], colors: ['#1f2428', '#3d464d', '#707b83', '#aab4ba', '#e6e9ea'] },
  { name: 'Deporte', words: ['deporte', 'energia', 'gimnasio', 'fitness', 'dinamico'], colors: ['#111827', '#e11d48', '#f97316', '#facc15', '#f9fafb'] },
  { name: 'Joyería', words: ['joyeria', 'oro', 'dorado', 'gala', 'premio'], colors: ['#241a05', '#7a5c12', '#d4af37', '#f2d680', '#fff8dc'] },
  { name: 'Fresa', words: ['fresa', 'frutilla', 'frambuesa', 'cereza', 'postre'], colors: ['#4a0d1d', '#a4133c', '#e63962', '#f6a6b8', '#fff1f3'] },
  { name: 'Aguacate', words: ['aguacate', 'verde', 'ecologico', 'eco', 'sostenible', 'organico'], colors: ['#1b3a1b', '#3f6b2a', '#7fa650', '#c3d6a0', '#f3f0d8'] },
  { name: 'Uva', words: ['uva', 'vino', 'morado', 'violeta', 'misterio'], colors: ['#1f0a2e', '#4a1d6e', '#7b3fa6', '#b88fd4', '#ece0f5'] },
];

export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hash determinista (FNV-1a) de un texto.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Variación n de un color: gira el tono y mueve un poco saturación/luminosidad.
function vary(hex: string, n: number): string {
  if (n === 0) return hex;
  const rgb = hexToRgb(hex) ?? { r: 128, g: 128, b: 128 };
  const { h, s, l } = rgbToHsl(rgb);
  const dh = ((n * 23) % 61) - 30; // -30..+30
  const ds = (((n * 7) % 5) - 2) * 0.04;
  const dl = (((n * 3) % 5) - 2) * 0.02;
  const cl = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  return rgbToHex(hslToRgb({ h: h + dh, s: cl(s + ds, 0, 1), l: cl(l + dl, 0.03, 0.97) }));
}

// Busca el ambiente que mejor encaja con el texto (palabra exacta o contenida).
export function findMood(text: string): Mood | null {
  const t = normalizeWord(text);
  if (!t) return null;
  const tokens = t.split(' ');
  let best: Mood | null = null;
  let bestScore = 0;
  for (const m of MOODS) {
    const all = [normalizeWord(m.name), ...m.words];
    let score = 0;
    for (const w of all) {
      if (w === t) score = Math.max(score, 10);
      else if (tokens.includes(w)) score = Math.max(score, 8);
      else if (t.includes(w) && w.length >= 3) score = Math.max(score, 6);
      else if (w.includes(t) && t.length >= 3) score = Math.max(score, 4);
    }
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

export interface MoodResult {
  name: string; // ambiente encontrado, o el propio texto si es inventado
  colors: string[]; // siempre 5 colores #rrggbb válidos
  known: boolean;
}

// 5 colores para el texto dado. `variation` = 0 es la paleta base; mayores dan alternativas.
// Si el texto no es un ambiente conocido, se inventa una paleta a partir de su hash.
export function moodPalette(text: string, variation = 0): MoodResult {
  const v = Math.max(0, Math.floor(variation) || 0);
  const mood = findMood(text);
  if (mood) {
    return { name: mood.name, colors: mood.colors.map((c) => vary(c, v)), known: true };
  }
  const t = normalizeWord(text) || 'color';
  const hs = hash(t);
  const h0 = hs % 360;
  const sat = 0.45 + ((hs >>> 9) % 40) / 100;
  const spread = 20 + ((hs >>> 17) % 30);
  const colors = [0.18, 0.34, 0.5, 0.72, 0.9].map((l, i) =>
    rgbToHex(hslToRgb({ h: h0 + (i - 2) * spread, s: Math.min(1, sat), l })),
  );
  return { name: text.trim() || 'Paleta', colors: colors.map((c) => vary(c, v)), known: false };
}

// «Sorpréndeme»: elige un ambiente al azar (con `seed` para pruebas) y una variación.
export function surpriseMood(seed = Math.floor(Math.random() * 1e9)): MoodResult {
  const m = MOODS[seed % MOODS.length];
  return moodPalette(m.name, Math.floor(seed / MOODS.length) % 12);
}
