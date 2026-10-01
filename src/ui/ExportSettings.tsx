import { useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { t } from '../i18n';
import {
  getExtra,
  loadPresets,
  savePresets,
  setExtra,
  setWatermark,
  upsertPreset,
  useExtra,
  type ExportPreset,
} from '../io/exportExtra';
import { buildScaleSpecs, parseWidths, SCALE_CHOICES, scaleLabel } from '../io/exportTargets';
import { buildFileName, dateStamp, NAME_VARIABLES } from '../io/fileNameTemplate';
import { prepareWatermarkImage, WM_POSITIONS, type WmPos } from '../io/watermark';
import { runLayersZip } from '../io/runExport';
import { toast } from './toast';
import type { Fmt } from './DownloadMenu';
import './export2.css';

type Scope = 'page' | 'all' | 'selection';

interface Props {
  format: string;
  setFormat: (f: Fmt) => void;
  scale: number;
  setScale: (n: number) => void;
  quality: number;
  setQuality: (n: number) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
}

const LOSSY = ['jpeg', 'webp', 'avif'];
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif', svg: 'svg' };

export function ExportSettings({ format, setFormat, scale, setScale, quality, setQuality, scope, setScope }: Props) {
  const x = useExtra();
  const doc = useEditor((s) => s.doc);
  const pageCount = useEditor((s) => s.pages.length);
  const pageIndex = useEditor((s) => s.pageIndex);
  const uploads = useEditor((s) => s.uploads);
  const raster = format === 'png' || LOSSY.includes(format);
  const image = raster || format === 'svg';
  const [presets, setPresets] = useState<ExportPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [busyLayers, setBusyLayers] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!image) return null;

  const wm = x.watermark;

  // ---- ajustes guardados ----
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast('Escribe un nombre para el ajuste.', 'info');
      return;
    }
    const e = getExtra();
    const p: ExportPreset = {
      name,
      format,
      scale,
      quality,
      scope,
      extraScales: e.extraScales,
      customWidths: e.customWidths,
      maxKB: e.maxKB,
      watermark: e.watermark,
      template: e.template,
    };
    const next = upsertPreset(presets, p);
    if (!savePresets(next)) toast('No se pudo guardar el ajuste en este equipo.', 'error');
    setPresets(next);
    setPresetName('');
    toast(`Ajuste «${name}» guardado`, 'success');
  };
  const applyPreset = (name: string) => {
    const p = presets.find((q) => q.name === name);
    if (!p) return;
    setFormat(p.format as Fmt);
    setScale(p.scale);
    setQuality(p.quality);
    setScope(p.scope);
    setExtra({
      extraScales: p.extraScales ?? [],
      customWidths: p.customWidths ?? '',
      maxKB: p.maxKB ?? 0,
      watermark: { ...getExtra().watermark, ...p.watermark },
      template: p.template || '{nombre}',
    });
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    savePresets(next);
    setPresets(next);
  };

  // ---- tamaños ----
  const toggleScale = (s: number) => {
    if (Math.abs(s - scale) < 1e-4) return; // el principal ya está siempre
    const has = x.extraScales.includes(s);
    setExtra({ extraScales: has ? x.extraScales.filter((v) => v !== s) : [...x.extraScales, s] });
  };
  const specs = buildScaleSpecs(doc.width, scale, x.extraScales, parseWidths(x.customWidths));

  // ---- marca de agua: imagen ----
  const useImage = async (src: string) => {
    try {
      const r = await prepareWatermarkImage(src);
      setWatermark({ kind: 'image', imageSrc: r.src, imageW: r.w, imageH: r.h, enabled: true });
    } catch (e) {
      toast('No se pudo usar esa imagen: ' + (e as Error).message, 'error');
    }
  };
  const onFile = (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => void useImage(String(r.result));
    r.readAsDataURL(f);
  };

  // ---- nombre ----
  const ext = EXT[format] ?? format;
  const first = specs[0];
  const previewName = `${buildFileName(
    x.template,
    {
      nombre: (doc.name || 'chamva').replace(/[^\w\-]+/g, '_'),
      fecha: dateStamp(),
      pagina: pageIndex + 1,
      n: 1,
      total: scope === 'all' ? pageCount * specs.length : specs.length,
      ancho: Math.round(doc.width * (format === 'svg' ? 1 : first.scale)),
      alto: Math.round(doc.height * (format === 'svg' ? 1 : first.scale)),
      escala: first.label,
      formato: ext,
    },
    { multiPages: scope === 'all' && pageCount > 1, multiScales: specs.length > 1 },
  )}.${ext}`;
  const manyFiles = (scope === 'all' && pageCount > 1) || (raster && specs.length > 1);

  return (
    <div className="dl2-sections">
      {/* Ajustes guardados */}
      <details className="dl2-sec">
        <summary>{t('Ajustes guardados')}</summary>
        <div className="dl2-body">
          {presets.length > 0 ? (
            <ul className="dl2-presets">
              {presets.map((p) => (
                <li key={p.name}>
                  <button className="dl2-link" onClick={() => applyPreset(p.name)} title="Aplicar este ajuste">
                    {p.name}
                  </button>
                  <span className="dl2-dim">
                    {p.format === 'jpeg' ? 'JPG' : p.format.toUpperCase()} @{scaleLabel(p.scale)}
                  </span>
                  <button className="dl2-x" onClick={() => deletePreset(p.name)} title="Borrar ajuste" aria-label="Borrar ajuste">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-hint">Guarda el formato, tamaño, calidad, alcance y marca de agua actuales con un nombre.</p>
          )}
          <div className="dl2-inline">
            <input
              type="text"
              value={presetName}
              placeholder="Nombre (p. ej. Instagram)"
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePreset()}
            />
            <button onClick={savePreset}>{t('Guardar')}</button>
          </div>
        </div>
      </details>

      {/* Varios tamaños */}
      {raster && (
        <details className="dl2-sec">
          <summary>
            {t('Más tamaños')}
            {specs.length > 1 && <span className="dl2-badge">{specs.length}</span>}
          </summary>
          <div className="dl2-body">
            <div className="dl2-checks">
              {SCALE_CHOICES.map((s) => {
                const isMain = Math.abs(s - scale) < 1e-4;
                return (
                  <label key={s} className={isMain ? 'is-main' : ''} title={isMain ? 'Es el tamaño principal' : undefined}>
                    <input
                      type="checkbox"
                      checked={isMain || x.extraScales.includes(s)}
                      disabled={isMain}
                      onChange={() => toggleScale(s)}
                    />
                    @{scaleLabel(s)}
                  </label>
                );
              })}
            </div>
            <label className="dl2-field">
              Anchos en px
              <input
                type="text"
                value={x.customWidths}
                placeholder="800, 1600"
                onChange={(e) => setExtra({ customWidths: e.target.value })}
              />
            </label>
            {specs.length > 1 && (
              <p className="dl-hint">
                Se descargan {specs.length} archivos en un ZIP: {specs.map((s) => s.label).join(', ')}.
              </p>
            )}
          </div>
        </details>
      )}

      {/* Peso máximo */}
      {LOSSY.includes(format) && (
        <details className="dl2-sec">
          <summary>
            {t('Peso máximo')}
            {x.maxKB > 0 && <span className="dl2-badge">{x.maxKB} KB</span>}
          </summary>
          <div className="dl2-body">
            <label className="dl2-field">
              Máx. (KB)
              <input
                type="number"
                min={0}
                step={10}
                value={x.maxKB || ''}
                placeholder="sin límite"
                onChange={(e) => setExtra({ maxKB: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </label>
            <p className="dl-hint">
              Busca la mayor calidad que cabe (hasta 8 pruebas; Esc cancela). Si ni con la calidad mínima cabe,
              te avisa para que reduzcas la escala.
            </p>
          </div>
        </details>
      )}

      {/* Marca de agua */}
      <details className="dl2-sec">
        <summary>
          {t('Marca de agua')}
          {wm.enabled && <span className="dl2-badge">on</span>}
        </summary>
        <div className="dl2-body">
          <label className="dl2-check">
            <input type="checkbox" checked={wm.enabled} onChange={(e) => setWatermark({ enabled: e.target.checked })} />
            Añadir a la exportación
          </label>
          <p className="dl-hint">Solo se aplica al archivo descargado, no al diseño. En PDF no se aplica.</p>
          <div className="seg">
            <button className={wm.kind === 'text' ? 'on' : ''} onClick={() => setWatermark({ kind: 'text' })}>
              Texto
            </button>
            <button className={wm.kind === 'image' ? 'on' : ''} onClick={() => setWatermark({ kind: 'image' })}>
              Imagen
            </button>
          </div>
          {wm.kind === 'text' ? (
            <>
              <input type="text" value={wm.text} onChange={(e) => setWatermark({ text: e.target.value })} placeholder="© Mi nombre" />
              <div className="seg">
                <button className={wm.color === '#ffffff' ? 'on' : ''} onClick={() => setWatermark({ color: '#ffffff' })}>
                  Blanco
                </button>
                <button className={wm.color === '#000000' ? 'on' : ''} onClick={() => setWatermark({ color: '#000000' })}>
                  Negro
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dl2-inline">
                <button onClick={() => fileRef.current?.click()}>Subir imagen…</button>
                {uploads.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const u = uploads.find((q) => q.id === e.target.value);
                      if (u) void useImage(u.src);
                    }}
                  >
                    <option value="">De la galería…</option>
                    {uploads.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  onFile(e.target.files);
                  e.target.value = '';
                }}
              />
              {wm.imageSrc ? (
                <img className="dl2-wmimg" src={wm.imageSrc} alt="Imagen de la marca de agua" />
              ) : (
                <p className="dl-hint">Elige una imagen (mejor un PNG transparente).</p>
              )}
            </>
          )}
          <div className="dl2-pos" role="group" aria-label="Posición">
            {WM_POSITIONS.map((p) => (
              <button
                key={p.id}
                className={wm.position === p.id ? 'on' : ''}
                title={p.label}
                aria-label={p.label}
                onClick={() => setWatermark({ position: p.id as WmPos })}
              />
            ))}
          </div>
          <button className={`dl2-tile${wm.position === 'tile' ? ' on' : ''}`} onClick={() => setWatermark({ position: 'tile' })}>
            Mosaico repetido
          </button>
          <label className="dl-row">
            Tamaño
            <input type="range" min={3} max={80} value={wm.size} onChange={(e) => setWatermark({ size: Number(e.target.value) })} />
          </label>
          <label className="dl-row">
            Opacidad
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={wm.opacity}
              onChange={(e) => setWatermark({ opacity: Number(e.target.value) })}
            />
          </label>
          {wm.position !== 'tile' && (
            <label className="dl-row">
              Margen
              <input type="range" min={0} max={25} value={wm.margin} onChange={(e) => setWatermark({ margin: Number(e.target.value) })} />
            </label>
          )}
        </div>
      </details>

      {/* Metadatos */}
      {(format === 'png' || format === 'jpeg') && (
        <details className="dl2-sec">
          <summary>
            {t('Metadatos')}
            {x.metaOn && <span className="dl2-badge">on</span>}
          </summary>
          <div className="dl2-body">
            <p className="dl-hint">
              Por defecto el archivo sale limpio: sin EXIF, GPS ni datos de tu equipo. Si quieres, añade estos
              datos (PNG y JPG; WebP/AVIF no los admiten aquí).
            </p>
            <label className="dl2-check">
              <input type="checkbox" checked={x.metaOn} onChange={(e) => setExtra({ metaOn: e.target.checked })} />
              Añadir metadatos
            </label>
            {x.metaOn &&
              (
                [
                  ['title', 'Título'],
                  ['author', 'Autor'],
                  ['description', 'Descripción'],
                  ['copyright', 'Derechos'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="dl2-field">
                  {label}
                  <input type="text" value={x.meta[k] ?? ''} onChange={(e) => setExtra({ meta: { ...x.meta, [k]: e.target.value } })} />
                </label>
              ))}
          </div>
        </details>
      )}

      {/* Nombre de archivo */}
      <details className="dl2-sec">
        <summary>{t('Nombre del archivo')}</summary>
        <div className="dl2-body">
          <input
            type="text"
            value={x.template}
            placeholder="{nombre}"
            onChange={(e) => setExtra({ template: e.target.value })}
          />
          <div className="dl2-chips">
            {NAME_VARIABLES.map((v) => (
              <button key={v} onClick={() => setExtra({ template: x.template + v })}>
                {v}
              </button>
            ))}
          </div>
          <p className="dl-hint dl2-name" title={previewName}>
            {manyFiles ? 'Ejemplo: ' : ''}
            {previewName}
          </p>
        </div>
      </details>

      {/* Todas las capas por separado */}
      {raster && (
        <button
          className="dl-go"
          disabled={busyLayers}
          title="Un PNG recortado por cada capa visible, en un ZIP, con su posición en capas.json"
          onClick={async () => {
            setBusyLayers(true);
            try {
              await runLayersZip(scale);
            } catch (e) {
              toast('No se pudieron exportar las capas: ' + (e as Error).message, 'error');
            } finally {
              setBusyLayers(false);
            }
          }}
        >
          {busyLayers ? '… ' : ''}
          {t('Exportar cada capa como PNG')}
        </button>
      )}
    </div>
  );
}
