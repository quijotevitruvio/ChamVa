// Secciones del inspector de V6: transiciones, efectos (pila ordenable), animación (fotogramas clave) y el campo
// animable (`AnimField`: deslizador + rombo ◇/◆ + saltar al fotograma anterior/siguiente).
import * as VM from '../../video/model';
import { applyEase, cubicBezier, DEFAULT_BEZIER, EASE_IDS, EASE_LABELS } from '../../video/fx/ease';
import { FX_CATEGORIES, FX_DEFS, fxDef, type FxDef, type ParamDef } from '../../video/fx/effects';
import { addFxOfType, addKeyAtPlayhead, applyPreset, baseValue, clearClipKeys, copyKeys, fxProp, junctionSpec, moveFx, pasteClipKeys, removeFx, removeKeyAt, setBlend, setJunctionTransition, setPropValue, setTransition, updateFx, updateKeyAt, updateTransition, valueNow } from '../../video/fx/clipOps';
import { ANIM_PRESETS, INTERPS, INTERP_LABEL, PROP_LABEL } from '../../video/fx/keyframes';
import { BLEND_MODES } from '../../video/fx/sanitize';
import { areJoined, junctionOf, makeTransition, TRANSITIONS, type TransGroup } from '../../video/fx/transitions';
import { CurveEditor } from './CurveEditor';
import { Field } from './Field';
import { BLEND_LABEL, keyIndexAt, neighborKey, propLabel } from './fxUi';
import type { PreviewEngine } from './previewEngine';

export type KeyClipboard = { prop: string; keys: VM.Keyframe[] }[];

export interface FxCtx {
  project: VM.VideoProject;
  clip: VM.Clip;
  track: VM.Track;
  engine: PreviewEngine;
  /** instante del cabezal (cuantizado mientras se reproduce) */
  t: number;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  locked: boolean;
  autoKey: boolean;
  setAutoKey: (v: boolean) => void;
  keyClip: KeyClipboard;
  setKeyClip: (v: KeyClipboard) => void;
  onSelect: (ids: string[]) => void;
}

const clipEnd = (c: FxCtx) => VM.effectiveEnd(c.clip, VM.projectDuration(c.project));
const insideClip = (c: FxCtx) => c.t >= c.clip.start - 1e-3 && c.t <= clipEnd(c) + 1e-3;

/** Escribe el valor de una propiedad animable: como fotograma si está animada o el auto-fotograma está activo (y el cabezal cae en el clip). */
function setVal(c: FxCtx, prop: string, v: number) {
  const id = c.clip.id;
  c.commit((p) => {
    const loc = VM.findClip(p, id);
    if (!loc) return p;
    const t = c.engine.time;
    const inside = t >= loc.clip.start - 1e-3 && t <= VM.effectiveEnd(loc.clip, VM.projectDuration(p)) + 1e-3;
    return setPropValue(p, id, prop, v, t, c.autoKey && inside);
  }, `pv:${id}:${prop}`);
}

// ---------- campo animable ----------
interface AnimProps {
  ctx: FxCtx;
  prop: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  scale?: number;
  digits?: number;
}

