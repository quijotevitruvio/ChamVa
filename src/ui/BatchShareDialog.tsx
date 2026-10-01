// «Lote y compartir…»: convertir imágenes por lote, compartir con el sistema,
// informe de recursos, animación APNG/WebP, proyecto portátil y presentación HTML.
// Las tareas largas pasan por la cola de exportación (panel «Exportaciones»).
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../editor/state/store';
import { downloadBlob, exportDoc } from '../io/export';
import { runInQueue } from '../io/exportQueue';
import { isImageFile, runBatchConvert, type BatchFormat } from '../io/batchConvert';
import { savePortableProject } from '../io/portableProject';
import { exportHtmlPresentation } from '../io/htmlPresentation';
import { exportPagesToApngOrWebp, type AnimFormat } from '../io/exportAnimPages';
import { buildResourceReport, fmtBytes, reportToText } from '../io/resourceReport';
import { canShareFiles, shareOrDownload } from '../io/shareFile';
import { toast } from './toast';
import './batchshare.css';

type Tab = 'lote' | 'compartir' | 'informe' | 'anim' | 'archivo';
const TABS: [Tab, string][] = [
  ['lote', 'Convertir por lote'],
  ['compartir', 'Compartir'],
  ['informe', 'Informe de recursos'],
  ['anim', 'APNG / WebP animado'],
  ['archivo', 'Proyecto y presentación'],
];

// Páginas actuales (la página abierta puede tener cambios sin volcar a `pages`).
function currentPages() {
  const st = useEditor.getState();
  return { pages: st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p)), pageIndex: st.pageIndex };
}
const baseName = (n: string) => (n || 'chamva').replace(/[^\w-]+/g, '_');

