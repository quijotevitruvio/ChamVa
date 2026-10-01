// Texto con tipografía avanzada (caja, columnas, capitular, tabulaciones,
// sup/sub, kerning, campos, autoajuste) en SVG: cada tramo es un <tspan x y>
// con su posición ya calculada por typography.ts, igual que en el lienzo.
import type { TextLayer } from '../editor/core/types';
import { SCRIPT_DY, SCRIPT_SCALE, baseStyle, runFont } from '../editor/core/richText';
import { layoutText } from '../editor/core/typography';
import type { FieldValues } from '../editor/core/textMacros';
import { svgGradientDef } from '../editor/core/gradients';
import { hasTextGradient, textGradientId } from '../editor/core/textGradient';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function textSvgAdvanced(
  src: TextLayer,
  measure: CanvasRenderingContext2D,
  fields?: Partial<FieldValues>,
): string {
  (measure as any).letterSpacing = `${src.letterSpacing || 0}px`;
  const lay = layoutText(
    src,
    (l, run) => {
      measure.font = runFont(l, run);
      return measure.measureText(run.text).width;
    },
    fields,
  );
  const l = lay.layer;
  const base = baseStyle(l);
  const pad = l.textEffect === 'background' ? l.fontSize * 0.3 : 0;
  const W = lay.boxW + pad * 2;
  const H = lay.textH + pad * 2;
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
  const f1 = (n: number) => n.toFixed(1);
  const parts: string[] = [];

  // Capitulares.
  for (const d of lay.drops) {
    const a: string[] = [`font-size="${f1(d.fontSize)}"`];
    if (d.run.bold !== base.bold) a.push(`font-weight="${d.run.bold ? 'bold' : 'normal'}"`);
    if (d.run.italic !== base.italic) a.push(`font-style="${d.run.italic ? 'italic' : 'normal'}"`);
    if (d.run.color !== base.color) a.push(`fill="${d.run.color}"`);
    parts.push(`<tspan x="${f1(pad + d.x)}" y="${f1(pad + d.y)}" ${a.join(' ')}>${esc(d.run.text)}</tspan>`);
  }

  lay.lines.forEach((line, i) => {
    let x = pad + lay.xs[i];
    if (l.align === 'center') x += (lay.aw[i] - lay.widths[i]) / 2;
    else if (l.align === 'right') x += lay.aw[i] - lay.widths[i];
    const y = pad + lay.ys[i];
    line.forEach((run, r) => {
      const w = lay.runWidths[i][r];
      if (run.tab) {
        if (run.leader) {
          measure.font = runFont(l, run);
          const unit = measure.measureText(run.leader + ' ').width;
          const n = unit > 0 ? Math.floor((w - unit * 0.5) / unit) : 0;
          if (n > 0) {
            const start = x + w - n * unit;
            parts.push(
              `<tspan x="${f1(start)}" y="${f1(y)}" letter-spacing="${f1(unit - measure.measureText(run.leader).width + (l.letterSpacing || 0))}">${run.leader.repeat(n)}</tspan>`,
            );
          }
        }
        x += w;
        return;
      }
      const a: string[] = [];
      if (run.script) a.push(`font-size="${f1(l.fontSize * SCRIPT_SCALE)}"`);
      if (run.bold !== base.bold) a.push(`font-weight="${run.bold ? 'bold' : 'normal'}"`);
      if (run.italic !== base.italic) a.push(`font-style="${run.italic ? 'italic' : 'normal'}"`);
      if (run.underline !== base.underline) a.push(`text-decoration="${run.underline ? 'underline' : 'none'}"`);
      if (run.color !== base.color) a.push(`fill="${run.color}"`);
      const ry = y + (run.script ? l.fontSize * SCRIPT_DY[run.script] : 0);
      parts.push(
        `<tspan x="${f1(x + (run.dx ?? 0))}" y="${f1(ry)}"${a.length ? ' ' + a.join(' ') : ''}>${esc(run.text)}</tspan>`,
      );
      x += w;
    });
  });

  const bgRect =
    l.textEffect === 'background'
      ? `<rect width="${f1(W)}" height="${f1(H)}" rx="${(l.fontSize * 0.2).toFixed(1)}" fill="${l.effectColor ?? '#000000'}"/>`
      : '';
  const gid = hasTextGradient(l) ? textGradientId(l.id) : null;
  const gdef = gid ? `<defs>${svgGradientDef(gid, l.fillGradient!, W, H)}</defs>` : '';
  const baseFill = gid ? `url(#${gid})` : l.fill;
  return `${gdef}${bgRect}<text font-family="${esc(l.fontFamily)}" font-size="${l.fontSize}" fill="${baseFill}"${weight}${style}${deco}${ls}${stroke}${shadow} dominant-baseline="text-before-edge" xml:space="preserve">${parts.join('')}</text>`;
}
