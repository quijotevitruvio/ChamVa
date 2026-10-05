import { useEffect, useMemo, useRef, useState } from 'react';
import { useDismiss } from './useDismiss';
import { t } from '../i18n';
import { useEditor } from '../editor/state/store';
import { exportablePages } from '../editor/core/pageOps';
import { downloadBlob, renderDocToCanvas } from '../io/export';
import {
  exportBleedPdf,
  exportBookletPdf,
  exportBookmarkedPdf,
  exportNUpPdf,
  exportStickerSheetPdf,
  type BleedFill,
} from '../io/exportPdf';
import {
  bookletAll,
  pxToMm,
  stepRepeat,
  type NUpCount,
  type SheetId,
  type SignatureSize,
} from '../io/exportPrint';
import {
  buildAppIconsZip,
  buildFaviconZip,
  buildSlicesZip,
  buildSprites,
  faviconHtml,
  sliceRects,
  spriteSources,
  uniformLines,
  type IconPlatform,
  type SpriteMode,
} from '../io/exportPackages';
import { toast } from './toast';
import { SliceEditor } from './SliceEditor';
import './exportmore.css';

type Tab =
  | 'bleed'
  | 'marks'
  | 'nup'
  | 'booklet'
  | 'sticker'
  | 'icons'
  | 'favicon'
  | 'sprites'
  | 'slices';

const TABS: [Tab, string][] = [
  ['bleed', 'Sangrado y cortes'],
  ['marks', 'PDF con marcadores'],
  ['nup', 'Varias por hoja'],
  ['booklet', 'Folleto'],
  ['sticker', 'Plancha'],
  ['icons', 'Iconos de app'],
  ['favicon', 'Favicon'],
  ['sprites', 'Sprites'],
  ['slices', 'Rebanadas'],
];

function useBase() {
  const doc = useEditor((s) => s.doc);
  return (doc.name || 'chamva').replace(/[^\w-]+/g, '_');
}

