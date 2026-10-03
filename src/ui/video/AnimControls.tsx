import { useId } from 'react';
import type { Karaoke, TitleAnim } from '../../video/model';
import { ANIM_EMPHASIS, ANIM_IN, ANIM_OUT, ANIM_UNITS, DEFAULT_ANIM_DUR, DEFAULT_STAGGER } from '../../video/title/anim';
import { DEFAULT_KARAOKE } from '../../video/title/style';
import { Field } from './Field';

interface Props {
  anim: TitleAnim | undefined;
  /** tiempo de la animación elegida (duración del clip, para limitar los deslizadores) */
  clipDur: number;
  onChange: (next: TitleAnim | undefined, group: string) => void;
  disabled?: boolean;
  /** los subtítulos solo ofrecen karaoke (el resto lo da el estilo de la pista) */
  karaokeOnly?: boolean;
}

function Select({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="vx-field wide">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span />
    </div>
  );
}

const clean = (a: TitleAnim): TitleAnim | undefined => {
  const out: TitleAnim = { ...a };
  for (const k of Object.keys(out) as (keyof TitleAnim)[]) if (out[k] === undefined) delete out[k];
  if (out.in === 'none') delete out.in;
  if (out.out === 'none') delete out.out;
  if (out.emphasis === 'none') delete out.emphasis;
  if (out.unit === 'all') delete out.unit;
  return Object.keys(out).length ? out : undefined;
};

/** Animaciones de un texto: entrada, salida, por palabra / letra, énfasis continuo y karaoke. */
export function AnimControls({ anim, clipDur, onChange, disabled, karaokeOnly }: Props) {
  const a = anim ?? {};
  const set = (patch: Partial<TitleAnim>, g: string) => onChange(clean({ ...a, ...patch }), g);
  const k = a.karaoke;
  const setK = (patch: Partial<Karaoke> | null, g: string) => onChange(clean({ ...a, karaoke: patch === null ? undefined : { ...(k ?? DEFAULT_KARAOKE), ...patch } }), g);
  const maxDur = Math.max(0.1, Math.min(5, clipDur));
  const hasInOut = !!a.in || !!a.out;
  return (
    <>
      {!karaokeOnly && (
        <>
          <h4>Animación</h4>
          <Select label="Entrada" value={a.in ?? 'none'} options={ANIM_IN} disabled={disabled} onChange={(v) => set({ in: v }, 'ain')} />
          {a.in && <Field label="Duración de entrada" value={a.inDur ?? DEFAULT_ANIM_DUR} min={0.1} max={maxDur} step={0.05} unit=" s" digits={2} disabled={disabled} onChange={(v) => set({ inDur: v }, 'aind')} />}
          <Select label="Salida" value={a.out ?? 'none'} options={ANIM_OUT} disabled={disabled} onChange={(v) => set({ out: v }, 'aout')} />
          {a.out && <Field label="Duración de salida" value={a.outDur ?? DEFAULT_ANIM_DUR} min={0.1} max={maxDur} step={0.05} unit=" s" digits={2} disabled={disabled} onChange={(v) => set({ outDur: v }, 'aoutd')} />}
          {hasInOut && (
            <>
              <Select label="Se aplica a" value={a.unit ?? 'all'} options={ANIM_UNITS} disabled={disabled} onChange={(v) => set({ unit: v as TitleAnim['unit'] }, 'aunit')} />
              {a.unit && a.unit !== 'all' && <Field label="Retardo entre unidades" value={a.stagger ?? DEFAULT_STAGGER} min={0} max={1} step={0.05} scale={100} unit=" %" disabled={disabled} onChange={(v) => set({ stagger: v }, 'ast')} />}
            </>
          )}
          <Select label="Énfasis" value={a.emphasis ?? 'none'} options={ANIM_EMPHASIS} disabled={disabled} onChange={(v) => set({ emphasis: v }, 'aem')} />
          {a.emphasis && <Field label="Velocidad" value={a.emphasisSpeed ?? 1} min={0.2} max={4} step={0.1} unit=" Hz" digits={1} disabled={disabled} onChange={(v) => set({ emphasisSpeed: v }, 'aems')} />}
        </>
      )}
      <h4>Karaoke</h4>
      <label className="vx-check">
        <input type="checkbox" checked={!!k} disabled={disabled} onChange={(e) => setK(e.target.checked ? {} : null, 'ak')} /> Resaltar la palabra que se dice
      </label>
      {k && (
        <>
          <div className="vx-field wide">
            <label>Color activo</label>
            <span />
            <input type="color" aria-label="Color de la palabra activa" value={k.color} disabled={disabled} onChange={(e) => setK({ color: e.target.value }, 'akc')} />
          </div>
          <Field label="Escala activa" value={k.scale} min={1} max={1.6} step={0.02} scale={100} unit=" %" disabled={disabled} onChange={(v) => setK({ scale: v }, 'aks')} />
          <label className="vx-check">
            <input type="checkbox" checked={k.keep} disabled={disabled} onChange={(e) => setK({ keep: e.target.checked }, 'akk')} /> Las palabras dichas se quedan con el color
          </label>
        </>
      )}
    </>
  );
}
