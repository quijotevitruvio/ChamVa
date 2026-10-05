// Pestañas «Transiciones», «Efectos» y «Ajustes» del panel izquierdo (V6): cuadrículas de miniaturas generadas con el
// mismo motor que la vista previa y la exportación. Clic = aplicar al clip seleccionado; arrastrar = soltar en la línea de tiempo.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as VM from '../../video/model';
import { LOOKS } from '../../video/fx/effects';
import { BLEND_MODES } from '../../video/fx/sanitize';
import { blendThumb, fxTypeThumb, lookThumb, thumbProgress, transitionThumb } from '../../video/fx/thumbs';
import { TRANSITIONS, type TransGroup } from '../../video/fx/transitions';
import { AiSelectedFx, aiThumb, type AiTabProps } from './AiPanels';
import { AI_FX_DEFS } from '../../video/fx/effects';
import { applyPayload, BLEND_LABEL, COLOR_FX, encodePayload, IMAGE_FX, payloadLabel, type FxPayload } from './fxUi';

export interface FxPanelProps {
  project: VM.VideoProject;
  selection: string[];
  getProject: () => VM.VideoProject;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  /** V9b: lo que necesitan los controles de IA del clip seleccionado */
  ai?: AiTabProps;
}

/** Clic en una miniatura: lo aplica al clip seleccionado y avisa del resultado (sin selección, explica cómo). */
function useApply({ project, selection, getProject, commit }: FxPanelProps) {
  const [msg, setMsg] = useState('');
  const loc = selection.length === 1 ? VM.findClip(project, selection[0]) : null;
  const apply = (payload: FxPayload) => {
    if (!loc) {
      setMsg('Selecciona un clip en la línea de tiempo y vuelve a pulsar, o arrastra la miniatura sobre un clip.');
      return;
    }
    const before = getProject();
    const next = applyPayload(before, loc.clip.id, payload);
    if (next === before) {
      setMsg(loc.track.locked ? 'La pista del clip está bloqueada.' : `«${payloadLabel(payload)}» no se puede aplicar a un clip de ${loc.clip.kind === 'audio' ? 'audio' : loc.clip.kind === 'subtitle' ? 'subtítulos' : loc.clip.kind === 'adjust' && payload.kind === 'blend' ? 'ajuste' : 'este tipo'}.`);
      return;
    }
    commit(() => next);
    setMsg(`«${payloadLabel(payload)}» aplicado a «${loc.clip.name ?? loc.clip.text ?? loc.clip.kind}».`);
  };
  return { apply, hasTarget: !!loc, msg };
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Una miniatura de verdad pulsable y arrastrable. La imagen se genera cuando entra en pantalla. */
function FxItem({ payload, label, thumb, frames, onApply }: { payload: FxPayload; label: string; thumb: (frame?: number) => string; frames?: number[]; onApply: (p: FxPayload) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  const [frame, setFrame] = useState<number | undefined>(undefined);
  const timer = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const src = useMemo(() => (seen ? thumb(frame) : ''), [seen, frame, thumb]);
  // al pasar el ratón o con el foco, la miniatura de una transición cicla tres cuadros
  const startAnim = () => {
    if (!frames || frames.length < 2 || reducedMotion() || timer.current) return;
    let i = 0;
    setFrame(frames[0]);
    timer.current = window.setInterval(() => {
      i = (i + 1) % frames.length;
      setFrame(frames[i]);
    }, 380);
  };
  const stopAnim = () => {
    window.clearInterval(timer.current);
    timer.current = 0;
    setFrame(undefined);
  };
  return (
    <button
      ref={ref}
      type="button"
      className="vx-fxitem"
      draggable
      title={`${label}: clic para aplicar al clip seleccionado, o arrástralo sobre un clip de la línea de tiempo`}
      onClick={() => onApply(payload)}
      onDragStart={(e) => {
        encodePayload(e.dataTransfer, payload);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onPointerEnter={startAnim}
      onPointerLeave={stopAnim}
      onFocus={startAnim}
      onBlur={stopAnim}
    >
      <span className="vx-fxthumb">{src ? <img src={src} alt="" width={160} height={90} draggable={false} /> : null}</span>
      <span className="vx-fxname">{label}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vx-fxgroup">
      <h4>{title}</h4>
      <div className="vx-fxgrid" role="group" aria-label={title}>
        {children}
      </div>
    </section>
  );
}

function Status({ hasTarget, msg, what }: { hasTarget: boolean; msg: string; what: string }) {
  return (
    <div className="vx-fxstatus">
      <p className="vx-note" role="status" aria-live="polite">
        {msg || (hasTarget ? `Pulsa ${what} para aplicarlo al clip seleccionado, o arrástralo sobre un clip.` : `Selecciona un clip para aplicar ${what} con un clic, o arrástralo sobre un clip de la línea de tiempo.`)}
      </p>
    </div>
  );
}

const TRANS_GROUPS: TransGroup[] = ['Fundidos', 'Deslizar', 'Empujar', 'Zoom', 'Formas', 'Efectos'];
const TRANS_FRAMES = [0.2, 0.5, 0.8];

export function TransitionsPanel(props: FxPanelProps) {
  const { apply, hasTarget, msg } = useApply(props);
  return (
    <div className="vx-tabbody vx-fx" id="vx-fx-trans">
      <Status hasTarget={hasTarget} msg={msg} what="una transición" />
      <p className="vx-note">Entre dos clips contiguos va centrada en el corte y usa los márgenes de recorte. Suéltala sobre el símbolo ◇ de la unión.</p>
      {TRANS_GROUPS.map((g) => (
        <Group key={g} title={g}>
          {TRANSITIONS.filter((t) => t.group === g).map((t) => (
            <FxItem key={t.id} payload={{ kind: 'transition', id: t.id }} label={t.label} thumb={(f) => transitionThumb(t.id, f ?? thumbProgress(t.id))} frames={TRANS_FRAMES} onApply={apply} />
          ))}
        </Group>
      ))}
    </div>
  );
}

export function EffectsPanel(props: FxPanelProps) {
  const { apply, hasTarget, msg } = useApply(props);
  return (
    <div className="vx-tabbody vx-fx" id="vx-fx-fx">
      <Status hasTarget={hasTarget} msg={msg} what="un efecto" />
      <p className="vx-note">Los efectos se añaden al final de la pila del clip; su orden se cambia en el inspector.</p>
      {(['Imagen', 'Forma', 'Croma'] as const).map((cat) => (
        <Group key={cat} title={cat}>
          {IMAGE_FX(cat).map((d) => (
            <FxItem key={d.type} payload={{ kind: 'effect', type: d.type }} label={d.label} thumb={() => fxTypeThumb(d.type)} onApply={apply} />
          ))}
        </Group>
      ))}
      <Group title="IA en tu equipo">
        {AI_FX_DEFS.map((d) => (
          <FxItem key={d.type} payload={{ kind: 'effect', type: d.type }} label={d.label} thumb={() => aiThumb(d.type)} onApply={apply} />
        ))}
      </Group>
      {props.ai && <AiSelectedFx project={props.project} selection={props.selection} commit={props.commit} ai={props.ai} />}
      <Group title="Modos de fusión">
        {BLEND_MODES.map((m) => (
          <FxItem key={m} payload={{ kind: 'blend', mode: m }} label={BLEND_LABEL[m]} thumb={() => blendThumb(m)} onApply={apply} />
        ))}
      </Group>
    </div>
  );
}

export function AdjustPanel(props: FxPanelProps & { onAddAdjust: () => void }) {
  const { apply, hasTarget, msg } = useApply(props);
  return (
    <div className="vx-tabbody vx-fx" id="vx-fx-adj">
      <button type="button" className="primary" onClick={props.onAddAdjust} title="Crea una pista de video nueva encima de todas con una capa cuyos efectos afectan a todo lo que hay debajo">
        ＋ Capa de ajuste
      </button>
      <Status hasTarget={hasTarget} msg={msg} what="un ajuste" />
      <Group title="Color">
        {COLOR_FX.map((d) => (
          <FxItem key={d.type} payload={{ kind: 'effect', type: d.type }} label={d.label} thumb={() => fxTypeThumb(d.type)} onApply={apply} />
        ))}
      </Group>
      <Group title="Preajustes de color">
        {LOOKS.map((l) => (
          <FxItem key={l.id} payload={{ kind: 'look', id: l.id }} label={l.label} thumb={() => lookThumb(l.id)} onApply={apply} />
        ))}
      </Group>
    </div>
  );
}
