import type { Doc, TextLayer, ShapeLayer, Background } from './types';

let n = 0;
const id = () => `preset-${n++}`;

function text(p: Partial<TextLayer> & { text: string; y: number }): TextLayer {
  return {
    id: id(),
    type: 'text',
    name: p.text,
    text: p.text,
    fontFamily: p.fontFamily ?? 'Montserrat',
    fontSize: p.fontSize ?? 64,
    fill: p.fill ?? '#ffffff',
    align: 'center',
    bold: p.bold ?? true,
    italic: p.italic ?? false,
    textTransform: p.textTransform ?? 'none',
    letterSpacing: p.letterSpacing ?? 0,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadow: p.shadow ?? false,
    shadowColor: '#000000',
    shadowBlur: 12,
    shadowX: 0,
    shadowY: 4,
    x: p.x ?? 140,
    y: p.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    anim: p.anim,
    animDuration: 0.6,
  };
}

function rect(p: Partial<ShapeLayer> & { x: number; y: number; width: number; height: number }): ShapeLayer {
  return {
    id: id(),
    type: 'shape',
    name: 'Forma',
    shape: p.shape ?? 'rect',
    width: p.width,
    height: p.height,
    fill: p.fill ?? '#6c8cff',
    stroke: '#ffffff',
    strokeWidth: p.strokeWidth ?? 0,
    cornerRadius: p.cornerRadius ?? 0,
    x: p.x,
    y: p.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    shadow: false,
    shadowColor: '#000000',
    shadowBlur: 12,
    shadowX: 4,
    shadowY: 4,
  };
}

function doc(name: string, width: number, height: number, background: Background, layers: Doc['layers']): Doc {
  return { id: id(), name, width, height, background, layers, version: 1 };
}

const grad = (angle: number, a: string, b: string): Background => ({
  type: 'gradient',
  gradient: { angle, stops: [{ offset: 0, color: a }, { offset: 1, color: b }] },
});

export const PRESET_TEMPLATES: Doc[] = [
  doc('Cita', 1080, 1080, grad(135, '#0f2027', '#2c5364'), [
    text({ text: '“La creatividad es\ninteligencia\ndivirtiéndose”', y: 360, fontSize: 80, anim: 'fade' }),
    text({ text: '— Albert Einstein', y: 760, fontSize: 40, bold: false, fill: '#9fd0ff' }),
  ]),
  doc('Promoción', 1080, 1080, grad(135, '#ff512f', '#dd2476'), [
    text({ text: 'GRAN OFERTA', y: 250, fontSize: 90, textTransform: 'upper', anim: 'pop' }),
    text({ text: '-50%', y: 430, fontSize: 240, fill: '#ffde59', anim: 'pop' }),
    text({ text: 'Solo por hoy', y: 760, fontSize: 48, bold: false }),
  ]),
  doc('Título simple', 1080, 1080, { type: 'solid', color: '#ffffff' }, [
    rect({ x: 0, y: 470, width: 1080, height: 12, fill: '#6c8cff' }),
    text({ text: 'Tu título aquí', y: 360, fontSize: 84, fill: '#1e1e22', anim: 'rise' }),
    text({ text: 'Un subtítulo descriptivo', y: 540, fontSize: 40, bold: false, fill: '#555' }),
  ]),
  doc('Historia', 1080, 1920, grad(160, '#8e2de2', '#4a00e0'), [
    text({ text: 'NOVEDAD', y: 700, fontSize: 64, textTransform: 'upper', letterSpacing: 8, anim: 'slideDown' }),
    text({ text: 'Desliza\npara ver más', y: 900, fontSize: 96, anim: 'fade' }),
    text({ text: '↑', y: 1500, fontSize: 80, bold: false }),
  ]),
  doc('Evento', 1080, 1080, grad(135, '#141e30', '#243b55'), [
    rect({ x: 90, y: 120, width: 900, height: 6, fill: '#ffce54' }),
    text({ text: 'INVITACIÓN', y: 200, fontSize: 44, textTransform: 'upper', letterSpacing: 10, fill: '#ffce54', bold: false, anim: 'fade' }),
    text({ text: 'Fiesta de\nAniversario', y: 380, fontSize: 92, anim: 'rise' }),
    text({ text: 'Sábado · 20:00 h', y: 720, fontSize: 40, bold: false }),
    rect({ x: 90, y: 900, width: 900, height: 6, fill: '#ffce54' }),
  ]),
  doc('Rebajas', 1080, 1080, grad(45, '#f7971e', '#ffd200'), [
    text({ text: 'REBAJAS', y: 230, fontSize: 130, textTransform: 'upper', fill: '#7a3b00', anim: 'pop' }),
    text({ text: 'hasta', y: 470, fontSize: 44, fill: '#7a3b00', bold: false }),
    text({ text: '70%', y: 540, fontSize: 220, fill: '#c0392b', anim: 'pop' }),
    text({ text: 'en toda la tienda', y: 820, fontSize: 44, fill: '#7a3b00', bold: false }),
  ]),
  doc('Frase', 1080, 1080, { type: 'solid', color: '#101418' }, [
    text({ text: '"Hazlo con\npasión o\nno lo hagas"', y: 320, fontSize: 96, anim: 'fade' }),
    rect({ x: 440, y: 760, width: 200, height: 5, fill: '#6c8cff' }),
  ]),
  doc('Perfil', 1080, 1080, grad(135, '#42275a', '#734b6d'), [
    text({ text: '@tu_usuario', y: 460, fontSize: 72, anim: 'slideRight' }),
    text({ text: 'Creador de contenido', y: 600, fontSize: 40, bold: false, fill: '#e0c3ff' }),
  ]),
];
