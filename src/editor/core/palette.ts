import type { Gradient } from './types';
import { gradientCss } from './gradients';

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

// 24 degradados más, por grupos: monocromos suaves, duotonos y metal.
const lin = (angle: number, a: string, b: string, c?: string): Gradient => ({
  angle,
  stops: c
    ? [{ offset: 0, color: a }, { offset: 0.5, color: b }, { offset: 1, color: c }]
    : [{ offset: 0, color: a }, { offset: 1, color: b }],
});
export const GRADIENT_GROUPS: { name: string; items: Gradient[] }[] = [
  {
    name: 'Monocromos suaves',
    items: [
      lin(90, '#f5f5f5', '#dcdcdc'), lin(90, '#e8eefc', '#c3d3f5'), lin(90, '#fde8ef', '#f7bfd2'),
      lin(90, '#e6f6ec', '#b7e3c6'), lin(90, '#fff4d9', '#fbdc92'), lin(90, '#ece6fb', '#c9bbf0'),
      lin(90, '#3b3b3b', '#1a1a1a'), lin(90, '#1d3557', '#0d1b2e'),
    ],
  },
  {
    name: 'Duotonos',
    items: [
      lin(45, '#ff6a88', '#ff99ac'), lin(45, '#12c2e9', '#c471ed'), lin(45, '#f64f59', '#12c2e9'),
      lin(45, '#fc466b', '#3f5efb'), lin(45, '#00b09b', '#96c93d'), lin(45, '#f7971e', '#ffd200'),
      lin(45, '#8e2de2', '#4a00e0'), lin(45, '#11998e', '#38ef7d'),
    ],
  },
  {
    name: 'Metal',
    items: [
      lin(90, '#f4f4f4', '#9a9a9a', '#f4f4f4'), lin(90, '#fff3b0', '#c9a227', '#fff3b0'),
      lin(90, '#ffe3d1', '#c2764f', '#ffe3d1'), lin(90, '#e6e9ee', '#7d8793', '#e6e9ee'),
      lin(135, '#434343', '#9a9a9a', '#2b2b2b'), lin(135, '#f6d365', '#b8860b', '#f6d365'),
      lin(135, '#cfd9df', '#6b7b8c', '#e2ebf0'), lin(135, '#d4a373', '#7f5539', '#e6ccb2'),
    ],
  },
];
export const PRESET_GRADIENTS_MORE: Gradient[] = GRADIENT_GROUPS.flatMap((g) => g.items);

// CSS para previsualizar un degradado en un botón.
export function gradientToCss(g: Gradient): string {
  return gradientCss(g);
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
