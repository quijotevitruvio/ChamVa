import { useEffect, useState } from 'react';
import { loadDesigns, type SavedDesign } from '../io/designs';
import { flushSave } from '../io/autosave';
import { getSaveStatus } from '../io/saveStatus';
import { needsOpenConfirm } from '../editor/core/projectsList';
import { useEditor } from '../editor/state/store';
import { DesignFolders } from './DesignFolders';
import { toast } from './toast';
import { t } from '../i18n';
import './projects.css';

interface Props {
  onOpenDesign: (d: SavedDesign) => void | Promise<void>;
  onGoHome: () => void;
}

// Riel «Proyectos»: los diseños guardados (mismas carpetas, etiquetas, búsqueda y
// papelera que Inicio) para saltar de uno a otro sin pasar por la pantalla de inicio.
export function ProjectsPanel({ onOpenDesign, onGoHome }: Props) {
  const currentId = useEditor((s) => s.designId);
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [pending, setPending] = useState<SavedDesign | null>(null); // abrir con guardado fallido: a la espera de «sí»
  const [busy, setBusy] = useState(false);

  // Al entrar se guarda el diseño actual: así aparece (y al día) en la lista.
  useEffect(() => {
    let alive = true;
    void flushSave()
      .then(loadDesigns)
      .then((l) => alive && setDesigns(l));
    return () => {
      alive = false;
    };
  }, []);

  const open = async (d: SavedDesign, force = false) => {
    if (busy) return;
    if (d.id === currentId) return;
    setBusy(true);
    try {
      await flushSave(); // lo último escrito antes de reemplazar el lienzo
      if (!force && needsOpenConfirm(getSaveStatus().state)) {
        setPending(d);
        return;
      }
      setPending(null);
      const prev = useEditor.getState();
      const prevName = prev.designName ?? prev.pages[0]?.name ?? '';
      await onOpenDesign(d);
      toast(
        needsOpenConfirm(getSaveStatus().state)
          ? t('Abierto «{n}». Ojo: el diseño anterior no se pudo guardar.').replace('{n}', d.name)
          : t('Se guardó «{a}» y se abrió «{b}».').replace('{a}', prevName).replace('{b}', d.name),
        needsOpenConfirm(getSaveStatus().state) ? 'error' : 'success',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proj">
      <button className="rail-big" onClick={() => void flushSave().finally(onGoHome)}>
        ＋ {t('Nuevo diseño')}
      </button>

      {pending && (
        <div className="proj-warn">
          <p>{t('El diseño actual no se pudo guardar. Si abres otro, se pierden sus últimos cambios.')}</p>
          <div className="proj-warn-acts">
            <button className="lib-btn danger" onClick={() => void open(pending, true)}>
              {t('Abrir de todos modos')}
            </button>
            <button className="lib-btn" onClick={() => setPending(null)}>
              {t('Cancelar')}
            </button>
          </div>
        </div>
      )}

      {designs === null ? (
        <p className="rail-hint">{t('Cargando…')}</p>
      ) : (
        <DesignFolders designs={designs} onChange={setDesigns} onOpen={(d) => void open(d)} currentId={currentId} />
      )}
    </div>
  );
}
