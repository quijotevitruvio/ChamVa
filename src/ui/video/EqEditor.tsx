// Ecualizador paramétrico con curva visual (clip, pista y maestra). Siete bandas: paso alto, estante grave, tres
// campanas, estante agudo y paso bajo; cada una se puede cambiar de tipo, frecuencia, ganancia y Q. La curva se
// calcula con los mismos coeficientes que usa el DSP. Se arrastra el punto de cada banda (también con el teclado).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { EQ_MAX_HZ, EQ_MIN_HZ, EQ_TYPE_LABEL, defaultEqBands, eqCurveDb, eqIsFlat, type EqBand, type EqType } from '../../video/audio/eq';

interface Props {
  bands: EqBand[] | undefined;
  /** `undefined` = ecualizador plano (se quita del modelo). `group` agrupa los arrastres en un solo paso de deshacer. */
  onChange: (bands: EqBand[] | undefined, group: string) => void;
  disabled?: boolean;
  label?: string;
}

const W = 300;
const H = 132;
const PAD_L = 24;
const PAD_B = 14;
const DB_RANGE = 18;
const LOG_MIN = Math.log10(EQ_MIN_HZ);
const LOG_MAX = Math.log10(EQ_MAX_HZ);
const xOf = (f: number) => PAD_L + ((Math.log10(f) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (W - PAD_L - 4);
const fOf = (x: number) => Math.pow(10, LOG_MIN + ((x - PAD_L) / (W - PAD_L - 4)) * (LOG_MAX - LOG_MIN));
const yOf = (db: number) => 4 + ((DB_RANGE - Math.max(-DB_RANGE, Math.min(DB_RANGE, db))) / (2 * DB_RANGE)) * (H - PAD_B - 8);
const dbOf = (y: number) => DB_RANGE - ((y - 4) / (H - PAD_B - 8)) * 2 * DB_RANGE;
const hasGain = (t: EqType) => t === 'peak' || t === 'lowshelf' || t === 'highshelf';

const FREQS = Array.from({ length: 120 }, (_, i) => Math.pow(10, LOG_MIN + (i / 119) * (LOG_MAX - LOG_MIN)));

const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);

export function EqEditor({ bands, onChange, disabled, label = 'Ecualizador' }: Props) {
  const id = useId();
  // copia de trabajo: un ecualizador plano se guarda como «sin ecualizador», pero mientras se edita se conservan las bandas
  const [cur, setCur] = useState<EqBand[]>(() => (bands && bands.length ? bands : defaultEqBands()));
  useEffect(() => {
    if (bands && bands.length) setCur(bands);
  }, [bands]);
  const [sel, setSel] = useState(2);
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ i: number; pid: number } | null>(null);
  const curve = useMemo(() => eqCurveDb(cur, FREQS, 48000), [cur]);
  const path = useMemo(() => FREQS.map((f, i) => `${i ? 'L' : 'M'}${xOf(f).toFixed(1)},${yOf(curve[i]).toFixed(1)}`).join(' '), [curve]);
  const flat = eqIsFlat(bands);

  const emit = (next: EqBand[], group: string) => {
    setCur(next);
    onChange(eqIsFlat(next) ? undefined : next, 'eq:' + group);
  };
  const patch = (i: number, p: Partial<EqBand>, group: string) => emit(cur.map((b, k) => (k === i ? { ...b, ...p } : b)), group);

  const toLocal = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onDown = (i: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    if (disabled) return;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* puntero ya liberado o sintético: el arrastre sigue por los eventos del SVG */
    }
    drag.current = { i, pid: e.pointerId };
    setSel(i);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const { x, y } = toLocal(e);
    const f = Math.max(EQ_MIN_HZ, Math.min(EQ_MAX_HZ, Math.round(fOf(x))));
    const b = cur[d.i];
    const g = hasGain(b.type) ? Math.max(-24, Math.min(24, Math.round(dbOf(y) * 2) / 2)) : b.g;
    patch(d.i, { f, g, on: b.on === false && (b.f !== f || b.g !== g) ? true : b.on }, `${id}:${d.i}`);
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.pid === e.pointerId) drag.current = null;
  };
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    if (disabled) return;
    const b = cur[i];
    let handled = true;
    if (e.key === 'ArrowLeft') patch(i, { f: Math.max(EQ_MIN_HZ, Math.round(b.f / 1.06)) }, `${id}:${i}`);
    else if (e.key === 'ArrowRight') patch(i, { f: Math.min(EQ_MAX_HZ, Math.round(b.f * 1.06)) }, `${id}:${i}`);
    else if (e.key === 'ArrowUp' && hasGain(b.type)) patch(i, { g: Math.min(24, b.g + 0.5) }, `${id}:${i}`);
    else if (e.key === 'ArrowDown' && hasGain(b.type)) patch(i, { g: Math.max(-24, b.g - 0.5) }, `${id}:${i}`);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const b = cur[Math.min(sel, cur.length - 1)];
  const bi = Math.min(sel, cur.length - 1);
  return (
    <div className="vx-eq" role="group" aria-label={label}>
      <svg ref={svg} className="vx-eq-svg" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="img" aria-label={`${label}: curva de respuesta`}>
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line x1={PAD_L} x2={W - 4} y1={yOf(db)} y2={yOf(db)} className={db === 0 ? 'zero' : 'grid'} />
            <text x={PAD_L - 3} y={yOf(db) + 3} textAnchor="end" className="lbl">{db}</text>
          </g>
        ))}
        {[50, 100, 500, 1000, 5000, 10000].map((f) => (
          <g key={f}>
            <line x1={xOf(f)} x2={xOf(f)} y1={4} y2={H - PAD_B} className="grid" />
            <text x={xOf(f)} y={H - 3} textAnchor="middle" className="lbl">{f >= 1000 ? f / 1000 + 'k' : f}</text>
          </g>
        ))}
        <path d={`${path} L${xOf(EQ_MAX_HZ)},${yOf(0)} L${xOf(EQ_MIN_HZ)},${yOf(0)} Z`} className="fill" />
        <path d={path} className="curve" />
        {cur.map((band, i) => (
          <circle
            key={i}
            cx={xOf(band.f)}
            cy={yOf(hasGain(band.type) ? band.g : 0)}
            r={i === bi ? 7 : 5.5}
            className={`pt${i === bi ? ' sel' : ''}${band.on === false ? ' off' : ''}`}
            tabIndex={disabled ? -1 : 0}
            role="slider"
            aria-label={`Banda ${i + 1}: ${EQ_TYPE_LABEL[band.type]} ${fmtHz(band.f)}${hasGain(band.type) ? `, ${band.g} dB` : ''}`}
            aria-valuenow={band.f}
            aria-valuemin={EQ_MIN_HZ}
            aria-valuemax={EQ_MAX_HZ}
            onPointerDown={onDown(i)}
            onKeyDown={onKey(i)}
            onFocus={() => setSel(i)}
          />
        ))}
      </svg>
      <div className="vx-eq-band">
        <span className="vx-eq-n">{bi + 1}</span>
        <select aria-label="Tipo de banda" value={b.type} disabled={disabled} onChange={(e) => patch(bi, { type: e.target.value as EqType, on: true }, `${id}:t${bi}`)}>
          {(Object.keys(EQ_TYPE_LABEL) as EqType[]).map((t) => (
            <option key={t} value={t}>{EQ_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <label className="vx-eq-f">
          <span>Hz</span>
          <input type="number" aria-label="Frecuencia (Hz)" min={EQ_MIN_HZ} max={EQ_MAX_HZ} step={10} value={Math.round(b.f)} disabled={disabled} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && patch(bi, { f: Math.max(EQ_MIN_HZ, Math.min(EQ_MAX_HZ, e.target.valueAsNumber)) }, `${id}:f${bi}`)} />
        </label>
        <label className="vx-eq-f">
          <span>dB</span>
          <input type="number" aria-label="Ganancia (dB)" min={-24} max={24} step={0.5} value={b.g} disabled={disabled || !hasGain(b.type)} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && patch(bi, { g: Math.max(-24, Math.min(24, e.target.valueAsNumber)), on: true }, `${id}:g${bi}`)} />
        </label>
        <label className="vx-eq-f">
          <span>Q</span>
          <input type="number" aria-label="Q" min={0.1} max={18} step={0.1} value={Number(b.q.toFixed(2))} disabled={disabled} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && patch(bi, { q: Math.max(0.1, Math.min(18, e.target.valueAsNumber)) }, `${id}:q${bi}`)} />
        </label>
        <label className="vx-eq-on">
          <input type="checkbox" checked={b.on !== false} disabled={disabled} onChange={(e) => patch(bi, { on: e.target.checked }, `${id}:o${bi}`)} /> activa
        </label>
      </div>
      <button type="button" className="mini" disabled={disabled || flat} onClick={() => {
          setCur(defaultEqBands());
          onChange(undefined, 'eq:reset');
        }}>
        Restablecer ecualizador
      </button>
    </div>
  );
}
