// Presentación HTML autónoma: un único .html con las páginas como imágenes
// incrustadas (data URI). Sin dependencias ni red: flechas/espacio/clic para
// avanzar, F = pantalla completa, indicador de página.
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas, downloadBlob } from './export';

export interface Slide {
  src: string; // data URI de la imagen
  alt?: string;
  notes?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Evita cerrar el <script> por un «</script>» dentro de los datos.
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');

export function buildPresentationHtml(title: string, slides: Slide[]): string {
  const data = jsonForScript(slides.map((s) => ({ s: s.src, a: s.alt ?? '', n: s.notes ?? '' })));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
html,body{margin:0;height:100%;background:#000;color:#fff;font:14px system-ui,sans-serif;overflow:hidden}
#v{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer}
#v img{max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
#b{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:12px;padding:8px;opacity:0;transition:opacity .12s}
body:hover #b{opacity:1}
#b button{background:#222;color:#fff;border:1px solid #555;padding:4px 12px;cursor:pointer;font:inherit}
#n{position:fixed;left:0;right:0;bottom:44px;padding:8px 16px;background:#000c;display:none;white-space:pre-wrap}
</style>
</head>
<body>
<div id="v"><img id="i" alt=""></div>
<div id="n"></div>
<div id="b"><button id="p">‹</button><span id="c"></span><button id="x">›</button><button id="t">Notas (N)</button><button id="f">Pantalla completa (F)</button></div>
<script>
(function(){
var S=${data},k=0,i=document.getElementById('i'),c=document.getElementById('c'),n=document.getElementById('n');
function show(){if(k<0)k=0;if(k>=S.length)k=S.length-1;i.src=S[k].s;i.alt=S[k].a;c.textContent=(k+1)+' / '+S.length;n.textContent=S[k].n||'Esta página no tiene notas.';location.hash='#'+(k+1)}
function go(d){k+=d;show()}
function full(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}
function notes(){n.style.display=n.style.display==='block'?'none':'block'}
document.getElementById('v').onclick=function(e){go(e.clientX<innerWidth/3?-1:1)};
document.getElementById('p').onclick=function(){go(-1)};
document.getElementById('x').onclick=function(){go(1)};
document.getElementById('f').onclick=full;
document.getElementById('t').onclick=notes;
document.addEventListener('keydown',function(e){
var q=e.key;
if(q==='ArrowRight'||q===' '||q==='PageDown'){e.preventDefault();go(1)}
else if(q==='ArrowLeft'||q==='PageUp'){e.preventDefault();go(-1)}
else if(q==='Home'){k=0;show()}else if(q==='End'){k=S.length-1;show()}
else if(q==='f'||q==='F')full();else if(q==='n'||q==='N')notes()});
var h=parseInt((location.hash||'').slice(1),10);if(h>0)k=h-1;
show();
})();
</script>
</body>
</html>
`;
}

// Renderiza las páginas y descarga el .html. `maxSide` limita el tamaño de cada imagen.
export async function exportHtmlPresentation(
  pages: Doc[],
  opts: { maxSide?: number; onProgress?: (i: number, n: number) => void; isCancelled?: () => boolean } = {},
): Promise<boolean> {
  const maxSide = opts.maxSide ?? 1600;
  const slides: Slide[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (opts.isCancelled?.()) return false;
    opts.onProgress?.(i, pages.length);
    const p = pages[i];
    const scale = Math.min(1, maxSide / Math.max(p.width, p.height));
    const canvas = await renderDocToCanvas(p, scale, '#ffffff');
    slides.push({ src: canvas.toDataURL('image/jpeg', 0.9), alt: `Página ${i + 1}`, notes: p.speakerNotes });
    await new Promise((r) => setTimeout(r, 0));
  }
  const title = pages[0]?.name || 'Presentación ChamVa';
  const base = title.replace(/[^\w\-]+/g, '_');
  await downloadBlob(new Blob([buildPresentationHtml(title, slides)], { type: 'text/html' }), `${base}.html`);
  return true;
}
