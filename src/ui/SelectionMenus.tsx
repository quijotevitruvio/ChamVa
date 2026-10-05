import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import type { Layer } from '../editor/core/types';
import { t } from '../i18n';
import { getStyleSource, setStyleSource } from '../editor/core/styleClipboard';
import { copyLayerCss } from '../io/layerCssCopy';
import { getShortcut } from '../editor/core/shortcuts';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';
import { LayerBlendButton, LayerBlendMenu } from './BlendPicker';
import { clampMenu, ctxItems, type CtxItemId } from './contextMenuLogic';
import { useCtxMenu } from './ctxMenuStore';

// Menú contextual (clic derecho en el lienzo o en una capa del panel; pulsación larga en táctil).
// Sobre una capa: copiar, pegar, duplicar, orden, bloqueo, fusión, agrupar, borrar…
// Sobre vacío: pegar, seleccionar todo, agregar página. Cierra con Esc, ✕ o clic fuera.
export function ContextMenu({
  onCopy,
  onPaste,
  canPaste,
}: {
  onCopy: () => void;
  onPaste: () => void;
  canPaste: () => boolean;
}) {
  const open = useCtxMenu((s) => s.open);
  if (!open) return null;
  return (
    <ContextMenuInner
      key={`${open.x},${open.y},${open.layerId ?? ''}`}
      open={open}
      onCopy={onCopy}
      onPaste={onPaste}
      canPaste={canPaste}
    />
  );
}

