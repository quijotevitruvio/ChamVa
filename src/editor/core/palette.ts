import type { Gradient } from './types';

// Colores sólidos predeterminados (grises + colores vivos), estilo Canva.
export const PRESET_SOLIDS: string[] = [
  '#000000', '#545454', '#737373', '#a6a6a6', '#d9d9d9', '#f2f2f2', '#ffffff',
  '#ff3131', '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb', '#0097b2',
  '#0cc0df', '#5ce1e6', '#38b6ff', '#5271ff', '#004aad', '#000080', '#00bf63',
  '#7ed957', '#c1ff72', '#ffde59', '#ffbd59', '#ff914d', '#ff5733', '#a64d00',
];

// Degradados predeterminados.
export const PRESET_GRADIENTS: Gradient[] = [
  { angle: 90, stops: [{ offset: 0, color: '#434343' }, { offset: 1, color: '#000000' }] },
  { angle: 90, stops: [{ offset: 0, color: '#e0e0e0' }, { offset: 1, color: '#7a7a7a' }] },
  { angle: 90, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#c9c9c9' }] },
  { angle: 45, stops: [{ offset: 0, color: '#8ee063' }, { offset: 1, color: '#36b34a' }] },
  { angle: 45, stops: [{ offset: 0, color: '#c79a3b' }, { offset: 1, color: '#5a4715' }] },
  { angle: 45, stops: [{ offset: 0, color: '#b06ab3' }, { offset: 1, color: '#4568dc' }] },
  { angle: 90, stops: [{ offset: 0, color: '#1e2a78' }, { offset: 1, color: '#0a0f33' }] },
  { angle: 45, stops: [{ offset: 0, color: '#a8edea' }, { offset: 1, color: '#fed6e3' }] },
  { angle: 45, stops: [{ offset: 0, color: '#ff512f' }, { offset: 1, color: '#dd2476' }] },
  { angle: 45, stops: [{ offset: 0, color: '#43cea2' }, { offset: 1, color: '#185a9d' }] },
  { angle: 45, stops: [{ offset: 0, color: '#fbab7e' }, { offset: 1, color: '#f7ce68' }] },
  { angle: 45, stops: [{ offset: 0, color: '#ee9ca7' }, { offset: 1, color: '#ffdde1' }] },
];

// CSS para previsualizar un degradado en un botón.
export function gradientToCss(g: Gradient): string {
  const stops = g.stops
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  return `linear-gradient(${g.angle + 90}deg, ${stops})`;
}

// Nombres de color CSS frecuentes (para la búsqueda por nombre).
export const NAMED_COLORS: Record<string, string> = {
  negro: '#000000', blanco: '#ffffff', gris: '#808080', rojo: '#ff0000',
  rosa: '#ff66c4', naranja: '#ff914d', amarillo: '#ffde59', verde: '#00bf63',
  azul: '#5271ff', celeste: '#38b6ff', morado: '#8c52ff', violeta: '#5e17eb',
  cian: '#0cc0df', turquesa: '#0097b2', marron: '#a64d00', dorado: '#c79a3b',
};

// Resuelve un texto (nombre o #hex) a un color hex válido, o null.
export function resolveColor(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (NAMED_COLORS[t]) return NAMED_COLORS[t];
  let hex = t.startsWith('#') ? t : `#${t}`;
  if (/^#([0-9a-f]{3})$/.test(hex)) {
    hex = '#' + hex.slice(1).split('').map((c) => c + c).join('');
  }
  return /^#([0-9a-f]{6})$/.test(hex) ? hex : null;
}
