import { useEditor } from '../editor/state/store';
import type { Layer } from '../editor/core/types';
import { t } from '../i18n';

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

// Barra flotante sobre la selección.
export function FloatToolbar({
  selected,
  rect,
  bgBusy,
  onRemoveBackground,
  onShowFilters,
}: {
  selected: Layer;
  rect: { left: number; top: number; width: number };
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
  return (
    <div
      className="float-toolbar"
      style={{ left: rect.left + rect.width / 2, top: Math.max(8, rect.top - 48) }}
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
        <button onClick={() => requestTextEdit(selected.id)} title="Editar texto">
          ✎
        </button>
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
