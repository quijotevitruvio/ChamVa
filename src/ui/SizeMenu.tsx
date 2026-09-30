import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import { CANVAS_PRESETS } from '../editor/core/types';
import { toast } from './toast';
import { t } from '../i18n';

interface CustomSize {
  label: string;
  width: number;
  height: number;
}

const SIZES_LS = 'chamva.customSizes';

function loadSizes(): CustomSize[] {
  try {
    return JSON.parse(localStorage.getItem(SIZES_LS) ?? '[]');
  } catch {
    return [];
  }
}

interface Props {
  customW: string;
  customH: string;
  setCustomW: (v: string) => void;
  setCustomH: (v: string) => void;
  onClose: () => void;
}

// Menú "Tamaño del lienzo": presets, medida libre, tamaños propios y Magic Resize.
export function SizeMenu({ customW, customH, setCustomW, setCustomH, onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const setCanvasSize = useEditor((s) => s.setCanvasSize);
  const addResizedPage = useEditor((s) => s.addResizedPage);
  const [customSizes, setCustomSizes] = useState<CustomSize[]>(loadSizes);
  const [sizeName, setSizeName] = useState('');

  const saveSizes = (list: CustomSize[]) => {
    setCustomSizes(list);
    localStorage.setItem(SIZES_LS, JSON.stringify(list));
  };
  const apply = (w: number, h: number) => {
    setCanvasSize(w, h);
    setCustomW(String(w));
    setCustomH(String(h));
  };
  const parsed = () => ({
    w: Math.max(1, Math.round(Number(customW) || doc.width)),
    h: Math.max(1, Math.round(Number(customH) || doc.height)),
  });
  const all = [...CANVAS_PRESETS, ...customSizes];

  return (
    <div className="dropdown size-menu">
      <label className="dl-row">
        Tamaño
        <select
          value={
            all.some((p) => p.width === doc.width && p.height === doc.height)
              ? `${doc.width}x${doc.height}`
              : 'custom'
          }
          onChange={(e) => {
            const p = all.find((x) => `${x.width}x${x.height}` === e.target.value);
            if (p) apply(p.width, p.height);
          }}
        >
          {customSizes.length > 0 && (
            <optgroup label={t('Mis tamaños')}>
              {customSizes.map((p) => (
                <option key={'c' + p.label} value={`${p.width}x${p.height}`}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
          {CANVAS_PRESETS.map((p) => (
            <option key={p.label} value={`${p.width}x${p.height}`}>
              {p.label}
            </option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      <label className="dl-row">
        Medida
        <span className="custom-size">
          <input type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} />
          ×
          <input type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} />
        </span>
      </label>
      <button
        className="primary dl-go"
        onClick={() => {
          const { w, h } = parsed();
          setCanvasSize(w, h);
          onClose();
        }}
      >
        Aplicar
      </button>

      {/* Guardar la medida actual como tamaño propio */}
      <div className="font-row">
        <input
          type="text"
          placeholder="Nombre (opcional)"
          value={sizeName}
          onChange={(e) => setSizeName(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--panel-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 12,
          }}
        />
        <button
          className="font-upload"
          title="Guardar la medida escrita arriba como tamaño propio"
          onClick={() => {
            const { w, h } = parsed();
            const label = sizeName.trim() ? `${sizeName.trim()} (${w}×${h})` : `${w}×${h}`;
            saveSizes([...customSizes.filter((s) => s.label !== label), { label, width: w, height: h }]);
            setSizeName('');
            toast(`Tamaño guardado: ${label}`, 'success');
          }}
        >
          💾
        </button>
      </div>
      {customSizes.length > 0 && (
        <div className="custom-sizes">
          <ul>
            {customSizes.map((s) => (
              <li key={s.label}>
                <span
                  onClick={() => {
                    apply(s.width, s.height);
                    onClose();
                  }}
                >
                  📐 {s.label}
                </span>
                <button
                  className="mini"
                  title="Quitar"
                  onClick={() => saveSizes(customSizes.filter((x) => x.label !== s.label))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dl-row" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Magic Resize (copia en otro tamaño)</span>
      </div>
      {[...customSizes, ...CANVAS_PRESETS].map((p) => (
        <button
          key={'mr' + p.label}
          className="dropdown-item"
          onClick={() => {
            addResizedPage(p.width, p.height);
            onClose();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text)',
            textAlign: 'left',
            padding: '6px 8px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ✨ {p.label}
        </button>
      ))}
    </div>
  );
}