export function BatchShareDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('lote');
  return createPortal(
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card bs-card" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <h3>Lote y compartir</h3>
        <div className="bs-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="bs-body">
          {tab === 'lote' && <BatchTab />}
          {tab === 'compartir' && <ShareTab />}
          {tab === 'informe' && <ReportTab />}
          {tab === 'anim' && <AnimTab />}
          {tab === 'archivo' && <FileTab />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Lote ----------------
function BatchTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<BatchFormat>('webp');
  const [quality, setQuality] = useState(0.85);
  const [maxW, setMaxW] = useState(0);
  const [maxH, setMaxH] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[] | null) => {
    const imgs = Array.from(list ?? []).filter(isImageFile);
    if (imgs.length) setFiles((p) => [...p, ...imgs]);
    else if (list && list.length) toast('No hay imágenes en lo que has soltado.', 'info');
  };
  const start = () => {
    const batch = files;
    if (!batch.length) return;
    runInQueue(`Lote: ${batch.length} imagen(es) → ${format.toUpperCase()}`, async (ctx) => {
      const r = await runBatchConvert(
        batch,
        { format, quality, maxW, maxH },
        { onProgress: (d, t, n) => ctx.progress(d, t, n), isCancelled: ctx.isCancelled },
      );
      if (ctx.isCancelled()) return;
      if (!r.zip) throw new Error(r.failed[0] ? `${r.failed[0].name}: ${r.failed[0].error}` : 'No se pudo convertir ninguna imagen');
      await downloadBlob(r.zip, `lote_${format}.zip`);
      toast(
        `${r.ok} convertida(s): ${fmtBytes(r.bytesIn)} → ${fmtBytes(r.bytesOut)}` +
          (r.failed.length ? ` · ${r.failed.length} con error (${r.failed.map((f) => f.name).join(', ')})` : ''),
        r.failed.length ? 'info' : 'success',
      );
    });
    toast('Convirtiendo en segundo plano: mira el panel «Exportaciones».', 'info');
  };

  return (
    <>
      <div
        className={`bs-drop${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        Suelta aquí las imágenes o haz clic para elegirlas
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <>
          <ul className="bs-list">
            {files.map((f, i) => (
              <li key={i}>
                <span>{f.name}</span>
                <span>{fmtBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => setFiles([])}>Vaciar lista ({files.length})</button>
        </>
      )}
      <label className="bs-row">
        Formato
        <select value={format} onChange={(e) => setFormat(e.target.value as BatchFormat)}>
          <option value="webp">WebP</option>
          <option value="jpeg">JPG</option>
          <option value="png">PNG</option>
          <option value="avif">AVIF</option>
        </select>
      </label>
      {format !== 'png' && (
        <label className="bs-row">
          Calidad ({Math.round(quality * 100)}%)
          <input type="range" min={0.1} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
        </label>
      )}
      <label className="bs-row">
        Ancho máximo (px, 0 = sin límite)
        <input type="number" min={0} max={16000} value={maxW} onChange={(e) => setMaxW(Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <label className="bs-row">
        Alto máximo (px, 0 = sin límite)
        <input type="number" min={0} max={16000} value={maxH} onChange={(e) => setMaxH(Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <p className="bs-hint">Nunca se agranda una imagen. Se conserva la proporción. El resultado es un ZIP; se puede cancelar desde el panel.</p>
      <button className="primary" disabled={!files.length} onClick={start}>
        Convertir {files.length ? `${files.length} imagen(es)` : ''}
      </button>
    </>
  );
}

// ---------------- Compartir ----------------
function ShareTab() {
  const [fmt, setFmt] = useState<'png' | 'jpeg'>('png');
  const [busy, setBusy] = useState(false);
  const can = canShareFiles();
  const go = async () => {
    setBusy(true);
    try {
      const doc = useEditor.getState().doc;
      const blob = await exportDoc(doc, { format: fmt, scale: 1, quality: 0.92 });
      const res = await shareOrDownload(blob, `${baseName(doc.name)}.${fmt === 'png' ? 'png' : 'jpg'}`, doc.name || 'ChamVa');
      if (res === 'downloaded') toast(can ? 'No se pudo compartir; se ha descargado.' : 'Este equipo no permite compartir archivos; se ha descargado.', 'info');
    } catch (e) {
      toast('No se pudo compartir: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label className="bs-row">
        Formato
        <select value={fmt} onChange={(e) => setFmt(e.target.value as 'png' | 'jpeg')}>
          <option value="png">PNG</option>
          <option value="jpeg">JPG</option>
        </select>
      </label>
      <p className="bs-hint">
        {can
          ? 'Se abrirá el menú de compartir del sistema con la imagen de la página actual.'
          : 'Este navegador o equipo no ofrece «Compartir» con archivos: se descargará la imagen.'}
      </p>
      <button className="primary" disabled={busy} onClick={go}>
        {can ? 'Compartir…' : 'Descargar imagen'}
      </button>
    </>
  );
}

// ---------------- Informe ----------------
function ReportTab() {
  const customFonts = useEditor((s) => s.customFonts);
  const report = useMemo(() => buildResourceReport(currentPages().pages, customFonts), [customFonts]);
  const title = currentPages().pages[0]?.name || 'Proyecto';
  const text = () => reportToText(report, title);
  const save = (content: string, mime: string, ext: string) =>
    downloadBlob(new Blob([content], { type: mime }), `${baseName(title)}_informe.${ext}`);
  return (
    <>
      <p className="bs-hint">
        {report.pages} página(s), {report.layers} capa(s), {report.images.length} imagen(es) (~{fmtBytes(report.imageBytes)}).
      </p>
      <div className="bs-sec">
        <h4>Fuentes ({report.fonts.length})</h4>
        <ul className="bs-list">
          {report.fonts.map((f) => (
            <li key={f.name}>
              <span>{f.name}</span>
              <span>
                {f.kind} · {f.uses}
              </span>
            </li>
          ))}
          {!report.fonts.length && <li>Sin texto</li>}
        </ul>
        <h4>Imágenes ({report.images.length})</h4>
        <ul className="bs-list">
          {report.images.map((i, k) => (
            <li key={k}>
              <span>
                p.{i.page} {i.layer}
              </span>
              <span>
                {i.naturalW}×{i.naturalH} · {fmtBytes(i.bytes)}
              </span>
            </li>
          ))}
          {!report.images.length && <li>Sin imágenes</li>}
        </ul>
        <h4>Colores ({report.colors.length})</h4>
        <div className="bs-colors">
          {report.colors.map((c) => (
            <span key={c.hex} style={{ background: c.hex }} title={`${c.hex} ×${c.uses}`} />
          ))}
        </div>
        <h4>Problemas ({report.issues.length})</h4>
        <ul className="bs-list">
          {report.issues.map((s, k) => (
            <li key={k} className={`bs-issue ${s.level}`}>
              <span>
                <b>{s.page ? `p.${s.page} ` : ''}{s.layer}</b>: {s.text}
              </span>
            </li>
          ))}
          {!report.issues.length && <li>Ninguno</li>}
        </ul>
      </div>
      <div className="bs-actions">
        <button
          onClick={() =>
            navigator.clipboard.writeText(text()).then(
              () => toast('Informe copiado', 'success'),
              () => toast('No se pudo copiar', 'error'),
            )
          }
        >
          Copiar informe
        </button>
        <button onClick={() => save(text(), 'text/plain', 'txt')}>Descargar .txt</button>
        <button onClick={() => save(JSON.stringify(report, null, 2), 'application/json', 'json')}>Descargar .json</button>
      </div>
    </>
  );
}

// ---------------- APNG / WebP animado ----------------
function AnimTab() {
  const [format, setFormat] = useState<AnimFormat>('apng');
  const [delay, setDelay] = useState(800);
  const [maxSize, setMaxSize] = useState(800);
  const pageCount = useEditor((s) => s.pages.length);
  const start = () => {
    const { pages } = currentPages();
    runInQueue(`Animación ${format === 'apng' ? 'APNG' : 'WebP'} (${pages.length} páginas)`, async (ctx) => {
      const blob = await exportPagesToApngOrWebp(pages, format, {
        delay,
        maxSize,
        onProgress: (i, n) => ctx.progress(i, n),
        isCancelled: ctx.isCancelled,
      });
      if (!blob || ctx.isCancelled()) return;
      await downloadBlob(blob, `${baseName(pages[0].name)}_anim.${format === 'apng' ? 'png' : 'webp'}`);
    });
    toast('Creando animación: mira el panel «Exportaciones».', 'info');
  };
  return (
    <>
      <label className="bs-row">
        Formato
        <select value={format} onChange={(e) => setFormat(e.target.value as AnimFormat)}>
          <option value="apng">APNG (.png animado)</option>
          <option value="webp">WebP animado</option>
        </select>
      </label>
      <label className="bs-row">
        Milisegundos por página
        <input type="number" min={50} max={10000} step={50} value={delay} onChange={(e) => setDelay(Math.max(50, Number(e.target.value) || 800))} />
      </label>
      <label className="bs-row">
        Lado mayor máximo (px)
        <input type="number" min={100} max={4000} step={50} value={maxSize} onChange={(e) => setMaxSize(Math.max(100, Number(e.target.value) || 800))} />
      </label>
      <p className="bs-hint">
        Cada página es un fotograma ({pageCount}), todas al tamaño de la primera. Con transparencia y sin límite de 256 colores como el GIF. Lottie no está disponible.
      </p>
      <button className="primary" disabled={pageCount < 2} onClick={start}>
        {pageCount < 2 ? 'Necesitas 2 páginas o más' : 'Crear animación'}
      </button>
    </>
  );
}

// ---------------- Proyecto portátil y presentación ----------------
function FileTab() {
  const portable = () => {
    const { pages, pageIndex } = currentPages();
    runInQueue('Proyecto portátil (.chamva)', async () => {
      await savePortableProject(pages, pageIndex);
    });
  };
  const html = () => {
    const { pages } = currentPages();
    runInQueue(`Presentación HTML (${pages.length} páginas)`, async (ctx) => {
      await exportHtmlPresentation(pages, { onProgress: (i, n) => ctx.progress(i, n), isCancelled: ctx.isCancelled });
    });
  };
  return (
    <>
      <div className="bs-sec">
        <h4>Proyecto portátil</h4>
        <p className="bs-hint">
          Un solo archivo .chamva con el diseño y todas sus imágenes (ZIP). Sirve para mover el proyecto a otro equipo; se abre con «Abrir proyecto».
        </p>
        <button onClick={portable}>Guardar proyecto portátil</button>
      </div>
      <div className="bs-sec">
        <h4>Presentación HTML autónoma</h4>
        <p className="bs-hint">
          Un único .html que se abre en cualquier navegador sin ChamVa: flechas, espacio o clic para avanzar, F para pantalla completa, N para notas.
        </p>
        <button onClick={html}>Crear presentación HTML</button>
      </div>
    </>
  );
}
