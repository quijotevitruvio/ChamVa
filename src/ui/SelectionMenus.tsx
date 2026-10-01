import { useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import type { Layer } from '../editor/core/types';
import { t } from '../i18n';
import { getStyleSource, setStyleSource } from '../editor/core/styleClipboard';
import { copyLayerCss } from '../io/layerCssCopy';

// Menú contextual (clic derecho) sobre una capa.
export function ContextMenu({
  selected,
  pos,
  onClose,
}: {
  selected: Layer;
  pos: { x: number; y: number };
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const setLayerRotation = useEditor((s) => s.setLayerRotation);
  const reorderLayers = useEditor((s) => s.reorderLayers);
  const updateLayer = useEditor((s) => s.updateLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const selectedIds = useEditor((s) => s.selectedIds);
  const groupSelected = useEditor((s) => s.groupSelected);
  const ungroupSelected = useEditor((s) => s.ungroupSelected);
  const removeSelected = useEditor((s) => s.removeSelected);
  const selectSimilar = useEditor((s) => s.selectSimilar);
  const pasteStyle = useEditor((s) => s.pasteStyle);
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const multi = selectedIds.length > 1;
  return (
    <div className="ctx-menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      {multi && <button onClick={run(groupSelected)}>🔗 {t('Agrupar')} (Ctrl+G)</button>}
      {selected.groupId && <button onClick={run(ungroupSelected)}>⛓ {t('Desagrupar')}</button>}
      {multi && (
        <button className="danger" onClick={run(removeSelected)}>
          🗑 {t('Borrar selección')}
        </button>
      )}
      {selected.type === 'text' && (
        <button onClick={run(() => requestTextEdit(selected.id))}>✎ {t('Editar texto')}</button>
      )}
      <button onClick={run(() => duplicateLayer(selected.id))}>⧉ {t('Duplicar')}</button>
      <button onClick={run(() => selectSimilar(selected.id))}>▦ {t('Seleccionar similares')}</button>
      <button onClick={run(() => setStyleSource(selected))}>⎘ {t('Copiar formato')}</button>
      <button onClick={run(() => copyLayerCss(selected))}>{'</>'} {t('Copiar CSS')}</button>
      <button disabled={!getStyleSource()} onClick={run(() => getStyleSource() && pasteStyle(getStyleSource()!))}>
        ⎗ {t('Pegar solo el formato')} (Ctrl+Alt+V)
      </button>
      <button onClick={run(() => setLayerRotation(selected.id, selected.rotation + 90))}>
        ⟳ {t('Girar 90°')}
      </button>
      <button
        onClick={run(() => {
          const topFirst = doc.layers.map((l) => l.id).reverse();
          reorderLayers([selected.id, ...topFirst.filter((x) => x !== selected.id)].reverse());
        })}
      >
        ⬆ {t('Traer al frente')}
      </button>
      <button
        onClick={run(() => {
          const bottomFirst = doc.layers.map((l) => l.id);
          reorderLayers([selected.id, ...bottomFirst.filter((x) => x !== selected.id)]);
        })}
      >
        ⬇ {t('Enviar atrás')}
      </button>
      <button onClick={run(() => updateLayer(selected.id, { locked: !selected.locked }))}>
        {selected.locked ? `🔓 ${t('Desbloquear')}` : `🔒 ${t('Bloquear')}`}
      </button>
      <button onClick={run(() => updateLayer(selected.id, { visible: !selected.visible }))}>
        {selected.visible ? `🚫 ${t('Ocultar')}` : `👁 ${t('Mostrar')}`}
      </button>
      <button className="danger" onClick={run(() => removeLayer(selected.id))}>
        🗑 {t('Borrar')}
      </button>
    </div>
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
