import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import type { Layer } from '../editor/core/types';
import {
  applyStyleToLayers,
  createStyle,
  deleteStyle,
  getStyles,
  styleUsage,
  unlinkStyle,
  updateStyleFromLayer,
} from '../editor/core/sharedStyles';
import { toast } from './toast';
import { t } from '../i18n';
import './organize.css';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `st-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// «Estilo de objeto»: estilos con nombre del documento. Guarda el formato de la capa
// (relleno/degradado, borde, sombra, opacidad, fuente…) y lo aplica a otras capas;
// «Actualizar» reaplica el estilo a todas las capas vinculadas.
export function SharedStyles({ layer }: { layer: Layer }) {
  const doc = useEditor((s) => s.doc);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editDoc = useEditor((s) => s.editDoc);
  const [name, setName] = useState('');
  const styles = getStyles(doc);
  // Se aplica a la selección múltiple si la capa forma parte de ella.
  const targets = selectedIds.length > 1 && selectedIds.includes(layer.id) ? selectedIds : [layer.id];

  return (
    <div className="more-group">
      <span className="more-title">{t('Estilos de objeto')}</span>
      <div className="ss-row">
        <input
          className="ss-name"
          value={name}
          placeholder={t('Nombre del estilo')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          title={t('Guarda el formato de esta capa como estilo del documento')}
          onClick={() => {
            editDoc((d) => {
              const src = d.layers.find((l) => l.id === layer.id);
              return src ? createStyle(d, uid(), name, src) : d;
            });
            setName('');
            toast(t('Estilo guardado'), 'success');
          }}
        >
          {t('Guardar estilo')}
        </button>
      </div>
      {styles.length === 0 && <p className="rail-hint">{t('Aún no hay estilos. Da formato a una capa y guárdala.')}</p>}
      {styles.map((s) => {
        const linked = layer.styleId === s.id;
        return (
          <div key={s.id} className={`ss-item${linked ? ' on' : ''}`}>
            <span className="ss-title" title={s.name}>
              {s.name} <small>({styleUsage(doc, s.id)})</small>
            </span>
            <button
              className="mini"
              title={t('Aplicar este estilo a la capa (o a la selección)')}
              onClick={() => editDoc((d) => applyStyleToLayers(d, s.id, targets))}
            >
              {t('Aplicar')}
            </button>
            {linked && (
              <>
                <button
                  className="mini"
                  title={t('Usa el formato de esta capa como nuevo estilo y lo reaplica a todas las capas vinculadas')}
                  onClick={() => {
                    editDoc((d) => updateStyleFromLayer(d, s.id, layer.id));
                    toast(t('Estilo actualizado en las capas vinculadas'), 'success');
                  }}
                >
                  {t('Actualizar')}
                </button>
                <button className="mini" title={t('Quitar el vínculo (la capa conserva su aspecto)')} onClick={() => editDoc((d) => unlinkStyle(d, targets))}>
                  {t('Desvincular')}
                </button>
              </>
            )}
            <button className="mini" title={t('Borrar el estilo (las capas conservan su aspecto)')} onClick={() => editDoc((d) => deleteStyle(d, s.id))}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
