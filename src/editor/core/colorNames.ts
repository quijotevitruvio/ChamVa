// Nombre aproximado en español de cualquier color: el más cercano de un
// diccionario propio, medido con distancia en CIELAB.
import { hexToRgb, labDistance, rgbToLab, type Lab } from './colorTools';

// [nombre, #hex]. Más de 120 colores comunes, por familias.
export const COLOR_NAMES: [string, string][] = [
  ['Blanco', '#ffffff'], ['Blanco nieve', '#fffafa'], ['Marfil', '#fffff0'], ['Hueso', '#f5f0e1'],
  ['Crema', '#fff5d6'], ['Perla', '#eae6e1'], ['Gris humo', '#f0f0f0'], ['Gris claro', '#d3d3d3'],
  ['Plata', '#c0c0c0'], ['Gris', '#808080'], ['Gris pizarra', '#708090'], ['Gris grafito', '#4a4a4a'],
  ['Carbón', '#333333'], ['Negro', '#000000'], ['Negro azabache', '#0a0a0a'],
  ['Rojo', '#e02020'], ['Rojo vivo', '#ff0000'], ['Escarlata', '#ff2400'], ['Carmesí', '#dc143c'],
  ['Rojo cereza', '#b0112b'], ['Granate', '#800020'], ['Burdeos', '#5e1224'], ['Vino', '#722f37'],
  ['Rojo ladrillo', '#a52a2a'], ['Terracota', '#cc5f3d'], ['Coral', '#ff7f6e'], ['Salmón', '#fa8072'],
  ['Melocotón', '#ffcba4'], ['Durazno', '#ffdab9'], ['Rosa palo', '#e8b4b8'], ['Rosa pálido', '#ffd1dc'],
  ['Rosa', '#ff8fb1'], ['Rosa chicle', '#ff66c4'], ['Rosa intenso', '#e6007e'], ['Fucsia', '#ff00ff'],
  ['Magenta', '#cc0099'], ['Frambuesa', '#b5124f'],
  ['Naranja', '#ff8c1a'], ['Naranja vivo', '#ff6a00'], ['Mandarina', '#ff9f40'], ['Calabaza', '#e8731a'],
  ['Zanahoria', '#ed9121'], ['Óxido', '#b7410e'], ['Canela', '#a0522d'], ['Caramelo', '#c68642'],
  ['Ámbar', '#ffbf00'], ['Miel', '#e8a317'], ['Mostaza', '#d9a521'], ['Oro', '#d4af37'],
  ['Dorado', '#ffd700'], ['Amarillo', '#ffe600'], ['Amarillo limón', '#fff44f'], ['Amarillo pálido', '#fff7a8'],
  ['Maíz', '#f9e07a'], ['Arena', '#e4cf9b'], ['Beige', '#d9c7a3'], ['Camel', '#c19a6b'],
  ['Caqui', '#bdb76b'], ['Oliva', '#808000'], ['Verde oliva', '#6b7a2c'], ['Lima', '#b6e022'],
  ['Verde lima', '#a6e22e'], ['Verde pistacho', '#b8d98b'], ['Verde manzana', '#8ed13f'], ['Verde primavera', '#4fd16a'],
  ['Verde', '#2eaa4a'], ['Verde esmeralda', '#0f9d58'], ['Verde hoja', '#3d8b37'], ['Verde menta', '#98e5c4'],
  ['Menta pálido', '#cdf5e1'], ['Verde pino', '#1f5e3a'], ['Verde bosque', '#14452f'], ['Verde botella', '#0b3d2a'],
  ['Verde salvia', '#9caf88'], ['Verde musgo', '#6a7b3a'], ['Verde jade', '#00a86b'], ['Verde mar', '#2e8b6f'],
  ['Turquesa', '#1ec7c0'], ['Aguamarina', '#7fe5d0'], ['Verde azulado', '#008080'], ['Petróleo', '#0f5b66'],
  ['Cian', '#00d0e0'], ['Celeste', '#8ed8f8'], ['Azul cielo', '#5bb8f0'], ['Azul bebé', '#bfe3f5'],
  ['Azul hielo', '#d7eefa'], ['Azul', '#2f6fe0'], ['Azul eléctrico', '#1f4fff'], ['Azul rey', '#2748c8'],
  ['Azul cobalto', '#0047ab'], ['Azul acero', '#4682b4'], ['Azul vaquero', '#5d7fa8'], ['Azul oscuro', '#16328a'],
  ['Azul marino', '#0a1f5c'], ['Azul noche', '#0b1437'], ['Índigo', '#4b0082'], ['Azul medianoche', '#101a3d'],
  ['Violeta', '#7b2fe0'], ['Púrpura', '#8c2fa8'], ['Morado', '#7a3cc0'], ['Morado oscuro', '#4a1d7a'],
  ['Berenjena', '#4b2e4f'], ['Ciruela', '#7a2a5e'], ['Uva', '#6f2da8'], ['Lavanda', '#b9a3e6'],
  ['Lila', '#c9a0dc'], ['Malva', '#d8b4e2'], ['Orquídea', '#da70d6'], ['Glicina', '#c8b6e8'],
  ['Marrón', '#6f4e37'], ['Marrón claro', '#a67b5b'], ['Chocolate', '#4a2c1a'], ['Café', '#5c3a21'],
  ['Café con leche', '#b08968'], ['Castaño', '#7b4a2a'], ['Nogal', '#5a3a29'], ['Sepia', '#704214'],
  ['Cuero', '#8b5a2b'], ['Siena', '#8f4a2a'], ['Cacao', '#3b2214'], ['Arcilla', '#b66a50'],
  ['Cobre', '#b87333'], ['Bronce', '#9c6b30'], ['Champán', '#f7e7ce'], ['Rosa antiguo', '#c08081'],
  ['Rubor', '#de5d83'], ['Piel', '#f1c9a5'], ['Nude', '#d9b59c'],
];

const LAB_CACHE: Lab[] = COLOR_NAMES.map(([, hex]) => rgbToLab(hexToRgb(hex)!));

// Nombre del color del diccionario más cercano en Lab. Un color no válido → ''.
export function colorName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const lab = rgbToLab(rgb);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < LAB_CACHE.length; i++) {
    const d = labDistance(lab, LAB_CACHE[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return COLOR_NAMES[best][0];
}
