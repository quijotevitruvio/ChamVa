// Animaciones de entrada para las capas (estilo "Animar" de Canva).
export interface AnimDef {
  id: string;
  label: string;
}

export const ANIMATIONS: AnimDef[] = [
  { id: 'none', label: 'Ninguna' },
  { id: 'fade', label: 'Aparecer' },
  { id: 'pop', label: 'Zoom (pop)' },
  { id: 'rise', label: 'Subir' },
  { id: 'slideLeft', label: 'Entrar ←' },
  { id: 'slideRight', label: 'Entrar →' },
  { id: 'slideUp', label: 'Entrar ↑' },
  { id: 'slideDown', label: 'Entrar ↓' },
];

export interface AnimState {
  dx: number; // desplazamiento en fracción del ancho del lienzo
  dy: number; // desplazamiento en fracción del alto
  scale: number; // multiplicador de escala
  opacity: number; // multiplicador de opacidad
}

const IDENTITY: AnimState = { dx: 0, dy: 0, scale: 1, opacity: 1 };

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

// Estado de la animación en progreso p (0 = inicio, 1 = posición final/normal).
export function animState(id: string | undefined, p: number): AnimState {
  if (!id || id === 'none') return IDENTITY;
  const e = easeOut(Math.max(0, Math.min(1, p)));
  const inv = 1 - e;
  switch (id) {
    case 'fade':
      return { dx: 0, dy: 0, scale: 1, opacity: e };
    case 'pop':
      return { dx: 0, dy: 0, scale: 0.4 + 0.6 * e, opacity: e };
    case 'rise':
      return { dx: 0, dy: inv * 0.15, scale: 1, opacity: e };
    case 'slideLeft':
      return { dx: -inv * 0.3, dy: 0, scale: 1, opacity: e };
    case 'slideRight':
      return { dx: inv * 0.3, dy: 0, scale: 1, opacity: e };
    case 'slideUp':
      return { dx: 0, dy: inv * 0.3, scale: 1, opacity: e };
    case 'slideDown':
      return { dx: 0, dy: -inv * 0.3, scale: 1, opacity: e };
    default:
      return IDENTITY;
  }
}

interface AnimLayer {
  anim?: string;
  animOut?: string;
  animDuration?: number;
}

// Estado combinado (entrada al inicio, salida al final) en el instante t del total.
export function layerAnimAt(layer: AnimLayer, t: number, total: number): AnimState {
  const dur = layer.animDuration ?? 0.6;
  if (layer.anim && layer.anim !== 'none' && t < dur) {
    return animState(layer.anim, t / dur);
  }
  if (layer.animOut && layer.animOut !== 'none') {
    const exitStart = total - dur;
    if (t >= exitStart) {
      const q = Math.min(1, (t - exitStart) / dur);
      return animState(layer.animOut, 1 - q); // invertido: de normal a fuera
    }
  }
  return IDENTITY;
}

// Duración total de la animación de un documento (entrada + pausa + salida).
export function animTotalFor(
  layers: AnimLayer[],
  hold = 1,
): number {
  const ins = layers
    .filter((l) => l.anim && l.anim !== 'none')
    .map((l) => l.animDuration ?? 0.6);
  const outs = layers
    .filter((l) => l.animOut && l.animOut !== 'none')
    .map((l) => l.animDuration ?? 0.6);
  const inMax = ins.length ? Math.max(...ins) : 0;
  const outMax = outs.length ? Math.max(...outs) : 0;
  return Math.max(0.6, inMax + hold + outMax);
}
