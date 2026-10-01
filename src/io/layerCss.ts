// «Copiar CSS» de una capa: posición, tamaño, giro, color, fuente, sombra, borde y
// degradado → declaraciones CSS. Función pura (sin DOM). Es una aproximación
// pensada para web: las formas no rectangulares solo reciben su caja (y
// border-radius en rectángulos/elipses); las imágenes devuelven su caja.
import type { Layer } from '../editor/core/types';
import { gradientCss } from '../editor/core/gradients';

const r = (n: number) => String(Math.round(n * 100) / 100);
const px = (n: number) => `${r(n)}px`;

export function layerCssLines(l: Layer): string[] {
  const out: string[] = [];
  const add = (k: string, v: string) => out.push(`${k}: ${v};`);

  add('position', 'absolute');
  add('left', px(l.x));
  add('top', px(l.y));

  if (l.type === 'shape') {
    add('width', px(l.width * Math.abs(l.scaleX)));
    add('height', px(l.height * Math.abs(l.scaleY)));
    const strokeOnly = l.shape === 'line' || l.shape === 'arrow' || l.shape === 'doubleArrow';
    if (l.fillGradient && !strokeOnly) add('background-image', gradientCss(l.fillGradient));
    else if (!strokeOnly) add('background-color', l.fill);
    if (l.strokeWidth > 0 && !strokeOnly) add('border', `${px(l.strokeWidth)} solid ${l.stroke}`);
    if (l.shape === 'ellipse') add('border-radius', '50%');
    else if (l.shape === 'rect' && l.cornerRadius > 0) add('border-radius', px(l.cornerRadius));
    if (l.shadow) add('box-shadow', `${px(l.shadowX)} ${px(l.shadowY)} ${px(l.shadowBlur)} ${l.shadowColor}`);
  } else if (l.type === 'image') {
    add('width', px(l.naturalWidth * Math.abs(l.scaleX)));
    add('height', px(l.naturalHeight * Math.abs(l.scaleY)));
    if (l.maskShape === 'ellipse') add('border-radius', '50%');
    if (l.shadow) add('box-shadow', `${px(l.shadowX)} ${px(l.shadowY)} ${px(l.shadowBlur)} ${l.shadowColor}`);
  } else {
    // Texto
    const family = /[\s,]/.test(l.fontFamily) ? `"${l.fontFamily}"` : l.fontFamily;
    add('font-family', `${family}, sans-serif`);
    add('font-size', px(l.fontSize * Math.abs(l.scaleY)));
    if (l.bold) add('font-weight', '700');
    if (l.italic) add('font-style', 'italic');
    if (l.underline) add('text-decoration', 'underline');
    add('text-align', l.align);
    if (l.lineHeight && l.lineHeight !== 1) add('line-height', r(l.lineHeight));
    if (l.letterSpacing) add('letter-spacing', px(l.letterSpacing));
    if (l.textTransform === 'upper') add('text-transform', 'uppercase');
    else if (l.textTransform === 'lower') add('text-transform', 'lowercase');
    else if (l.textTransform === 'caps') add('text-transform', 'capitalize');
    if (l.fillGradient) {
      add('background-image', gradientCss(l.fillGradient));
      add('-webkit-background-clip', 'text');
      add('background-clip', 'text');
      add('color', 'transparent');
    } else add('color', l.fill);
    if (l.strokeWidth > 0) add('-webkit-text-stroke', `${px(l.strokeWidth)} ${l.strokeColor}`);
    if (l.shadow) add('text-shadow', `${px(l.shadowX)} ${px(l.shadowY)} ${px(l.shadowBlur)} ${l.shadowColor}`);
  }

  if (l.rotation) {
    add('transform', `rotate(${r(l.rotation)}deg)`);
    add('transform-origin', 'top left');
  }
  if (l.opacity < 1) add('opacity', r(l.opacity));
  return out;
}

// Texto listo para pegar: `.nombre { … }`.
export function layerToCss(l: Layer): string {
  const cls =
    (l.name || l.type)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'capa';
  const safe = /^[a-z]/.test(cls) ? cls : `capa-${cls}`;
  return `.${safe} {\n${layerCssLines(l)
    .map((x) => `  ${x}`)
    .join('\n')}\n}`;
}
