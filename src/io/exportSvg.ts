import { blendCss } from '../editor/core/blend';
import { strokeToSvg } from '../editor/core/brush';
import { svgGrainDef, grainActive } from '../editor/core/grain';
import { withRegisteredMaster } from '../editor/core/master';
import { svgGradientDef } from '../editor/core/gradients';
import { svgPatternDef } from '../editor/core/patterns';
import {
  type Doc,
  type ShapeLayer,
  type TextLayer,
} from '../editor/core/types';
import { applyRetouch } from '../editor/core/retouchRender';
import { needsProcessing, processImageAsync } from '../editor/core/imageProcessing';
import { renderCastShadow, renderReflection } from '../editor/core/groundFx';
import { preloadFxImages } from '../editor/core/imageEffects';
import { isStrokeOnly, shapePath, shapeSvgPath } from '../editor/core/shapes';
import { baseStyle, runFont, styledLines } from '../editor/core/richText';
import { hasTextGradient, textGradientId } from '../editor/core/textGradient';
import { usesTypography } from '../editor/core/typography';
import { fieldsForDoc, type FieldValues } from '../editor/core/textMacros';
import { textSvgAdvanced } from './exportSvgTypography';
import { pagesForFields } from './docFields';
import { textFxSvg } from './exportSvgTextFx';
import { maskActive } from '../editor/core/layerMask';
import { maskPngDataUrl, maskedGroundSource } from '../editor/core/maskRender';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function transform(l: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) {
  return `translate(${l.x} ${l.y}) rotate(${l.rotation}) scale(${l.scaleX} ${l.scaleY})`;
}

function shadowStyle(l: {
  shadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
}) {
  return l.shadow
    ? ` style="filter:drop-shadow(${l.shadowX}px ${l.shadowY}px ${l.shadowBlur}px ${l.shadowColor})"`
    : '';
}

// Con relleno degradado se antepone su <defs> (id único por capa).
function shapeSvg(l: ShapeLayer): string {
  const sid = l.id.replace(/[^a-zA-Z0-9_-]/g, '');
  let defs = '';
  let fillRef: string | undefined;
  let strokeRef: string | undefined;
  if (l.fillGradient && !isStrokeOnly(l.shape)) {
    defs += svgGradientDef(`sg-${sid}`, l.fillGradient, l.width, l.height);
    fillRef = `url(#sg-${sid})`;
  }
  if (l.strokeGradient) {
    defs += svgGradientDef(`sk-${sid}`, l.strokeGradient, l.width, l.height);
    strokeRef = `url(#sk-${sid})`;
  }
  return (defs ? `<defs>${defs}</defs>` : '') + shapeSvgBody(l, fillRef, strokeRef);
}

function shapeSvgBody(l: ShapeLayer, fillOverride?: string, strokeOverride?: string): string {
  const fill = fillOverride ?? (isStrokeOnly(l.shape) ? 'none' : l.fill);
  const strokeOn = l.strokeWidth > 0 || isStrokeOnly(l.shape);
  const sw = isStrokeOnly(l.shape) ? Math.max(2, l.strokeWidth) : l.strokeWidth;
  const stroke = strokeOn
    ? ` stroke="${strokeOverride ?? l.stroke}" stroke-width="${sw}"`
    : '';
  const w = l.width;
  const h = l.height;
  switch (l.shape) {
    case 'rect':
      return `<rect width="${w}" height="${h}" rx="${l.cornerRadius}" fill="${fill}"${stroke}/>`;
    case 'ellipse':
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}/>`;
    case 'triangle':
      return `<polygon points="${w / 2},0 ${w},${h} 0,${h}" fill="${fill}"${stroke}/>`;
    case 'star': {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(' ')}" fill="${fill}"${stroke}/>`;
    }
    case 'line':
      return `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}"${stroke}/>`;
    case 'arrow': {
      const head = Math.min(h, w * 0.4);
      const my = h / 2;
      return `<path d="M0,${my} L${w - head},${my} M${w - head},${my - head / 2} L${w},${my} L${w - head},${my + head / 2}" fill="none"${stroke}/>`;
    }
    default:
      return `<path d="${shapeSvgPath(l.shape, w, h, l.cornerRadius)}" fill="${fill}"${stroke}/>`;
  }
}

