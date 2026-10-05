import { useRef } from 'react';
import { t, useLang } from '../i18n';
import { ACTIONS, useShortcuts } from '../editor/core/shortcuts';
import { useDismiss } from './useDismiss';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Editor de imágenes',
    items: [
      ['Supr', 'Borrar capa (no bloqueadas)'],
      ['Flechas', 'Mover 1 px · con Shift 10 px'],
      ['Esc', 'Deseleccionar / cancelar recorte / salir del modo concentración'],
      ['Rueda del ratón', 'Zoom hacia el cursor'],
      ['Espacio + arrastrar', 'Mover el lienzo (o botón central)'],
      ['Clic derecho · pulsación larga', 'Menú contextual: copiar, pegar, duplicar, orden, bloqueo, fusión, agrupar, borrar (sobre vacío: pegar, seleccionar todo, agregar página)'],
      ['Alt+Shift+↑ / ↓', 'Recorre los modos de fusión de la selección; vista previa en vivo y un solo paso de deshacer'],
      ['Alt+Shift+N', 'Fusión: volver a Normal (M multiplicar, S trama, O superponer… en el grupo «Fusión»)'],
      ['Esc (menús y paneles)', 'Cierra menús y paneles (el selector de fusión revierte la vista previa)'],
      ['Barra inferior', 'Muestra la herramienta activa y su tecla, el zoom y pistas cortas'],
      ['Doble clic en texto', 'Editar el texto'],
    ],
  },
  {
    title: 'Editor de video',
    items: [
      ['Espacio', 'Reproducir / pausar'],
      ['← / →', 'Fotograma anterior / siguiente · con Shift 1 s'],
      ['S', 'Dividir el clip en el cabezal'],
      ['Supr', 'Borrar el clip seleccionado'],
    ],
  },
  {
    title: 'Pincel / máscara',
    items: [
      ['Ctrl+Z', 'Deshacer trazo'],
      ['Rueda del ratón', 'Zoom'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onClose });
  useLang();
  const keys = useShortcuts();
  // Atajos personalizables: se muestran los efectivos, en su grupo.
  const custom = [...new Set(ACTIONS.map((a) => a.group))].map((g) => ({
    title: g,
    items: ACTIONS.filter((a) => a.group === g).map((a): [string, string] => [keys[a.id] || '—', a.label]),
  }));
  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>⌨ {t('Atajos de teclado')}</h3>
        {[...custom, ...GROUPS].map((g) => (
          <div className="settings-section" key={g.title}>
            <span className="settings-label">{t(g.title)}</span>
            <ul className="shortcut-list">
              {g.items.map(([k, d]) => (
                <li key={k}>
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="support-desc">{t('Puedes cambiar estos atajos en Ajustes → Atajos.')}</p>
      </div>
    </div>
  );
}
