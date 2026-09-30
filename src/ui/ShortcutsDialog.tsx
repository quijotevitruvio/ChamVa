import { t } from '../i18n';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Editor de imágenes',
    items: [
      ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'],
      ['Ctrl+C / Ctrl+V', 'Copiar / Pegar capa'],
      ['Ctrl+D', 'Duplicar capa'],
      ['Supr', 'Borrar capa (no bloqueadas)'],
      ['Flechas', 'Mover 1 px · con Shift 10 px'],
      ['Esc', 'Deseleccionar / cancelar recorte'],
      ['Rueda del ratón', 'Zoom hacia el cursor'],
      ['Espacio + arrastrar', 'Mover el lienzo (o botón central)'],
      ['Clic derecho', 'Menú contextual de la capa'],
      ['Doble clic en texto', 'Editar el texto'],
      ['?', 'Este panel'],
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
  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>⌨ {t('Atajos de teclado')}</h3>
        {GROUPS.map((g) => (
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
      </div>
    </div>
  );
}