export function ExportMoreDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('bleed');
  const [busy, setBusy] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose });

  // Ejecuta una exportación mostrando el estado y avisando de errores.
  const run = async (job: () => Promise<{ blob: Blob; name: string; msg?: string }>) => {
    setBusy(true);
    try {
      const r = await job();
      await downloadBlob(r.blob, r.name);
      if (r.msg) toast(r.msg, 'success');
    } catch (e) {
      console.error(e);
      toast(`${t('No se pudo exportar')}: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="xm-overlay" onClick={onClose}>
      <div className="xm-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="xm-close" onClick={onClose} aria-label={t('Cerrar')}>
          ✕
        </button>
        <h3>{t('Más formatos')}</h3>
        <div className="seg">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        {tab === 'bleed' && <BleedTab busy={busy} run={run} />}
        {tab === 'marks' && <MarksTab busy={busy} run={run} />}
        {tab === 'nup' && <NUpTab busy={busy} run={run} />}
        {tab === 'booklet' && <BookletTab busy={busy} run={run} />}
        {tab === 'sticker' && <StickerTab busy={busy} run={run} />}
        {tab === 'icons' && <IconsTab busy={busy} run={run} />}
        {tab === 'favicon' && <FaviconTab busy={busy} run={run} />}
        {tab === 'sprites' && <SpritesTab busy={busy} run={run} />}
        {tab === 'slices' && <SlicesTab busy={busy} run={run} />}
      </div>
    </div>
  );
}

type Run = (job: () => Promise<{ blob: Blob; name: string; msg?: string }>) => Promise<void>;
interface TabProps {
  busy: boolean;
  run: Run;
}

// Páginas exportables del proyecto (sin las ocultas) con la actual al día.
function usePages() {
  const pages = useEditor((s) => s.pages);
  const doc = useEditor((s) => s.doc);
  const pageIndex = useEditor((s) => s.pageIndex);
  return useMemo(() => exportablePages(pages.map((p, i) => (i === pageIndex ? doc : p))), [pages, doc, pageIndex]);
}

function Go({ busy, onClick, children, disabled }: { busy: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className="xm-actions">
      <button className="primary" disabled={busy || disabled} onClick={onClick}>
        {busy ? `… ${t('Preparando')}` : children}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ sangrado ----
function BleedTab({ busy, run }: TabProps) {
  const pages = usePages();
  const doc = useEditor((s) => s.doc);
  const base = useBase();
  const [dpi, setDpi] = useState<96 | 300>(300);
  // Si el diseño ya tiene un sangrado guardado, es el valor inicial (no se modifica).
  const [bleed, setBleed] = useState(() => (doc.bleed ? Math.min(10, +pxToMm(doc.bleed, 300).toFixed(1)) : 3));
  const [crop, setCrop] = useState(true);
  const [reg, setReg] = useState(false);
  const [fill, setFill] = useState<BleedFill>('extend');
  const [all, setAll] = useState(false);
  const wmm = pxToMm(doc.width, dpi);
  const hmm = pxToMm(doc.height, dpi);
  return (
    <>
      <p className="xm-desc">
        {t('PDF a tamaño real: el tamaño final más el sangrado (el borde se repite hacia fuera) y marcas de corte para la imprenta.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Unidades del diseño')}
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value) as 96 | 300)}>
            <option value={300}>px a 300 ppp (impresión)</option>
            <option value={96}>px a 96 ppp (pantalla)</option>
          </select>
        </label>
        <label>
          {t('Sangrado')} (mm, 0–10)
          <input type="number" min={0} max={10} step={0.5} value={bleed} onChange={(e) => setBleed(Math.min(10, Math.max(0, Number(e.target.value) || 0)))} />
        </label>
        <label>
          {t('Relleno del sangrado')}
          <select value={fill} onChange={(e) => setFill(e.target.value as BleedFill)}>
            <option value="extend">{t('Repetir el borde')}</option>
            <option value="mirror">{t('Espejo')}</option>
          </select>
        </label>
        <label>
          {t('Tamaño final')}
          <input type="text" readOnly value={`${wmm.toFixed(1)} × ${hmm.toFixed(1)} mm`} />
        </label>
        <label className="xm-check">
          <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} /> {t('Marcas de corte')}
        </label>
        <label className="xm-check">
          <input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} /> {t('Marcas de registro')}
        </label>
        {pages.length > 1 && (
          <label className="xm-check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('Todas las páginas')} ({pages.length})
          </label>
        )}
      </div>
      <Go
        busy={busy}
        disabled={all && !pages.length}
        onClick={() =>
          run(async () => ({
            blob: await exportBleedPdf(all ? pages : [doc], { dpi, bleedMm: bleed, crop, registration: reg, fill }),
            name: `${base}_imprenta.pdf`,
          }))
        }
      >
        ⬇ {t('Descargar PDF de imprenta')}
      </Go>
    </>
  );
}

// ---------------------------------------------------------- marcadores ----
function MarksTab({ busy, run }: TabProps) {
  const pages = usePages();
  const base = useBase();
  return (
    <>
      <p className="xm-desc">
        {t('PDF con un marcador por página (panel «Marcadores» del lector), con el nombre de cada página.')}
      </p>
      <ul className="xm-desc">
        {pages.map((p, i) => (
          <li key={p.id}>{p.title?.trim() || p.name?.trim() || `${t('Página')} ${i + 1}`}</li>
        ))}
      </ul>
      <p className="xm-partial">
        {t('Parcial: los enlaces por capa necesitan que las capas puedan tener un enlace; esa función aún no existe, así que por ahora solo se crean los marcadores.')}
      </p>
      <Go busy={busy} disabled={!pages.length} onClick={() => run(async () => ({ blob: await exportBookmarkedPdf(pages), name: `${base}_marcadores.pdf` }))}>
        ⬇ {t('Descargar PDF con marcadores')}
      </Go>
    </>
  );
}

// --------------------------------------------------------------- n-up ----
function SheetSelect({ value, onChange }: { value: SheetId; onChange: (s: SheetId) => void }) {
  return (
    <label>
      {t('Hoja')}
      <select value={value} onChange={(e) => onChange(e.target.value as SheetId)}>
        <option value="a4">A4</option>
        <option value="letter">{t('Carta')}</option>
      </select>
    </label>
  );
}

function NUpTab({ busy, run }: TabProps) {
  const pages = usePages();
  const base = useBase();
  const [count, setCount] = useState<NUpCount>(2);
  const [sheet, setSheet] = useState<SheetId>('a4');
  const [gutter, setGutter] = useState(6);
  const [margin, setMargin] = useState(10);
  const [marks, setMarks] = useState(true);
  return (
    <>
      <p className="xm-desc">{t('Varias páginas del proyecto en cada hoja, con separación y marcas.')}</p>
      <div className="xm-grid">
        <label>
          {t('Páginas por hoja')}
          <select value={count} onChange={(e) => setCount(Number(e.target.value) as NUpCount)}>
            {[2, 4, 6, 9].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <SheetSelect value={sheet} onChange={setSheet} />
        <label>
          {t('Separación')} (mm)
          <input type="number" min={0} max={30} value={gutter} onChange={(e) => setGutter(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          {t('Margen')} (mm)
          <input type="number" min={0} max={40} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="xm-check">
          <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> {t('Marcas de corte')}
        </label>
      </div>
      <p className="xm-note">
        {pages.length} {t('páginas')} → {Math.ceil(pages.length / count)} {t('hojas')}
      </p>
      <Go busy={busy} disabled={!pages.length} onClick={() => run(async () => ({ blob: await exportNUpPdf(pages, { count, sheet, gutterMm: gutter, marginMm: margin, marks }), name: `${base}_${count}-por-hoja.pdf` }))}>
        ⬇ {t('Descargar PDF')}
      </Go>
    </>
  );
}

// ------------------------------------------------------------- folleto ----
function BookletTab({ busy, run }: TabProps) {
  const pages = usePages();
  const base = useBase();
  const [size, setSize] = useState<SignatureSize>(8);
  const [sheet, setSheet] = useState<SheetId>('a4');
  const sheets = bookletAll(pages.length, size).length;
  return (
    <>
      <p className="xm-desc">
        {t('Imposición para folletos: cada hoja lleva dos páginas por cara en el orden de plegado. Imprime a doble cara (voltear por el borde corto) y dobla por la mitad.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Cuadernillo de')}
          <select value={size} onChange={(e) => setSize(Number(e.target.value) as SignatureSize)}>
            <option value={4}>4 {t('páginas')}</option>
            <option value={8}>8 {t('páginas')}</option>
            <option value={16}>16 {t('páginas')}</option>
          </select>
        </label>
        <SheetSelect value={sheet} onChange={setSheet} />
      </div>
      <p className="xm-note">
        {pages.length} {t('páginas')} → {sheets} {t('hojas')} ({sheets * 2} {t('caras')}); {t('si faltan páginas para completar un cuadernillo se dejan en blanco.')}
      </p>
      <Go busy={busy} disabled={!pages.length} onClick={() => run(async () => ({ blob: await exportBookletPdf(pages, { size, sheet }), name: `${base}_folleto.pdf` }))}>
        ⬇ {t('Descargar PDF de folleto')}
      </Go>
    </>
  );
}

// -------------------------------------------------------------- plancha ----
function StickerTab({ busy, run }: TabProps) {
  const doc = useEditor((s) => s.doc);
  const base = useBase();
  const [dpi, setDpi] = useState<96 | 300>(300);
  const [sheet, setSheet] = useState<SheetId>('a4');
  const [gutter, setGutter] = useState(4);
  const [margin, setMargin] = useState(8);
  const [marks, setMarks] = useState(true);
  const w = pxToMm(doc.width, dpi);
  const h = pxToMm(doc.height, dpi);
  const fit = stepRepeat(w, h, sheet, margin, gutter, marks);
  return (
    <>
      <p className="xm-desc">
        {t('Repite este diseño en cuadrícula sobre la hoja (pegatinas, tarjetas, etiquetas) con medianil y marcas de corte.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Unidades del diseño')}
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value) as 96 | 300)}>
            <option value={300}>px a 300 ppp</option>
            <option value={96}>px a 96 ppp</option>
          </select>
        </label>
        <SheetSelect value={sheet} onChange={setSheet} />
        <label>
          {t('Medianil')} (mm)
          <input type="number" min={0} max={30} value={gutter} onChange={(e) => setGutter(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          {t('Margen')} (mm)
          <input type="number" min={0} max={40} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="xm-check">
          <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> {t('Marcas de corte')}
        </label>
      </div>
      <p className="xm-note">
        {t('Pieza')}: {w.toFixed(1)} × {h.toFixed(1)} mm →{' '}
        {fit.count > 0 ? `${fit.count} ${t('por hoja')} (${fit.cols} × ${fit.rows})` : t('no cabe en la hoja; cambia las unidades o el tamaño del diseño')}
      </p>
      <Go busy={busy} disabled={fit.count === 0} onClick={() => run(async () => {
        const r = await exportStickerSheetPdf(doc, { dpi, sheet, marginMm: margin, gutterMm: gutter, marks });
        return { blob: r.blob, name: `${base}_plancha.pdf`, msg: `${r.count} ${t('piezas por hoja')}` };
      })}>
        ⬇ {t('Descargar plancha')}
      </Go>
    </>
  );
}

// -------------------------------------------------------------- iconos ----
const PLATFORMS: [IconPlatform, string][] = [
  ['android', 'Android (mipmap 48–192)'],
  ['ios', 'iOS (20–1024)'],
  ['windows', 'Windows (16–256 + .ico)'],
  ['macos', 'macOS (.iconset)'],
  ['pwa', 'PWA 192/512 + maskable'],
];

function IconsTab({ busy, run }: TabProps) {
  const doc = useEditor((s) => s.doc);
  const base = useBase();
  const [plats, setPlats] = useState<IconPlatform[]>(['android', 'ios', 'windows', 'macos', 'pwa']);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [bg, setBg] = useState('#ffffff');
  const toggle = (p: IconPlatform) => setPlats((l) => (l.includes(p) ? l.filter((x) => x !== p) : [...l, p]));
  return (
    <>
      <p className="xm-desc">
        {t('ZIP con los tamaños estándar de cada plataforma a partir de este diseño, en carpetas y con un LEEME.')}
      </p>
      <div className="xm-plat">
        {PLATFORMS.map(([id, label]) => (
          <label key={id} className="xm-field xm-check">
            <input type="checkbox" checked={plats.includes(id)} onChange={() => toggle(id)} /> {label}
          </label>
        ))}
      </div>
      <div className="xm-grid">
        <label>
          {t('Si no es cuadrado')}
          <select value={fit} onChange={(e) => setFit(e.target.value as 'contain' | 'cover')}>
            <option value="contain">{t('Ajustar (con márgenes)')}</option>
            <option value="cover">{t('Rellenar (recortar)')}</option>
          </select>
        </label>
        <label>
          {t('Fondo de iOS y maskable')}
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
        </label>
      </div>
      <Go busy={busy} disabled={plats.length === 0} onClick={() => run(async () => ({ blob: await buildAppIconsZip(doc, plats, { fit, background: bg }), name: `${base}_iconos.zip` }))}>
        ⬇ {t('Descargar iconos')}
      </Go>
    </>
  );
}

// -------------------------------------------------------------- favicon ----
function FaviconTab({ busy, run }: TabProps) {
  const doc = useEditor((s) => s.doc);
  const base = useBase();
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [theme, setTheme] = useState('#ffffff');
  const [name, setName] = useState(doc.name || 'Mi sitio');
  const html = faviconHtml(theme);
  return (
    <>
      <p className="xm-desc">
        {t('ZIP con favicon.ico (16/32/48), PNG de 16, 32, 180, 192 y 512, site.webmanifest y el bloque HTML.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Nombre del sitio')}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('Color del tema')}
          <input type="color" value={theme} onChange={(e) => setTheme(e.target.value)} />
        </label>
        <label>
          {t('Si no es cuadrado')}
          <select value={fit} onChange={(e) => setFit(e.target.value as 'contain' | 'cover')}>
            <option value="contain">{t('Ajustar (con márgenes)')}</option>
            <option value="cover">{t('Rellenar (recortar)')}</option>
          </select>
        </label>
      </div>
      <span className="xm-note">{t('Pega esto dentro de <head>:')}</span>
      <textarea className="xm-code" readOnly value={html} onFocus={(e) => e.currentTarget.select()} />
      <div className="xm-actions">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(html);
              toast(t('Copiado'), 'success');
            } catch {
              toast(t('No se pudo copiar'), 'error');
            }
          }}
        >
          📋 {t('Copiar bloque HTML')}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => run(async () => ({ blob: (await buildFaviconZip(doc, name, { fit, background: '#ffffff', themeColor: theme })).blob, name: `${base}_favicon.zip` }))}
        >
          {busy ? `… ${t('Preparando')}` : `⬇ ${t('Descargar ZIP')}`}
        </button>
      </div>
    </>
  );
}

// -------------------------------------------------------------- sprites ----
function SpritesTab({ busy, run }: TabProps) {
  const pages = usePages();
  const base = useBase();
  const [source, setSource] = useState<'pages' | 'layers'>('pages');
  const [mode, setMode] = useState<SpriteMode>('grid');
  const [cols, setCols] = useState(4);
  const [gap, setGap] = useState(2);
  const [css, setCss] = useState(true);
  return (
    <>
      <p className="xm-desc">
        {t('Junta todas las páginas (o las capas visibles, recortadas a lo dibujado) en una sola imagen: sprites.png, sprites.json con las coordenadas y, si quieres, sprites.css.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Origen')}
          <select value={source} onChange={(e) => setSource(e.target.value as 'pages' | 'layers')}>
            <option value="pages">{t('Páginas')}</option>
            <option value="layers">{t('Capas visibles')}</option>
          </select>
        </label>
        <label>
          {t('Disposición')}
          <select value={mode} onChange={(e) => setMode(e.target.value as SpriteMode)}>
            <option value="grid">{t('Cuadrícula')}</option>
            <option value="strip-h">{t('Tira horizontal')}</option>
            <option value="strip-v">{t('Tira vertical')}</option>
          </select>
        </label>
        {mode === 'grid' && (
          <label>
            {t('Columnas')}
            <input type="number" min={1} max={32} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))} />
          </label>
        )}
        <label>
          {t('Separación')} (px)
          <input type="number" min={0} max={64} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="xm-check">
          <input type="checkbox" checked={css} onChange={(e) => setCss(e.target.checked)} /> {t('Incluir sprites.css')}
        </label>
      </div>
      <Go
        busy={busy}
        disabled={source === 'pages' && !pages.length}
        onClick={() =>
          run(async () => {
            const src = await spriteSources(pages, source);
            if (src.length === 0) throw new Error(t('No hay nada que exportar'));
            const r = await buildSprites(src, mode, cols, gap, css);
            return { blob: r.blob, name: `${base}_sprites.zip`, msg: `${src.length} ${t('imágenes')} · ${r.layout.width}×${r.layout.height}px` };
          })
        }
      >
        ⬇ {t('Descargar hoja de sprites')}
      </Go>
    </>
  );
}

// ----------------------------------------------------------- rebanadas ----
function SlicesTab({ busy, run }: TabProps) {
  const doc = useEditor((s) => s.doc);
  const base = useBase();
  const [src, setSrc] = useState('');
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [xs, setXs] = useState<number[]>([]);
  const [ys, setYs] = useState<number[]>([]);
  const [fmt, setFmt] = useState<'png' | 'jpeg'>('png');

  // Vista previa de la página actual (reducida).
  useEffect(() => {
    let alive = true;
    const s = Math.min(1, 700 / Math.max(doc.width, doc.height));
    renderDocToCanvas(doc, s).then((c) => alive && setSrc(c.toDataURL('image/png')));
    return () => {
      alive = false;
    };
  }, [doc]);

  const applyGrid = () => {
    const l = uniformLines(doc.width, doc.height, cols, rows);
    setXs(l.xs);
    setYs(l.ys);
  };
  const count = sliceRects(doc.width, doc.height, xs, ys).length;
  return (
    <>
      <p className="xm-desc">
        {t('Corta la página en rebanadas: elige una cuadrícula N×M y ajústala arrastrando las líneas. Se exportan como ZIP con nombres numerados.')}
      </p>
      <div className="xm-grid">
        <label>
          {t('Columnas')}
          <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label>
          {t('Filas')}
          <input type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))} />
        </label>
      </div>
      <div className="xm-actions">
        <button onClick={applyGrid}>{t('Aplicar cuadrícula')}</button>
        <button onClick={() => setXs([...xs, Math.round(doc.width / 2)])}>+ {t('Línea vertical')}</button>
        <button onClick={() => setYs([...ys, Math.round(doc.height / 2)])}>+ {t('Línea horizontal')}</button>
        <button
          onClick={() => {
            setXs([]);
            setYs([]);
          }}
        >
          {t('Quitar líneas')}
        </button>
      </div>
      {src && <SliceEditor src={src} width={doc.width} height={doc.height} xs={xs} ys={ys} onChange={(a, b) => { setXs(a); setYs(b); }} />}
      <div className="xm-grid">
        <label>
          {t('Formato')}
          <select value={fmt} onChange={(e) => setFmt(e.target.value as 'png' | 'jpeg')}>
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
        </label>
      </div>
      <Go busy={busy} disabled={count < 2} onClick={() => run(async () => ({ blob: await buildSlicesZip(doc, xs, ys, fmt, base), name: `${base}_rebanadas.zip`, msg: `${count} ${t('rebanadas')}` }))}>
        ⬇ {t('Descargar rebanadas')}
      </Go>
    </>
  );
}
