import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHART_PALETTE,
  defaultChart,
  defaultTable,
  parseNumber,
  parsePasted,
  pastedToChart,
  renderChart,
  renderTable,
} from '../editor/core/charts';
import type { ChartKind, ChartSpec, TableSpec } from '../editor/core/charts';
import { BackButton, CloseButton } from './Modal';
import { useDismiss } from './useDismiss';

const KINDS: { kind: ChartKind; label: string }[] = [
  { kind: 'bar', label: 'Barras' },
  { kind: 'barH', label: 'Barras horizontales' },
  { kind: 'line', label: 'Líneas' },
  { kind: 'area', label: 'Área' },
  { kind: 'pie', label: 'Torta' },
  { kind: 'donut', label: 'Dona' },
];
const FONTS = ['Arial', 'Montserrat', 'Poppins', 'Roboto', 'Inter', 'Oswald', 'Merriweather', 'Georgia'];

type Result = { src: string; naturalWidth: number; naturalHeight: number; chart?: ChartSpec; table?: TableSpec };

export function ChartEditor(props: {
  initial: { chart?: ChartSpec; table?: TableSpec };
  mode: 'chart' | 'table';
  onApply: (r: Result) => void;
  onCancel: () => void;
}) {
  const { mode, initial, onApply, onCancel } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onCancel });
  const editing = mode === 'chart' ? !!initial.chart : !!initial.table;
  const [chart, setChart] = useState<ChartSpec>(() => initial.chart ?? defaultChart());
  const [table, setTable] = useState<TableSpec>(() => initial.table ?? defaultTable());
  const [gen, setGen] = useState(0); // fuerza remontar las celdas numéricas tras pegar
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);

  // Vista previa con debounce
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setPreview(mode === 'chart' ? renderChart(chart) : renderTable(table));
      } catch {
        /* datos a medias: se conserva la vista previa anterior */
      }
    }, 150);
    return () => clearTimeout(t);
  }, [chart, table, mode]);

  const nCats = chart.labels.length;
  const upChart = (p: Partial<ChartSpec>) => setChart((c) => ({ ...c, ...p }));
  const upTable = (p: Partial<TableSpec>) => setTable((t) => ({ ...t, ...p }));

  const changeKind = (kind: ChartKind) => {
    setChart((c) => ({
      ...c,
      kind,
      // en torta solo se usa la primera serie
      series: c.series.length ? c.series : defaultChart(kind).series,
    }));
  };

  const setLabel = (i: number, v: string) =>
    setChart((c) => ({ ...c, labels: c.labels.map((l, k) => (k === i ? v : l)) }));
  const setValue = (s: number, i: number, raw: string) =>
    setChart((c) => {
      const n = parseNumber(raw);
      return {
        ...c,
        series: c.series.map((se, k) =>
          k === s ? { ...se, values: se.values.map((x, j) => (j === i ? (isNaN(n) ? 0 : n) : x)) } : se,
        ),
      };
    });
  const addRow = () =>
    setChart((c) => ({
      ...c,
      labels: [...c.labels, `Cat ${c.labels.length + 1}`],
      series: c.series.map((s) => ({ ...s, values: [...s.values, 0] })),
    }));
  const delRow = () =>
    setChart((c) =>
      c.labels.length <= 1
        ? c
        : { ...c, labels: c.labels.slice(0, -1), series: c.series.map((s) => ({ ...s, values: s.values.slice(0, -1) })) },
    );
  const addSeries = () =>
    setChart((c) => ({
      ...c,
      series: [
        ...c.series,
        {
          name: `Serie ${c.series.length + 1}`,
          color: CHART_PALETTE[c.series.length % CHART_PALETTE.length],
          values: c.labels.map(() => 0),
        },
      ],
    }));
  const delSeries = () =>
    setChart((c) => (c.series.length <= 1 ? c : { ...c, series: c.series.slice(0, -1) }));

  // tabla
  const tCols = Math.max(1, ...table.cells.map((r) => r.length));
  const setCell = (r: number, c: number, v: string) =>
    setTable((t) => ({
      ...t,
      cells: t.cells.map((row, i) => (i === r ? Array.from({ length: tCols }, (_, j) => (j === c ? v : row[j] ?? '')) : row)),
    }));
  const tAddRow = () => setTable((t) => ({ ...t, cells: [...t.cells, Array(tCols).fill('')] }));
  const tDelRow = () => setTable((t) => (t.cells.length <= 1 ? t : { ...t, cells: t.cells.slice(0, -1) }));
  const tAddCol = () => setTable((t) => ({ ...t, cells: t.cells.map((r) => [...Array.from({ length: tCols }, (_, j) => r[j] ?? ''), '']) }));
  const tDelCol = () =>
    setTable((t) => (tCols <= 1 ? t : { ...t, cells: t.cells.map((r) => Array.from({ length: tCols - 1 }, (_, j) => r[j] ?? '')) }));

  const applyPaste = () => {
    const rows = parsePasted(pasteText);
    if (!rows.length) return;
    if (mode === 'table') {
      setTable((t) => ({ ...t, cells: rows }));
    } else {
      const r = pastedToChart(rows);
      if (r) setChart((c) => ({ ...c, labels: r.labels, series: r.series }));
    }
    setGen((g) => g + 1);
    setPasteText('');
    setPasteOpen(false);
  };

  const apply = () => {
    const r = mode === 'chart' ? renderChart(chart) : renderTable(table);
    onApply(mode === 'chart' ? { ...r, chart } : { ...r, table });
  };

  const fontSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {FONTS.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
  const color = (value: string, onChange: (v: string) => void) => (
    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
  );

  const chartGrid = useMemo(
    () => (
      <div className="chart-gridwrap">
        <table className="chart-grid">
          <thead>
            <tr>
              <th>Etiqueta</th>
              {chart.series.map((s, si) => (
                <th key={si}>
                  <input
                    className="chart-cell"
                    value={s.name}
                    onChange={(e) =>
                      setChart((c) => ({ ...c, series: c.series.map((x, k) => (k === si ? { ...x, name: e.target.value } : x)) }))
                    }
                  />
                  <input
                    type="color"
                    className="chart-swatch"
                    value={s.color}
                    onChange={(e) =>
                      setChart((c) => ({ ...c, series: c.series.map((x, k) => (k === si ? { ...x, color: e.target.value } : x)) }))
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.labels.map((l, i) => (
              <tr key={i}>
                <td>
                  <input className="chart-cell" value={l} onChange={(e) => setLabel(i, e.target.value)} />
                </td>
                {chart.series.map((s, si) => (
                  <td key={si}>
                    <input
                      className="chart-cell"
                      inputMode="decimal"
                      defaultValue={String(s.values[i] ?? 0)}
                      key={`${gen}-${si}-${i}`}
                      onChange={(e) => setValue(si, i, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart.labels, chart.series, gen],
  );

  return (
    <div className="donate-overlay">
      <div className="chart-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <CloseButton className="float" onClick={onCancel} />
        <BackButton onClick={onCancel} />
        <h3 className="chart-title">{mode === 'chart' ? 'Gráfica' : 'Tabla'}</h3>
        <div className="chart-body">
          <div className="chart-controls props">
            {mode === 'chart' ? (
              <>
                <div className="chart-kinds">
                  {KINDS.map((k) => (
                    <button key={k.kind} className={chart.kind === k.kind ? 'active' : ''} onClick={() => changeKind(k.kind)}>
                      {k.label}
                    </button>
                  ))}
                </div>
                <label className="prop">
                  Título
                  <input type="text" value={chart.title} onChange={(e) => upChart({ title: e.target.value })} />
                </label>
                {chartGrid}
                <div className="row">
                  <button onClick={addRow}>+ fila</button>
                  <button onClick={delRow} disabled={nCats <= 1}>− fila</button>
                  <button onClick={addSeries}>+ serie</button>
                  <button onClick={delSeries} disabled={chart.series.length <= 1}>− serie</button>
                </div>
                <div className="row chart-checks">
                  <label>
                    <input type="checkbox" checked={chart.showLegend} onChange={(e) => upChart({ showLegend: e.target.checked })} /> Leyenda
                  </label>
                  <label>
                    <input type="checkbox" checked={chart.showValues} onChange={(e) => upChart({ showValues: e.target.checked })} /> Valores
                  </label>
                  <label>
                    <input type="checkbox" checked={chart.showGrid} onChange={(e) => upChart({ showGrid: e.target.checked })} /> Cuadrícula
                  </label>
                </div>
                <div className="row chart-checks">
                  <label>
                    Texto {color(chart.textColor, (v) => upChart({ textColor: v }))}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={chart.background === ''}
                      onChange={(e) => upChart({ background: e.target.checked ? '' : '#ffffff' })}
                    />{' '}
                    Fondo transparente
                  </label>
                  {chart.background !== '' && <label>Fondo {color(chart.background, (v) => upChart({ background: v }))}</label>}
                </div>
                <label className="prop">
                  Fuente
                  {fontSelect(chart.fontFamily, (v) => upChart({ fontFamily: v }))}
                </label>
                <div className="row">
                  <label className="prop chart-half">
                    Ancho
                    <input
                      type="number"
                      min={120}
                      max={4000}
                      value={chart.width}
                      onChange={(e) => upChart({ width: Math.max(120, Number(e.target.value) || 120) })}
                    />
                  </label>
                  <label className="prop chart-half">
                    Alto
                    <input
                      type="number"
                      min={100}
                      max={4000}
                      value={chart.height}
                      onChange={(e) => upChart({ height: Math.max(100, Number(e.target.value) || 100) })}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="chart-gridwrap">
                  <table className="chart-grid">
                    <tbody>
                      {table.cells.map((row, r) => (
                        <tr key={r}>
                          {Array.from({ length: tCols }, (_, c) => (
                            <td key={c}>
                              <input className="chart-cell" value={row[c] ?? ''} onChange={(e) => setCell(r, c, e.target.value)} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row">
                  <button onClick={tAddRow}>+ fila</button>
                  <button onClick={tDelRow} disabled={table.cells.length <= 1}>− fila</button>
                  <button onClick={tAddCol}>+ columna</button>
                  <button onClick={tDelCol} disabled={tCols <= 1}>− columna</button>
                </div>
                <div className="row chart-checks">
                  <label>
                    <input type="checkbox" checked={table.headerRow} onChange={(e) => upTable({ headerRow: e.target.checked })} /> Encabezado
                  </label>
                  <label>
                    <input type="checkbox" checked={table.stripeBg !== ''} onChange={(e) => upTable({ stripeBg: e.target.checked ? '#f1f4fb' : '' })} /> Rayado
                  </label>
                </div>
                <div className="row chart-checks">
                  <label>Enc. fondo {color(table.headerBg, (v) => upTable({ headerBg: v }))}</label>
                  <label>Enc. texto {color(table.headerColor, (v) => upTable({ headerColor: v }))}</label>
                  <label>Cuerpo {color(table.bodyBg, (v) => upTable({ bodyBg: v }))}</label>
                  {table.stripeBg !== '' && <label>Rayado {color(table.stripeBg, (v) => upTable({ stripeBg: v }))}</label>}
                  <label>Bordes {color(table.borderColor, (v) => upTable({ borderColor: v }))}</label>
                  <label>Texto {color(table.textColor, (v) => upTable({ textColor: v }))}</label>
                </div>
                <label className="prop">
                  Fuente
                  {fontSelect(table.fontFamily, (v) => upTable({ fontFamily: v }))}
                </label>
                <div className="row">
                  <label className="prop chart-half">
                    Tamaño de letra
                    <input type="number" min={6} max={120} value={table.fontSize} onChange={(e) => upTable({ fontSize: Math.max(6, Number(e.target.value) || 6) })} />
                  </label>
                  <label className="prop chart-half">
                    Relleno
                    <input type="number" min={0} max={60} value={table.cellPadding} onChange={(e) => upTable({ cellPadding: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>
                </div>
                <label className="prop">
                  Alineación
                  <select value={table.align} onChange={(e) => upTable({ align: e.target.value as TableSpec['align'] })}>
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                  </select>
                </label>
              </>
            )}
            <div className="row">
              <button onClick={() => setPasteOpen((o) => !o)}>Pegar datos</button>
            </div>
            {pasteOpen && (
              <div className="chart-paste">
                <textarea
                  rows={5}
                  placeholder="Pega aquí las filas copiadas de Excel o Sheets (tabulador, ; o ,)"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="row">
                  <button onClick={applyPaste} disabled={!pasteText.trim()}>
                    Usar estos datos
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="chart-preview">
            {preview && (
              <img
                src={preview.src}
                alt="Vista previa"
                style={{ aspectRatio: `${preview.naturalWidth} / ${preview.naturalHeight}` }}
              />
            )}
          </div>
        </div>
        <div className="chart-actions">
          <button className="primary" onClick={apply}>
            {editing ? '✓ Actualizar' : '✓ Insertar'}
          </button>
          <button onClick={onCancel}>✕ Cancelar</button>
        </div>
      </div>
    </div>
  );
}
