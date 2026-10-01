import { useEffect, useMemo, useState } from 'react';
import type { Doc, SavedTemplate } from '../editor/core/types';
import { PRESET_TEMPLATES } from '../editor/core/presetTemplates';
import {
  COLOR_SWATCHES,
  EMPTY_FILTER,
  TEMPLATE_TAGS,
  type TemplateFilter,
  colorHistogram,
  fold,
  isFilterActive,
  matchesTemplate,
  normalizeTags,
  presetTags,
} from '../editor/core/templateMeta';
import { renderDocToCanvas } from '../io/export';
import { TemplateThumb } from './TemplateThumb';
import { t } from '../i18n';
import './library.css';

interface Props {
  templates: SavedTemplate[];
  onApply: (doc: Doc) => void;
  onRemove: (id: string) => void;
  onSetTags: (id: string, tags: string[]) => void;
}

// Histogramas de color por plantilla (se calculan una vez y se recuerdan).
const histCache = new Map<string, number[]>();

function pixelsHist(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  return colorHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

async function histOfThumb(src: string): Promise<number[]> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, 64 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  return pixelsHist(c);
}

// Color dominante de cada miniatura: las de fábrica se pintan pequeñas desde su
// documento; las del usuario se leen de su miniatura guardada.
function useHistograms(templates: SavedTemplate[]): { hists: Record<string, number[]>; ready: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const d of PRESET_TEMPLATES) {
        if (histCache.has(d.id)) continue;
        try {
          const c = await renderDocToCanvas(d, Math.min(1, 64 / Math.max(d.width, d.height)), '#ffffff');
          histCache.set(d.id, pixelsHist(c));
        } catch {
          /* sin color para esta plantilla */
        }
      }
      for (const tpl of templates) {
        const key = `${tpl.id}:${tpl.thumb.length}`;
        if (histCache.has(key)) continue;
        try {
          histCache.set(key, await histOfThumb(tpl.thumb));
        } catch {
          /* sin color para esta plantilla */
        }
      }
      if (!cancelled) bump((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [templates]);
  const hists: Record<string, number[]> = {};
  histCache.forEach((v, k) => (hists[k] = v));
  const ready = PRESET_TEMPLATES.every((d) => histCache.has(d.id));
  return { hists, ready };
}

// Pestaña «Plantillas»: buscador (texto + etiquetas + color dominante) y las
// listas «Prediseñadas» y «Mis plantillas».
export function TemplateLists({ templates, onApply, onRemove, onSetTags }: Props) {
  const [filter, setFilter] = useState<TemplateFilter>(EMPTY_FILTER);
  const [editing, setEditing] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');
  const { hists, ready } = useHistograms(templates);

  const userTags = useMemo(() => {
    const seen = new Set<string>(TEMPLATE_TAGS.map((x) => fold(x)));
    const extra: string[] = [];
    for (const tpl of templates)
      for (const tg of tpl.tags ?? []) {
        if (!seen.has(fold(tg))) {
          seen.add(fold(tg));
          extra.push(tg);
        }
      }
    return extra;
  }, [templates]);

  const presets = PRESET_TEMPLATES.filter((d) =>
    matchesTemplate(
      { name: d.name, tags: presetTags(d.name, d.width, d.height), hist: hists[d.id] },
      filter,
      ready && !!hists[d.id],
    ),
  );
  const mine = templates.filter((tpl) =>
    matchesTemplate(
      { name: tpl.name, tags: tpl.tags ?? [], hist: hists[`${tpl.id}:${tpl.thumb.length}`] },
      filter,
      !!hists[`${tpl.id}:${tpl.thumb.length}`],
    ),
  );
  const toggleTag = (tg: string) =>
    setFilter((f) => ({ ...f, tag: f.tag && fold(f.tag) === fold(tg) ? null : tg }));
  const editingTpl = templates.find((x) => x.id === editing);

  return (
    <>
      <input
        className="lib-input tpl-search"
        type="search"
        placeholder={t('Buscar plantillas…')}
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />
      <div className="tpl-tags">
        {[...TEMPLATE_TAGS, ...userTags].map((tg) => (
          <button
            key={tg}
            className={`lib-chip ${filter.tag && fold(filter.tag) === fold(tg) ? 'on' : ''}`}
            onClick={() => toggleTag(tg)}
          >
            {tg}
          </button>
        ))}
      </div>
      <div className="tpl-swatches" aria-label={t('Color dominante')}>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c.id}
            className={`tpl-swatch ${filter.color === c.id ? 'on' : ''}`}
            style={{ background: c.css }}
            title={c.label}
            aria-label={c.label}
            onClick={() => setFilter((f) => ({ ...f, color: f.color === c.id ? null : c.id }))}
          />
        ))}
        {isFilterActive(filter) && (
          <button className="lib-btn" onClick={() => setFilter(EMPTY_FILTER)}>
            {t('Limpiar')}
          </button>
        )}
      </div>

      <h4 className="rail-sub">{t('Prediseñadas')}</h4>
      {presets.length === 0 && <p className="rail-hint">{t('Ninguna coincide.')}</p>}
      <div className="uploads-grid">
        {presets.map((tpl) => (
          <TemplateThumb key={tpl.id} doc={tpl} label={tpl.name} onClick={() => onApply(tpl)} />
        ))}
      </div>

      <h4 className="rail-sub">{t('Mis plantillas')}</h4>
      {templates.length === 0 && <p className="rail-hint">Guarda un diseño y reutilízalo cuando quieras.</p>}
      {templates.length > 0 && mine.length === 0 && <p className="rail-hint">{t('Ninguna coincide.')}</p>}
      {editingTpl && (
        <div className="lib-row" style={{ flexWrap: 'wrap' }}>
          <label style={{ minWidth: 0 }}>{t('Etiquetas de')} «{editingTpl.name}»</label>
          <input
            className="lib-input"
            autoFocus
            placeholder={t('boda, cliente, rosa')}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSetTags(editingTpl.id, normalizeTags(tagText));
                setEditing(null);
              }
              if (e.key === 'Escape') setEditing(null);
            }}
          />
          <button
            className="lib-btn"
            onClick={() => {
              onSetTags(editingTpl.id, normalizeTags(tagText));
              setEditing(null);
            }}
          >
            {t('Guardar')}
          </button>
        </div>
      )}
      <div className="uploads-grid">
        {mine.map((tpl) => (
          <div key={tpl.id} className="upload-thumb" onClick={() => onApply(tpl.doc)} title={`Aplicar "${tpl.name}"`}>
            <img src={tpl.thumb} alt={tpl.name} />
            <button
              className="tpl-edit"
              title={t('Etiquetas')}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(tpl.id);
                setTagText((tpl.tags ?? []).join(', '));
              }}
            >
              #
            </button>
            <button
              className="upload-del"
              title="Quitar plantilla"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(tpl.id);
              }}
            >
              ✕
            </button>
            {(tpl.tags?.length ?? 0) > 0 && <span className="tpl-tagline">{tpl.tags!.map((x) => `#${x}`).join(' ')}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
