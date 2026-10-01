import { useState } from 'react';
import './overlays.css';

const KEY = 'chamva.tourDone';

/** true si el recorrido aún no se hizo (false si ya se hizo o si localStorage falla). */
export function shouldShowTour(): boolean {
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

function markDone() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* sin almacenamiento */
  }
}

const STEPS = [
  {
    title: 'Elige o sube algo',
    body: (
      <>
        En el riel de la izquierda: <b>Subir</b> tus imágenes, <b>Elementos</b> (formas, iconos) o{' '}
        <b>Texto</b>. Haz clic en cualquiera para añadirlo al lienzo.
      </>
    ),
  },
  {
    title: 'Edítalo',
    body: (
      <ul>
        <li>Doble clic sobre un texto para escribir encima.</li>
        <li>El panel de propiedades de la derecha ajusta lo seleccionado.</li>
        <li>
          <b>Ctrl+K</b> busca cualquier acción.
        </li>
      </ul>
    ),
  },
  {
    title: 'Descarga',
    body: (
      <ul>
        <li>
          Pulsa <b>Descargar</b> arriba a la derecha.
        </li>
        <li>PNG sin marca de agua.</li>
        <li>
          Pulsa <b>?</b> para ver todos los atajos.
        </li>
      </ul>
    ),
  },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  const finish = () => {
    markDone();
    onDone();
  };
  const step = STEPS[i];
  return (
    <div className="tour" role="dialog" aria-label="Recorrido de bienvenida" aria-live="polite">
      <div className="tour-step">
        Paso {i + 1} de {STEPS.length}
      </div>
      <h2 className="tour-title">{step.title}</h2>
      <div className="tour-body">{step.body}</div>
      <div className="tour-foot">
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((_, n) => (
            <span key={n} className={`tour-dot${n === i ? ' on' : ''}`} />
          ))}
        </div>
        {!last && (
          <button className="tour-skip" onClick={finish}>
            Saltar
          </button>
        )}
        <button className="tour-next" onClick={last ? finish : () => setI(i + 1)}>
          {last ? 'Entendido' : 'Siguiente'}
        </button>
      </div>
    </div>
  );
}