export function AnimField({ ctx, prop, label, min, max, step, unit, scale, digits }: AnimProps) {
  const { clip, engine, t, commit, locked } = ctx;
  const v = valueNow(clip, prop, t) ?? baseValue(clip, prop) ?? 0;
  const idx = keyIndexAt(clip, prop, t);
  const prev = neighborKey(clip, prop, t, -1);
  const next = neighborKey(clip, prop, t, 1);
  const inside = insideClip(ctx);
  const toggle = () => {
    if (idx >= 0) commit((p) => removeKeyAt(p, clip.id, prop, idx));
    else commit((p) => addKeyAtPlayhead(p, clip.id, prop, engine.time));
  };
  const keys = (
    <span className="vx-kbar" role="group" aria-label={`Fotogramas clave de ${label}`}>
      <button type="button" className="vx-kb" disabled={prev === null} onClick={() => prev !== null && engine.seek(prev)} aria-label={`${label}: ir al fotograma anterior`} title="Fotograma anterior">◀</button>
      <button type="button" className={`vx-kb diamond${idx >= 0 ? ' on' : ''}`} aria-pressed={idx >= 0} disabled={locked || (idx < 0 && !inside)} onClick={toggle} aria-label={idx >= 0 ? `Quitar el fotograma de ${label} en el cabezal` : `Añadir un fotograma de ${label} en el cabezal`} title={idx >= 0 ? 'Quitar fotograma' : inside ? 'Añadir fotograma en el cabezal' : 'Mueve el cabezal sobre el clip para añadir un fotograma'}>
        {idx >= 0 ? '◆' : '◇'}
      </button>
      <button type="button" className="vx-kb" disabled={next === null} onClick={() => next !== null && engine.seek(next)} aria-label={`${label}: ir al fotograma siguiente`} title="Fotograma siguiente">▶</button>
    </span>
  );
  return <Field label={label} value={v} min={min} max={max} step={step} unit={unit} scale={scale} digits={digits} disabled={locked} onChange={(x) => setVal(ctx, prop, x)} keys={keys} />;
}

// ---------- transiciones ----------
const GROUPS: TransGroup[] = ['Fundidos', 'Deslizar', 'Empujar', 'Zoom', 'Formas', 'Efectos'];