function ContextMenuInner({
  open,
  onCopy,
  onPaste,
  canPaste,
}: {
  open: { x: number; y: number; layerId?: string };
  onCopy: () => void;
  onPaste: () => void;
  canPaste: () => boolean;
}) {
  const hide = useCtxMenu((s) => s.hide);
  const doc = useEditor((s) => s.doc);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const st = useEditor.getState;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [blendAnchor, setBlendAnchor] = useState<DOMRect | null>(null);
  const [blendOpen, setBlendOpen] = useState(false);
  useDismiss(ref, { onClose: hide, modal: false });

  // Desde el panel de capas el menú actúa sobre esa capa: se selecciona antes de actuar.
  useEffect(() => {
    if (open.layerId && !st().selectedIds.includes(open.layerId)) st().selectLayer(open.layerId);
    // Foco en la primera entrada para poder navegar con el teclado.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [open.layerId]);

  const selected = doc.layers.find((l) => l.id === (open.layerId ?? selectedId)) ?? null;
  const multi = selectedIds.length > 1;
  const items = ctxItems({
    layer: !!selected,
    multi,
    grouped: !!selected?.groupId,
    isText: selected?.type === 'text',
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(clampMenu({ x: open.x, y: open.y }, { w: el.offsetWidth, h: el.offsetHeight }, window.innerWidth, window.innerHeight));
  }, [open.x, open.y, items.length]);

  const run = (fn: () => void) => () => {
    hide();
    fn();
  };
  const L = selected;
  const reorder = (toFront: boolean) => () => {
    if (!L) return;
    const rest = st().doc.layers.map((l) => l.id).filter((x) => x !== L.id);
    st().reorderLayers(toFront ? [...rest, L.id] : [L.id, ...rest]);
  };
  const entries: Record<CtxItemId, { label: string; keys?: string; danger?: boolean; disabled?: boolean; act: () => void }> = {
    copy: { label: `⎘ ${t('Copiar')}`, keys: getShortcut('copy'), act: run(onCopy) },
    paste: { label: `⎗ ${t('Pegar')}`, keys: getShortcut('paste'), disabled: !canPaste(), act: run(onPaste) },
    duplicate: { label: `⧉ ${t('Duplicar')}`, keys: getShortcut('duplicate'), act: run(() => L && st().duplicateLayer(L.id)) },
    editText: { label: `✎ ${t('Editar texto')}`, act: run(() => L && st().requestTextEdit(L.id)) },
    front: { label: `⬆ ${t('Traer al frente')}`, act: run(reorder(true)) },
    back: { label: `⬇ ${t('Enviar atrás')}`, act: run(reorder(false)) },
    lock: {
      label: L?.locked ? `🔓 ${t('Desbloquear')}` : `🔒 ${t('Bloquear')}`,
      act: run(() => L && st().updateLayer(L.id, { locked: !L.locked })),
    },
    hide: {
      label: L?.visible === false ? `👁 ${t('Mostrar')}` : `🚫 ${t('Ocultar')}`,
      act: run(() => L && st().updateLayer(L.id, { visible: L.visible === false })),
    },
    group: { label: `🔗 ${t('Agrupar')}`, keys: getShortcut('group'), act: run(() => st().groupSelected()) },
    ungroup: { label: `⛓ ${t('Desagrupar')}`, keys: getShortcut('ungroup'), act: run(() => st().ungroupSelected()) },
    blend: {
      label: `◐ ${t('Fusión')}…`,
      keys: '⌥⇧↑↓',
      act: () => {
        setBlendAnchor(ref.current?.getBoundingClientRect() ?? null);
        setBlendOpen(true);
      },
    },
    similar: { label: `▦ ${t('Seleccionar similares')}`, act: run(() => L && st().selectSimilar(L.id)) },
    copyStyle: { label: `⎘ ${t('Copiar formato')}`, act: run(() => L && setStyleSource(L)) },
    pasteStyle: {
      label: `⎗ ${t('Pegar solo el formato')}`,
      keys: 'Ctrl+Alt+V',
      disabled: !getStyleSource(),
      act: run(() => getStyleSource() && st().pasteStyle(getStyleSource()!)),
    },
    css: { label: `</> ${t('Copiar CSS')}`, act: run(() => L && copyLayerCss(L)) },
    rotate: { label: `⟳ ${t('Girar 90°')}`, act: run(() => L && st().setLayerRotation(L.id, L.rotation + 90)) },
    delete: {
      label: `🗑 ${multi ? t('Borrar selección') : t('Borrar')}`,
      keys: 'Supr',
      danger: true,
      act: run(() => (multi ? st().removeSelected() : L && st().removeLayer(L.id))),
    },
    selectAll: { label: `▣ ${t('Seleccionar todo')}`, keys: getShortcut('selectAll'), act: run(() => st().selectAll()) },
    addPage: { label: `＋ ${t('Agregar página')}`, act: run(() => st().addPage()) },
  };

  // ↑ ↓ recorren las entradas; Inicio/Fin saltan.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    let go = -1;
    if (e.key === 'ArrowDown') go = (i + 1) % btns.length;
    else if (e.key === 'ArrowUp') go = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') go = 0;
    else if (e.key === 'End') go = btns.length - 1;
    if (go >= 0) {
      e.preventDefault();
      e.stopPropagation();
      btns[go]?.focus();
    }
  };

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        aria-label={t('Menú contextual')}
        data-testid="ctx-menu"
        style={{ left: pos?.left ?? open.x, top: pos?.top ?? open.y, visibility: pos && !blendOpen ? 'visible' : 'hidden' }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <div className="ctx-head">
          <span>{selected ? (multi ? `${selectedIds.length} ${t('capas')}` : t('Capa')) : t('Lienzo')}</span>
          <CloseButton onClick={hide} className="ctx-x" />
        </div>
        {items.map((id, i) => {
          if (id === null) return <div key={`sep${i}`} className="ctx-sep" role="separator" />;
          const e = entries[id];
          return (
            <button
              key={id}
              type="button"
              role="menuitem"
              data-item={id}
              className={e.danger ? 'danger' : ''}
              disabled={e.disabled}
              onClick={e.act}
            >
              <span>{e.label}</span>
              {e.keys ? <kbd>{e.keys}</kbd> : null}
            </button>
          );
        })}
      </div>
      {blendOpen && (
        <LayerBlendMenu
          anchor={blendAnchor}
          onClose={() => {
            setBlendOpen(false);
            hide();
          }}
        />
      )}
    </>
  );
}

// Posición de la barra flotante: arriba de la selección si cabe; si no, debajo;
// y si tampoco, dentro (arriba) sin salirse de la pantalla ni de la barra inferior.
export function floatToolbarPos(
  rect: { left: number; top: number; width: number; height?: number },
  size: { w: number; h: number },
  vw: number,
  vh: number,
): { left: number; top: number } {
  const margin = 8;
  const bottomSafe = vw <= 768 ? 140 : 56; // riel inferior en móvil / barra de páginas
  const left = Math.max(margin + size.w / 2, Math.min(vw - margin - size.w / 2, rect.left + rect.width / 2));
  const above = rect.top - size.h - margin;
  if (above >= margin) return { left, top: above };
  const below = rect.top + (rect.height ?? 0) + margin;
  if (rect.height !== undefined && below + size.h <= vh - bottomSafe) return { left, top: below };
  return { left, top: Math.max(margin, Math.min(vh - bottomSafe - size.h, rect.top + margin)) };
}

// Barra flotante sobre la selección: botones según el tipo de capa.
export function FloatToolbar({
  selected,
  rect,
  bgBusy,
  onRemoveBackground,
  onShowFilters,
}: {
  selected: Layer;
  rect: { left: number; top: number; width: number; height?: number };
  bgBusy: boolean;
  onRemoveBackground: () => void;
  onShowFilters: () => void;
}) {
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const setLayerRotation = useEditor((s) => s.setLayerRotation);
  const updateLayer = useEditor((s) => s.updateLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const moveLayer = useEditor((s) => s.moveLayer);
  const beginCrop = useEditor((s) => s.beginCrop);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Mide la barra y la recoloca cada vez que cambia la selección o la ventana.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      setPos(floatToolbarPos(rect, { w: el.offsetWidth, h: el.offsetHeight }, window.innerWidth, window.innerHeight));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [rect.left, rect.top, rect.width, rect.height, selected.id, selected.type]);

  const colorInput = (value: string, onChange: (v: string) => void, title: string) => (
    <input
      type="color"
      className="ft-color"
      title={title}
      value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <div
      ref={ref}
      className="float-toolbar"
      style={{ left: pos?.left ?? rect.left + rect.width / 2, top: pos?.top ?? Math.max(8, rect.top - 48), visibility: pos ? 'visible' : 'hidden' }}
    >
      {selected.type === 'image' && (
        <>
          <button onClick={onRemoveBackground} disabled={bgBusy} title="Quitar fondo">
            ✂
          </button>
          <button onClick={onShowFilters} title="Filtros">
            🎨
          </button>
          <button onClick={beginCrop} title="Recortar">
            ⛶
          </button>
          <button onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })} title="Voltear">
            ↔
          </button>
        </>
      )}
      {selected.type === 'text' && (
        <>
          <button onClick={() => requestTextEdit(selected.id)} title="Editar texto">
            ✎
          </button>
          <button
            className={selected.bold ? 'on' : ''}
            onClick={() => updateLayer(selected.id, { bold: !selected.bold })}
            title="Negrita"
          >
            <b>B</b>
          </button>
          <button
            className={selected.italic ? 'on' : ''}
            onClick={() => updateLayer(selected.id, { italic: !selected.italic })}
            title="Cursiva"
          >
            <i>I</i>
          </button>
          <button
            onClick={() => updateLayer(selected.id, { fontSize: Math.max(6, Math.round(selected.fontSize * 0.9)) })}
            title="Texto más pequeño"
          >
            A−
          </button>
          <button
            onClick={() => updateLayer(selected.id, { fontSize: Math.min(800, Math.round(selected.fontSize * 1.1) + 1) })}
            title="Texto más grande"
          >
            A+
          </button>
          {colorInput(selected.fill, (v) => updateLayer(selected.id, { fill: v, fillGradient: undefined }), 'Color del texto')}
        </>
      )}
      {selected.type === 'shape' && (
        <>
          {colorInput(selected.fill, (v) => updateLayer(selected.id, { fill: v, fillGradient: undefined }), 'Color de relleno')}
          {colorInput(selected.stroke, (v) => updateLayer(selected.id, { stroke: v, strokeWidth: selected.strokeWidth || 2 }), 'Color del borde')}
          <button
            onClick={() => {
              const steps = [0, 2, 4, 8, 14];
              const i = steps.findIndex((x) => x > selected.strokeWidth);
              updateLayer(selected.id, { strokeWidth: i < 0 ? 0 : steps[i] });
            }}
            title={`Grosor del borde (${selected.strokeWidth} px): pulsa para cambiar`}
          >
            ▢
          </button>
        </>
      )}
      <LayerBlendButton compact />
      <button
        onClick={() => setLayerRotation(selected.id, selected.rotation + 90)}
        title="Girar 90° (o arrastra la manija sobre la selección)"
      >
        ⟳
      </button>
      <button onClick={() => duplicateLayer(selected.id)} title="Duplicar">
        ⧉
      </button>
      <button onClick={() => moveLayer(selected.id, 'up')} title="Subir">
        ⬆
      </button>
      <button onClick={() => moveLayer(selected.id, 'down')} title="Bajar">
        ⬇
      </button>
      <button className="danger" onClick={() => removeLayer(selected.id)} title="Borrar">
        🗑
      </button>
    </div>
  );
}
