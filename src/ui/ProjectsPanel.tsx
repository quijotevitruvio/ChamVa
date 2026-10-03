import { useEffect, useState } from 'react';
import { loadDesigns, type SavedDesign } from '../io/designs';
import { flushSave } from '../io/autosave';
import { useEditor } from '../editor/state/store';
import { DesignFolders } from './DesignFolders';
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

  // Abre en una pestaña (o cambia a la que ya lo tiene abierto): el diseño actual sigue en su
  // pestaña, así que ya no hay nada que perder y no se pide confirmación.
  const open = async (d: SavedDesign) => {
    if (busy || d.id === currentId) return;
    setBusy(true);
    try {
      await flushSave(); // lo último escrito, para que la lista esté al día
      await onOpenDesign(d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proj">
      <button className="rail-big" onClick={() => void flushSave().finally(onGoHome)}>
        ＋ {t('Nuevo diseño')}
      </button>

      {designs === null ? (
        <p className="rail-hint">{t('Cargando…')}</p>
      ) : (
        <DesignFolders designs={designs} onChange={setDesigns} onOpen={(d) => void open(d)} currentId={currentId} />
      )}
    </div>
  );
}