// Texto con estilo por palabra: cada línea es un <tspan x y> y cada tramo
// con estilo propio un <tspan> anidado (peso, cursiva, color, subrayado).
function textSvg(l: TextLayer, measure: CanvasRenderingContext2D, fields?: Partial<FieldValues>): string {
  // Tipografía avanzada (caja, columnas, capitular, campos…): exportSvgTypography.ts.
  if (usesTypography(l)) return textSvgAdvanced(l, measure, fields);
  (measure as any).letterSpacing = `${l.letterSpacing || 0}px`;
  const lines = styledLines(l);
  const base = baseStyle(l);
  const widths = lines.map((line) =>
    line.reduce((sum, run) => {
      measure.font = runFont(l, run);
      return sum + measure.measureText(run.text).width;
    }, 0),
  );
  const boxW = Math.max(0, ...widths);
  const lh = l.lineHeight ?? 1;
  const pad = l.textEffect === 'background' ? l.fontSize * 0.3 : 0;
  const weight = l.bold ? ' font-weight="bold"' : '';
  const style = l.italic ? ' font-style="italic"' : '';
  const deco = l.underline ? ' text-decoration="underline"' : '';
  const ls = l.letterSpacing ? ` letter-spacing="${l.letterSpacing}"` : '';
  const stroke =
    l.strokeWidth > 0
      ? ` stroke="${l.strokeColor}" stroke-width="${l.strokeWidth}" paint-order="stroke"`
      : '';
  const shadow = l.shadow
    ? ` style="filter:drop-shadow(${l.shadowX}px ${l.shadowY}px ${l.shadowBlur}px ${l.shadowColor})"`
    : '';
  const tspans = lines
    .map((line, i) => {
      let lx = pad;
      if (l.align === 'center') lx += (boxW - widths[i]) / 2;
      else if (l.align === 'right') lx += boxW - widths[i];
      const runs = line
        .map((run) => {
          const a: string[] = [];
          if (run.bold !== base.bold) a.push(`font-weight="${run.bold ? 'bold' : 'normal'}"`);
          if (run.italic !== base.italic) a.push(`font-style="${run.italic ? 'italic' : 'normal'}"`);
          if (run.underline !== base.underline) a.push(`text-decoration="${run.underline ? 'underline' : 'none'}"`);
          if (run.color !== base.color) a.push(`fill="${run.color}"`);
          const t = esc(run.text);
          return a.length ? `<tspan ${a.join(' ')}>${t}</tspan>` : t;
        })
        .join('');
      return `<tspan x="${lx.toFixed(1)}" y="${(pad + i * l.fontSize * lh).toFixed(1)}">${runs}</tspan>`;
    })
    .join('');
  const bgRect =
    l.textEffect === 'background'
      ? `<rect width="${(boxW + pad * 2).toFixed(1)}" height="${(lines.length * l.fontSize * lh + pad * 2).toFixed(1)}" rx="${(l.fontSize * 0.2).toFixed(1)}" fill="${l.effectColor ?? '#000000'}"/>`
      : '';
  const gid = hasTextGradient(l) ? textGradientId(l.id) : null;
  const gdef = gid
    ? `<defs>${svgGradientDef(gid, l.fillGradient!, boxW + pad * 2, lines.length * l.fontSize * lh + pad * 2)}</defs>`
    : '';
  const baseFill = gid ? `url(#${gid})` : l.fill;
  return `${gdef}${bgRect}<text font-family="${esc(l.fontFamily)}" font-size="${l.fontSize}" fill="${baseFill}"${weight}${style}${deco}${ls}${stroke}${shadow} dominant-baseline="text-before-edge" xml:space="preserve">${tspans}</text>`;
}

