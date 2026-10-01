import { useLayoutEffect, useRef } from 'react';
import type { TextLayer } from '../core/types';
import {
  baseStyle,
  compressCharStyles,
  normalizeHex,
  resolveCharStyles,
  type ResolvedStyle,
  type TextSpan,
} from '../core/richText';
import { SymbolPicker } from '../../ui/SymbolPicker';
import { useEditor } from '../state/store';

// Editor de texto EN el lienzo (como Canva). Es un div contentEditable colocado
// exactamente encima del nodo, con la misma fuente, tamaño, giro y escala.
// Negrita/cursiva/subrayado/color por palabra con los botones o Ctrl+B/I/U.
// Al terminar (clic fuera, Esc o "Listo") se convierte a texto + spans.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(l: TextLayer): string {
  const chars = resolveCharStyles(l);
  const base = baseStyle(l);
  let html = '';
  let i = 0;
  while (i < l.text.length) {
    const st = chars[i];
    let j = i;
    let chunk = '';
    while (
      j < l.text.length &&
      chars[j].bold === st.bold &&
      chars[j].italic === st.italic &&
      chars[j].underline === st.underline &&
      chars[j].color === st.color &&
      chars[j].script === st.script
    ) {
      chunk += l.text[j];
      j++;
    }
    const css: string[] = [];
    if (st.bold !== base.bold) css.push(`font-weight:${st.bold ? 700 : 400}`);
    if (st.italic !== base.italic) css.push(`font-style:${st.italic ? 'italic' : 'normal'}`);
    if (st.underline !== base.underline)
      css.push(`text-decoration:${st.underline ? 'underline' : 'none'}`);
    if (st.color !== base.color) css.push(`color:${st.color}`);
    let inner = esc(chunk).replace(/\n/g, '<br>');
    if (st.script) inner = `<${st.script}>${inner}</${st.script}>`; // superíndice / subíndice
    html += css.length ? `<span style="${css.join(';')}">${inner}</span>` : inner;
    i = j;
  }
  // Un <br> final no dibuja línea nueva en contentEditable: se añade relleno.
  if (l.text.endsWith('\n')) html += '<br>';
  return html;
}