function TransEditor({ ctx, title, note, spec, ownerId, ownerSide, onType }: { ctx: FxCtx; title: string; note: string; spec: VM.TransitionSpec | undefined; ownerId: string; ownerSide: 'in' | 'out'; onType: (type: string) => void }) {
  const { commit, locked } = ctx;
  const idp = `${ownerId}:${ownerSide}`;
  const upd = (patch: Partial<VM.TransitionSpec>, group?: string) => commit((p) => updateTransition(p, ownerId, ownerSide, patch), group ? `${group}:${idp}` : undefined);
  return (
    <div className="vx-trans">
      <div className="vx-field wide">
        <label htmlFor={`vx-tt-${idp}`}>{title}</label>
        <select id={`vx-tt-${idp}`} value={spec?.type ?? ''} disabled={locked} onChange={(e) => onType(e.target.value)}>
          <option value="">Ninguna</option>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {TRANSITIONS.filter((t) => t.group === g).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {spec && (
        <>
          <Field label="Duración" value={spec.dur} min={0.1} max={3} step={0.05} unit=" s" digits={2} disabled={locked} onChange={(v) => upd({ dur: v }, 'tdur')} />
          <div className="vx-field wide">
            <label htmlFor={`vx-te-${idp}`}>Curva</label>
            <select id={`vx-te-${idp}`} value={spec.ease ?? 'smooth'} disabled={locked} onChange={(e) => upd({ ease: e.target.value as VM.EaseId, ...(e.target.value === 'bezier' && !spec.bz ? { bz: DEFAULT_BEZIER } : {}) })}>
              {EASE_IDS.map((id) => (
                <option key={id} value={id}>
                  {EASE_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          <CurveEditor
            label={`Curva de la transición (${EASE_LABELS[spec.ease ?? 'smooth']})`}
            fn={(p) => applyEase(spec.ease, p, spec.bz)}
            bz={spec.ease === 'bezier' ? (spec.bz ?? DEFAULT_BEZIER) : undefined}
            disabled={locked}
            onChange={spec.ease === 'bezier' ? (bz) => upd({ bz }, 'tbz') : undefined}
          />
        </>
      )}
      <p className="vx-note">{note}</p>
    </div>
  );
}

export function TransitionSection({ ctx }: { ctx: FxCtx }) {
  const { clip, track, commit } = ctx;
  const j = junctionOf(track, clip.id);
  const i = track.clips.findIndex((c) => c.id === clip.id);
  const next = track.clips[i + 1];
  const joinedNext = !!next && areJoined(clip, next);

  // ENTRADA (o unión con el clip anterior, que manda sobre la salida del anterior)
  const js = j ? junctionSpec(j.a, j.b) : null;
  const inSpec = j ? js?.spec : clip.tin;
  const inOwner = j && js?.owner === 'out' ? { id: j.a.id, side: 'out' as const } : { id: clip.id, side: 'in' as const };
  const setIn = (type: string) => {
    if (!type) return commit((p) => (j ? setJunctionTransition(p, clip.id, null) : setTransition(p, clip.id, 'in', null)));
    const spec = makeTransition(type, { dur: inSpec?.dur, ease: inSpec?.ease, bz: inSpec?.bz });
    commit((p) => (j ? setJunctionTransition(p, clip.id, spec) : setTransition(p, clip.id, 'in', spec)));
  };
  const setOut = (type: string) => {
    if (!type) return commit((p) => setTransition(p, clip.id, 'out', null));
    const spec = makeTransition(type, { dur: clip.tout?.dur, ease: clip.tout?.ease, bz: clip.tout?.bz });
    commit((p) => setTransition(p, clip.id, 'out', spec));
  };
  return (
    <details className="vx-sec" open>
      <summary>Transiciones</summary>
      <TransEditor
        ctx={ctx}
        title={j ? 'Unión (entrada)' : 'Entrada'}
        note={j ? 'Es la transición de la UNIÓN con el clip anterior: va centrada en el corte y usa los márgenes de recorte de los dos clips.' : 'Transición de entrada: el clip entra desde lo que haya debajo durante su primer tramo.'}
        spec={inSpec}
        ownerId={inOwner.id}
        ownerSide={inOwner.side}
        onType={setIn}
      />
      {joinedNext ? (
        <p className="vx-note">
          La salida de este clip es la unión con el siguiente: se edita en él.{' '}
          <button type="button" className="mini" onClick={() => ctx.onSelect([next.id])}>Ir al clip siguiente</button>
        </p>
      ) : (
        <TransEditor ctx={ctx} title="Salida" note="Transición de salida: el clip se va hacia lo que haya debajo durante su último tramo." spec={clip.tout} ownerId={clip.id} ownerSide="out" onType={setOut} />
      )}
    </details>
  );
}

// ---------- efectos ----------
function ParamControl({ ctx, fxId, pd, value }: { ctx: FxCtx; fxId: string; pd: ParamDef; value: number | string | undefined }) {
  const { clip, commit, locked } = ctx;
  const g = `fxp:${clip.id}:${fxId}:${pd.key}`;
  if (pd.kind === 'color') {
    return (
      <div className="vx-field wide">
        <label htmlFor={`vx-p-${fxId}-${pd.key}`}>{pd.label}</label>
        <input id={`vx-p-${fxId}-${pd.key}`} type="color" value={typeof value === 'string' ? value : String(pd.def)} disabled={locked} onChange={(e) => commit((p) => updateFx(p, clip.id, fxId, { p: { [pd.key]: e.target.value } }), g)} />
      </div>
    );
  }
  if (pd.kind === 'choice') {
    return (
      <div className="vx-field wide">
        <label htmlFor={`vx-p-${fxId}-${pd.key}`}>{pd.label}</label>
        <select id={`vx-p-${fxId}-${pd.key}`} value={typeof value === 'string' ? value : String(pd.def)} disabled={locked} onChange={(e) => commit((p) => updateFx(p, clip.id, fxId, { p: { [pd.key]: e.target.value } }))}>
          {pd.choices?.map((c) => (
            <option key={c.v} value={c.v}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const min = pd.min ?? 0;
  const max = pd.max ?? 1;
  const step = pd.step ?? 0.01;
  const pct = !pd.unit && max <= 1 && min >= -1;
  return <AnimField ctx={ctx} prop={fxProp(fxId, pd.key)} label={pd.label} min={min} max={max} step={step} scale={pct ? 100 : 1} unit={pct ? ' %' : (pd.unit ?? '')} digits={pct ? 0 : step < 1 ? 2 : 0} />;
}

function FxRow({ ctx, fx, index, count }: { ctx: FxCtx; fx: VM.FxInstance; index: number; count: number }) {
  const { clip, commit, locked } = ctx;
  const def = fxDef(fx.type);
  const name = def?.label ?? fx.type;
  const params = def?.params ?? [];
  return (
    <li className={`vx-fxrow${fx.on === false ? ' off' : ''}`}>
      <div className="vx-fxhead">
        <label className="vx-check vx-fxon">
          <input type="checkbox" checked={fx.on !== false} disabled={locked} onChange={(e) => commit((p) => updateFx(p, clip.id, fx.id, { on: e.target.checked }))} aria-label={`Efecto ${name}: activado`} />
          <span className="vx-fxtitle" title={name}>
            {index + 1}. {name}
          </span>
        </label>
        <button type="button" className="mini vx-ib" disabled={locked || index === 0} onClick={() => commit((p) => moveFx(p, clip.id, fx.id, index - 1))} aria-label={`Subir ${name} en la pila`} title="Subir (se aplica antes)">▲</button>
        <button type="button" className="mini vx-ib" disabled={locked || index === count - 1} onClick={() => commit((p) => moveFx(p, clip.id, fx.id, index + 1))} aria-label={`Bajar ${name} en la pila`} title="Bajar (se aplica después)">▼</button>
        <button type="button" className="mini vx-ib" disabled={locked} onClick={() => commit((p) => removeFx(p, clip.id, fx.id))} aria-label={`Quitar ${name}`} title="Quitar efecto">✕</button>
      </div>
      <AnimField ctx={ctx} prop={fxProp(fx.id, 'amount')} label="Intensidad" min={0} max={1} step={0.01} scale={100} unit=" %" />
      {params.length > 0 && (
        <details className="vx-fxparams">
          <summary>Parámetros ({params.length})</summary>
          {params.map((pd) => (
            <ParamControl key={pd.key} ctx={ctx} fxId={fx.id} pd={pd} value={fx.p?.[pd.key]} />
          ))}
        </details>
      )}
    </li>
  );
}

const byCategory = (cat: string): FxDef[] => FX_DEFS.filter((d) => d.category === cat);

export function EffectsSection({ ctx }: { ctx: FxCtx }) {
  const { clip, commit, locked } = ctx;
  const list = clip.fx ?? [];
  return (
    <details className="vx-sec" open>
      <summary>Efectos{list.length ? ` (${list.length})` : ''}</summary>
      {list.length === 0 && <p className="vx-note">Sin efectos. Añade uno aquí o desde las pestañas «Efectos» y «Ajustes». Se aplican en orden, de arriba abajo.</p>}
      {list.length > 0 && (
        <ol className="vx-fxlist" aria-label="Pila de efectos (se aplican de arriba abajo)">
          {list.map((fx, i) => (
            <FxRow key={fx.id} ctx={ctx} fx={fx} index={i} count={list.length} />
          ))}
        </ol>
      )}
      <div className="vx-field wide">
        <label htmlFor="vx-addfx">Añadir efecto</label>
        <select id="vx-addfx" value="" disabled={locked} onChange={(e) => e.target.value && commit((p) => addFxOfType(p, clip.id, e.target.value))}>
          <option value="">Elegir…</option>
          {FX_CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {byCategory(cat).map((d) => (
                <option key={d.type} value={d.type}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {clip.kind !== 'adjust' && (
        <div className="vx-field wide">
          <label htmlFor="vx-blend">Fusión</label>
          <select id="vx-blend" value={clip.blend ?? 'normal'} disabled={locked} onChange={(e) => commit((p) => setBlend(p, clip.id, e.target.value as VM.BlendMode))}>
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {BLEND_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      )}
    </details>
  );
}

// ---------- animación ----------
export function AnimSection({ ctx }: { ctx: FxCtx }) {
  const { clip, commit, locked, engine, t } = ctx;
  const visual = clip.kind !== 'audio';
  const hasKeys = !!clip.keys && Object.values(clip.keys).some((k) => k.length > 0);
  const here = Object.keys(clip.keys ?? {})
    .map((prop) => ({ prop, idx: keyIndexAt(clip, prop, t) }))
    .filter((x) => x.idx >= 0);
  return (
    <details className="vx-sec" open>
      <summary>Animación</summary>
      <label className="vx-check">
        <input type="checkbox" checked={ctx.autoKey} onChange={(e) => ctx.setAutoKey(e.target.checked)} /> Auto-fotograma
      </label>
      <p className="vx-note">Con él activo, cambiar un valor (aquí o con las manijas de la vista previa) crea un fotograma en el cabezal. Con el rombo ◇ de cada campo se añade o quita uno a mano.</p>
      {here.map(({ prop, idx }) => {
        const k = clip.keys![prop][idx];
        const e = k.e ?? 'linear';
        return (
          <div key={prop} className="vx-keyhere">
            <div className="vx-field wide">
              <label htmlFor={`vx-ki-${prop}`} title={`Fotograma de ${propLabel(clip, prop)} en el cabezal`}>
                ◆ {propLabel(clip, prop)}
              </label>
              <select id={`vx-ki-${prop}`} value={e} disabled={locked} onChange={(ev) => commit((p) => updateKeyAt(p, clip.id, prop, idx, { e: ev.target.value as VM.KeyInterp, ...(ev.target.value === 'bezier' && !k.bz ? { bz: DEFAULT_BEZIER } : {}) }))} aria-label={`Interpolación del fotograma de ${propLabel(clip, prop)} hasta el siguiente`}>
                {INTERPS.map((i) => (
                  <option key={i} value={i}>
                    {INTERP_LABEL[i]}
                  </option>
                ))}
              </select>
            </div>
            {e === 'bezier' && <CurveEditor label={`Curva del fotograma de ${propLabel(clip, prop)}`} fn={(p) => cubicBezier(k.bz ?? DEFAULT_BEZIER, p)} bz={k.bz ?? DEFAULT_BEZIER} disabled={locked} onChange={(bz) => commit((p) => updateKeyAt(p, clip.id, prop, idx, { bz }), `kbz:${clip.id}:${prop}:${idx}`)} />}
          </div>
        );
      })}
      <div className="vx-actions">
        <button type="button" disabled={!hasKeys} onClick={() => ctx.setKeyClip(copyKeys(clip, 0, Infinity))} title="Copia todos los fotogramas del clip">Copiar fotogramas</button>
        <button type="button" disabled={locked || ctx.keyClip.length === 0} onClick={() => commit((p) => pasteClipKeys(p, clip.id, ctx.keyClip, engine.time))} title="Pega los fotogramas copiados a partir del cabezal">Pegar en el cabezal</button>
        <button type="button" disabled={locked || !hasKeys} onClick={() => commit((p) => clearClipKeys(p, clip.id))}>Quitar todos</button>
      </div>
      {visual && (
        <div className="vx-presets" role="group" aria-label="Animaciones predefinidas">
          {ANIM_PRESETS.map((pr) => (
            <button key={pr.id} type="button" disabled={locked} title={pr.hint} onClick={() => commit((p) => applyPreset(p, clip.id, pr.id))}>
              {pr.label}
            </button>
          ))}
        </div>
      )}
    </details>
  );
}

/** Propiedades de transformación animables (para el inspector). */
export const TRANSFORM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export { PROP_LABEL };