export async function exportDocToSvg(doc: Doc): Promise<string> {
  doc = withRegisteredMaster(doc); // capas de la página maestra detrás (solo lectura)
  const measure = document.createElement('canvas').getContext('2d')!;
  const textFields = fieldsForDoc(doc, await pagesForFields());
  const parts: string[] = [];

  // Fondo
  let defs = '';
  if (doc.background.type === 'solid') {
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="${doc.background.color}"/>`);
  } else if (doc.background.type === 'gradient') {
    defs = `<defs>${svgGradientDef('bg', doc.background.gradient, doc.width, doc.height)}</defs>`;
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="url(#bg)"/>`);
  } else if (doc.background.type === 'pattern') {
    defs = `<defs>${svgPatternDef('bg', doc.background.pattern)}</defs>`;
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="url(#bg)"/>`);
  }
  // Grano del fondo: baldosa raster embebida (el «suavizar» de degradados solo existe en imagen).
  if (doc.background.type !== 'transparent' && grainActive(doc.background.grain)) {
    defs += `<defs>${svgGrainDef('bg-grain', doc.background.grain)}</defs>`;
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="url(#bg-grain)"/>`);
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const bm = blendCss(layer.blendMode);
    const firstPart = parts.length;
    const op = layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : '';
    // Máscara de capa: <mask> con la MISMA máscara final que el lienzo (PNG blanco con alfa), en el
    // marco local de la capa. Si no se puede calcular, la capa no se exporta (como en el lienzo).
    let mOpen = '';
    let mClose = '';
    let mDef = '';
    if (layer.mask && maskActive(layer.mask)) {
      const mk = await maskPngDataUrl(layer.mask);
      if (!mk) continue;
      const mid = `lm-${layer.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const r = layer.mask.rect;
      const out = mk.outside > 0
        ? `<path d="M-100000,-100000H100000V100000H-100000Z M${r.x},${r.y}v${r.h}h${r.w}v${-r.h}Z" fill-rule="evenodd" fill="#ffffff" fill-opacity="${(mk.outside / 255).toFixed(4)}"/>`
        : '';
      mDef = `<defs><mask id="${mid}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style="mask-type:luminance">${out}<image href="${mk.url}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="none"/></mask></defs>`;
      mOpen = `<g mask="url(#${mid})">`;
      mClose = '</g>';
    }
    if (layer.type === 'image') {
      const img = await applyRetouch(await loadImg(layer.src), layer);
      await preloadFxImages(layer.adjust);
      let baked = needsProcessing(layer)
        ? (await processImageAsync(img, layer, Infinity, { priority: 1, label: 'Exportando SVG' })).toDataURL('image/png')
        : layer.retouch && img instanceof HTMLCanvasElement
          ? img.toDataURL('image/png') // fuente + retoque horneados
          : layer.src;
      // Reflejo y sombra proyectada: se hornean a PNG y van como <image> bajo la capa.
      let fxSvg = '';
      if (layer.castShadow || layer.reflection) {
        let fxSrc: CanvasImageSource = await loadImg(baked);
        const nw = layer.naturalWidth;
        const nh = layer.naturalHeight;
        let fxShape = layer.maskShape;
        if (layer.mask && maskActive(layer.mask)) {
          // Con máscara de capa: reflejo y sombra de lo visible (imagen ya enmascarada).
          const ms = maskedGroundSource(fxSrc, nw, nh, layer.maskShape, layer.mask, { maxSide: 8192 });
          if (ms) {
            fxSrc = ms;
            fxShape = undefined;
          }
        }
        if (layer.castShadow) {
          const sh = renderCastShadow(fxSrc, nw, nh, fxShape, layer.castShadow);
          fxSvg += `<image href="${sh.canvas.toDataURL('image/png')}" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" opacity="${layer.castShadow.opacity}"/>`;
        }
        if (layer.reflection) {
          const rf = renderReflection(fxSrc, nw, nh, fxShape, layer.reflection);
          fxSvg += `<image href="${rf.canvas.toDataURL('image/png')}" x="0" y="${rf.y}" width="${nw}" height="${nh * Math.min(1, Math.max(0.05, layer.reflection.length))}"/>`;
        }
      }
      if (layer.maskShape) {
        const c = document.createElement('canvas');
        c.width = layer.naturalWidth;
        c.height = layer.naturalHeight;
        const cx = c.getContext('2d')!;
        shapePath(cx, layer.maskShape, layer.naturalWidth, layer.naturalHeight, 0);
        cx.clip();
        cx.drawImage(await loadImg(baked), 0, 0, layer.naturalWidth, layer.naturalHeight);
        baked = c.toDataURL('image/png');
      }
      parts.push(
        `<g transform="${transform(layer)}"${op}>${mDef}${fxSvg}<g${shadowStyle(layer)}>${mOpen}<image href="${baked}" width="${layer.naturalWidth}" height="${layer.naturalHeight}"/>${mClose}</g></g>`,
      );
    } else if (layer.type === 'stroke') {
      parts.push(`<g transform="${transform(layer)}"${op}>${mDef}${mOpen}${strokeToSvg(layer)}${mClose}</g>`);
    } else if (layer.type === 'shape') {
      parts.push(
        mOpen
          ? `<g transform="${transform(layer)}"${op}>${mDef}<g${shadowStyle(layer)}>${mOpen}${shapeSvg(layer)}${mClose}</g></g>`
          : `<g transform="${transform(layer)}"${op}${shadowStyle(layer)}>${shapeSvg(layer)}</g>`,
      );
    } else if (layer.type === 'text') {
      const fxText = await textFxSvg(layer, textFields); // efectos de texto (textFx.ts)
      parts.push(`<g transform="${transform(layer)}"${op}>${mDef}${mOpen}${fxText ?? textSvg(layer, measure, textFields)}${mClose}</g>`);
    }
    // Modo de fusión: grupo envolvente que se mezcla con lo de debajo (mix-blend-mode).
    if (bm !== 'normal' && parts.length > firstPart) {
      const wrapped = parts.splice(firstPart).join('');
      parts.push(`<g style="mix-blend-mode:${bm}">${wrapped}</g>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${defs}${parts.join('')}</svg>`;
}