function rgbToHex(c: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return normalizeHex(c);
  return (
    '#' +
    [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  );
}

// Recorre el DOM editado y devuelve el texto plano con el estilo de cada letra.
function serialize(root: HTMLElement, base: ResolvedStyle) {
  let text = '';
  const styles: ResolvedStyle[] = [];
  const push = (s: string, st: ResolvedStyle) => {
    for (let k = 0; k < s.length; k++) {
      text += s[k];
      styles.push(st);
    }
  };
  const walk = (node: Node, underline: boolean, script?: 'sup' | 'sub') => {
    if (node.nodeType === Node.TEXT_NODE) {
      const el = node.parentElement ?? root;
      const cs = getComputedStyle(el);
      const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
      push(node.nodeValue ?? '', {
        bold: weight >= 600,
        italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
        underline,
        color: rgbToHex(cs.color),
        ...(script ? { script } : {}),
      });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') {
      push('\n', base);
      return;
    }
    const block = node !== root && (node.tagName === 'DIV' || node.tagName === 'P');
    if (block && text.length > 0 && !text.endsWith('\n')) push('\n', base);
    let ul = underline;
    if (node !== root) {
      const deco = getComputedStyle(node).textDecorationLine || '';
      if (node.tagName === 'U' || deco.includes('underline')) ul = true;
      else if (deco === 'none' && node.style.textDecoration === 'none') ul = false;
    }
    let sc = script;
    if (node !== root) {
      const va = node.style.verticalAlign;
      if (node.tagName === 'SUP' || va === 'super') sc = 'sup';
      else if (node.tagName === 'SUB' || va === 'sub') sc = 'sub';
    }
    node.childNodes.forEach((c) => walk(c, ul, sc));
  };
  walk(root, base.underline);
  // El <br> de relleno final no es contenido real.
  if (root.lastChild instanceof HTMLElement && root.lastChild.tagName === 'BR' && text.endsWith('\n')) {
    text = text.slice(0, -1);
    styles.pop();
  }
  return { text, styles };
}

interface Props {
  layer: TextLayer;
  left: number; // posición del origen de la capa dentro del área del lienzo
  top: number;
  scale: number; // escala de la vista (zoom)
  onDone: (text: string, spans: TextSpan[] | undefined) => void;
}

const SWATCHES = ['#000000', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

export function InlineTextEditor({ layer, left, top, scale, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const done = useRef(false);
  const brandColors = useEditor((s) => s.brandColors);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = toHtml(layer);
    el.focus();
    // Seleccionar todo: escribir reemplaza el texto (como al crear uno nuevo).
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* noop */
    }
    // Solo al abrir: después el DOM es la fuente de verdad hasta terminar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const { text, styles } = serialize(ref.current!, baseStyle(layer));
    const spans = compressCharStyles(styles, baseStyle(layer));
    onDone(text, spans.length ? spans : undefined);
  };

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreRange = () => {
    const r = savedRange.current;
    if (!r) return;
    ref.current?.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };
  const exec = (cmd: string, value?: string) => {
    restoreRange();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    saveRange();
  };

  const bg = layer.textEffect === 'background';
  const pad = bg ? layer.fontSize * 0.3 : 0;
  const transformMap: Record<string, string> = {
    upper: 'uppercase',
    lower: 'lowercase',
    caps: 'capitalize',
  };
  const colors = [...new Set([...brandColors, ...SWATCHES])].slice(0, 10);

  return (
    <>
      <div
        ref={barRef}
        className="inline-text-bar"
        style={{ left, top: Math.max(0, top - 44) }}
        onMouseDown={(e) => {
          // No robar el foco del texto (así la selección se mantiene).
          if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
          saveRange();
        }}
      >
        <button title="Negrita (Ctrl+B)" onClick={() => exec('bold')}>
          <b>B</b>
        </button>
        <button title="Cursiva (Ctrl+I)" onClick={() => exec('italic')}>
          <i>I</i>
        </button>
        <button title="Subrayado (Ctrl+U)" onClick={() => exec('underline')}>
          <u>U</u>
        </button>
        <button title="Superíndice (Ctrl+.)" onClick={() => exec('superscript')}>
          x²
        </button>
        <button title="Subíndice (Ctrl+,)" onClick={() => exec('subscript')}>
          x₂
        </button>
        <SymbolPicker onPick={(sym) => exec('insertText', sym)} />
        {colors.map((c) => (
          <button
            key={c}
            className="inline-swatch"
            style={{ background: c }}
            title={`Color ${c}`}
            onClick={() => exec('foreColor', c)}
          />
        ))}
        <input
          type="color"
          title="Otro color"
          onChange={(e) => exec('foreColor', e.target.value)}
        />
        <button className="primary" title="Terminar (Esc)" onClick={finish}>
          ✓ Listo
        </button>
      </div>
      <div
        ref={ref}
        className="inline-text-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          left,
          top,
          transform: `rotate(${layer.rotation}deg) scale(${scale * layer.scaleX}, ${scale * layer.scaleY})`,
          fontFamily: layer.fontFamily,
          fontSize: layer.fontSize,
          fontWeight: layer.bold ? 700 : 400,
          fontStyle: layer.italic ? 'italic' : 'normal',
          textDecoration: layer.underline ? 'underline' : 'none',
          color: layer.fill,
          letterSpacing: layer.letterSpacing || 0,
          lineHeight: layer.lineHeight ?? 1,
          textAlign: layer.align,
          textTransform: (transformMap[layer.textTransform] ?? 'none') as 'none',
          padding: pad,
          // Caja de ancho fijo: el editor también salta de línea (sin columnas ni capitular).
          ...(layer.boxWidth ? { width: layer.boxWidth, whiteSpace: 'pre-wrap' as const, boxSizing: 'content-box' as const } : {}),
          background: bg ? layer.effectColor ?? '#000000' : 'transparent',
          borderRadius: bg ? layer.fontSize * 0.2 : 0,
          outlineWidth: 2 / Math.max(0.05, scale * layer.scaleX),
        }}
        onKeyDown={(e) => {
          e.stopPropagation(); // que no lleguen los atajos del editor (Supr, flechas…)
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finish();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertLineBreak');
          } else if ((e.ctrlKey || e.metaKey) && (e.key === '.' || e.key === ',')) {
            // Superíndice / subíndice con Ctrl+. y Ctrl+,
            e.preventDefault();
            exec(e.key === '.' ? 'superscript' : 'subscript');
          }
        }}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        onPaste={(e) => {
          // Pegar siempre como texto plano (sin estilos de páginas web).
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        onBlur={(e) => {
          if (barRef.current?.contains(e.relatedTarget as Node)) return;
          finish();
        }}
      />
    </>
  );
}
