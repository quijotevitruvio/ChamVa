import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { useEditor } from '../editor/state/store';
import {
  BLEND_GROUPS,
  BLEND_LABEL,
  BLEND_MODES,
  blendSvgExact,
  commonBlend,
  blendActionId,
  type BlendMode,
} from '../editor/core/blend';
import { getShortcut, useShortcuts } from '../editor/core/shortcuts';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';
import './blend.css';

// Selector de modos de fusión reutilizable: capas del lienzo (con vista previa en vivo)
// y clips de video (sin vista previa). La lista sale de editor/core/blend.ts.

export interface BlendMenuProps {
  value: BlendMode | 'mixed';
  /** Rectángulo del botón que lo abrió (para colocar el menú). */
  anchor: DOMRect | null;
  onClose: () => void;
  /** Confirma un modo (un gesto = un paso de deshacer). */
  onCommit: (m: BlendMode) => void;
  /** Aplica el modo de forma temporal (sin historial). Si falta, no hay vista previa. */
  onPreview?: (m: BlendMode) => void;
  /** Deshace la vista previa. */
  onRevert?: () => void;
  /** Control de opacidad junto a la lista (0..1). */
  opacity?: { value: number | 'mixed'; onStart: () => void; onChange: (v: number) => void };
}

export function BlendMenu({ value, anchor, onClose, onCommit, onPreview, onRevert, opacity }: BlendMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  useShortcuts();
  const current: BlendMode = value === 'mixed' ? 'normal' : value;
  const [active, setActive] = useState<BlendMode>(current);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const done = useRef(false); // ya se confirmó: no revertir al desmontar
  const gesture = useRef(false);

  const close = () => {
    if (!done.current) onRevert?.();
    done.current = true;
    onClose();
  };
  useDismiss(ref, { onClose: close, modal: false });

  // Si se desmonta sin confirmar (p. ej. cambia de página), no deja la vista previa puesta.
  useEffect(
    () => () => {
      if (!done.current) onRevert?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = anchor ?? new DOMRect(vw / 2, vh / 2, 0, 0);
    const margin = 8;
    const left = Math.max(margin, Math.min(vw - w - margin, a.left));
    const below = vh - a.bottom - margin;
    const above = a.top - margin;
    const fitBelow = below >= 320 || below >= above;
    const maxH = Math.max(220, Math.min(560, fitBelow ? below : above));
    const h = Math.min(el.scrollHeight, maxH);
    const top = fitBelow ? a.bottom + 4 : Math.max(margin, a.top - h - 4);
    setPos({ left, top, maxH });
  }, [anchor]);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    document.getElementById(`${uid}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, uid]);

  const preview = (m: BlendMode) => {
    setActive(m);
    onPreview?.(m);
  };
  const commit = (m: BlendMode) => {
    done.current = true;
    onCommit(m);
    onClose();
  };

  const onKeyDown = (e: RKeyEvent) => {
    // El editor no debe mover la capa ni cambiar de herramienta mientras se navega por la lista.
    e.stopPropagation();
    const i = BLEND_MODES.indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      preview(BLEND_MODES[(i + 1) % BLEND_MODES.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      preview(BLEND_MODES[(i - 1 + BLEND_MODES.length) % BLEND_MODES.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      preview(BLEND_MODES[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      preview(BLEND_MODES[BLEND_MODES.length - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const opVal = opacity ? (opacity.value === 'mixed' ? 1 : opacity.value) : 1;
  return createPortal(
    <>
      <div className="blend-scrim" onMouseDown={close} />
      <div
        ref={ref}
        className="blend-menu"
        role="dialog"
        aria-label={t('Fusión')}
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
        data-testid="blend-menu"
      >
        <header className="blend-head">
          <strong>{t('Fusión')}</strong>
          <CloseButton onClick={close} />
        </header>
        {opacity && (
          <label className="blend-opacity">
            <span>
              {t('Opacidad')}: {opacity.value === 'mixed' ? '—' : `${Math.round(opVal * 100)}%`}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={opVal}
              aria-label={t('Opacidad')}
              onPointerDown={() => opacity.onStart()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (!gesture.current && e.key.startsWith('Arrow')) {
                  gesture.current = true;
                  opacity.onStart();
                }
              }}
              onKeyUp={() => (gesture.current = false)}
              onChange={(e) => opacity.onChange(Number(e.target.value))}
            />
          </label>
        )}
        <ul
          ref={listRef}
          className="blend-list"
          role="listbox"
          tabIndex={0}
          aria-label={t('Modos de fusión')}
          aria-activedescendant={`${uid}-${active}`}
          onKeyDown={onKeyDown}
          onMouseLeave={() => {
            if (onPreview) {
              onRevert?.();
              setActive(current);
            }
          }}
        >
          {BLEND_GROUPS.map((g) => (
            <li key={g.id} role="presentation" className="blend-group">
              {g.id !== 'normal' && <div className="blend-group-title" role="presentation">{t(g.label)}</div>}
              <ul role="presentation">
                {g.modes.map((m) => {
                  const key = getShortcut(blendActionId(m));
                  return (
                    <li
                      key={m}
                      id={`${uid}-${m}`}
                      role="option"
                      aria-selected={value !== 'mixed' && m === current}
                      className={`blend-opt${m === active ? ' active' : ''}${value !== 'mixed' && m === current ? ' current' : ''}`}
                      data-mode={m}
                      onMouseEnter={() => preview(m)}
                      onClick={() => commit(m)}
                    >
                      <span className="blend-check" aria-hidden="true">{value !== 'mixed' && m === current ? '✓' : ''}</span>
                      <span className="blend-name">{t(BLEND_LABEL[m])}</span>
                      {!blendSvgExact(m) && (
                        <span className="blend-svg" title={t('En SVG puede verse distinto según el visor')}>
                          ≈SVG
                        </span>
                      )}
                      {key && <kbd>{key.replace('Alt+Shift+', '⌥⇧')}</kbd>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <p className="blend-hint">{t('Pasa el cursor o usa ↑ ↓ para ver el efecto; Intro confirma, Esc cancela.')}</p>
      </div>
    </>,
    document.body,
  );
}

/** Botón que muestra el modo actual y abre el menú. */
export function BlendButton({
  value,
  onCommit,
  onPreview,
  onRevert,
  opacity,
  className,
  compact,
  title,
  disabled,
}: Omit<BlendMenuProps, 'anchor' | 'onClose'> & { className?: string; compact?: boolean; title?: string; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const label = value === 'mixed' ? t('Mixto') : t(BLEND_LABEL[value]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`blend-btn ${className ?? ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title ?? `${t('Fusión')}: ${label}`}
        data-testid="blend-btn"
        onClick={() => {
          setAnchor(btn.current?.getBoundingClientRect() ?? null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">◐</span>
        {compact ? null : <span className="blend-btn-label">{label}</span>}
      </button>
      {open && (
        <BlendMenu
          value={value}
          anchor={anchor}
          onClose={() => setOpen(false)}
          onCommit={onCommit}
          onPreview={onPreview}
          onRevert={onRevert}
          opacity={opacity}
        />
      )}
    </>
  );
}

/** Propiedades del selector enlazadas al editor: selección (y sus grupos), vista previa y un solo paso de deshacer. */
function useLayerBlendProps(): Omit<BlendMenuProps, 'anchor' | 'onClose'> | null {
  const layers = useEditor((s) => s.doc.layers);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
  const sel = layers.filter((l) => ids.includes(l.id));
  if (!sel.length) return null;
  const st = useEditor.getState;
  const ops = sel.map((l) => l.opacity);
  return {
    value: commonBlend(sel.map((l) => l.blendMode)),
    onCommit: (m) => st().setBlendMode(m),
    onPreview: (m) => st().previewBlendMode(m),
    onRevert: () => st().cancelBlendPreview(),
    opacity: {
      value: ops.every((o) => o === ops[0]) ? ops[0] : 'mixed',
      onStart: () => st().checkpoint(),
      onChange: (v) => st().setOpacityLive(v),
    },
  };
}

/** Botón de fusión de la selección (barra contextual y Propiedades). */
export function LayerBlendButton({ compact, className }: { compact?: boolean; className?: string }) {
  const p = useLayerBlendProps();
  return p ? <BlendButton {...p} compact={compact} className={className} /> : null;
}

/** Menú de fusión de la selección abierto desde otro sitio (menú contextual, paleta). */
export function LayerBlendMenu({ anchor, onClose }: { anchor: DOMRect | null; onClose: () => void }) {
  const p = useLayerBlendProps();
  return p ? <BlendMenu {...p} anchor={anchor} onClose={onClose} /> : null;
}
