// Sección «Sonidos incluidos» de Ajustes → Licencias: aviso de que la biblioteca es CC0 y, al abrirla, procedencia de cada archivo.
// El índice se pide solo al desplegar (carga perezosa).
import { useState } from 'react';
import { externalClick } from '../../io/openExternal';
import type { SoundIndex } from './soundIndex';
import { loadSoundIndex } from './soundLibrary';

export function SoundsLicenseSection() {
  const [ix, setIx] = useState<SoundIndex | null>(null);
  const [err, setErr] = useState('');
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && !ix) loadSoundIndex().then(setIx, (x) => setErr(x instanceof Error ? x.message : String(x)));
  };
  const authors = ix ? [...new Set(ix.sonidos.map((s) => s.autor))].sort((a, b) => a.localeCompare(b)) : [];
  return (
    <div className="settings-section" data-testid="sounds-license">
      <span className="settings-label">Biblioteca de sonidos (editor de video)</span>
      <p className="support-desc">
        Los sonidos y la música de la pestaña «Sonidos» son de dominio público (CC0 1.0): se pueden usar en cualquier proyecto, también comercial, sin
        atribución obligatoria. Proceden de{' '}
        <a href="https://kenney.nl" onClick={externalClick}>Kenney</a> y de recursos CC0 de{' '}
        <a href="https://opengameart.org" onClick={externalClick}>OpenGameArt.org</a>; la licencia de cada archivo se comprobó en su página de origen.
      </p>
      <details onToggle={onToggle}>
        <summary>Ver autor y procedencia de cada sonido</summary>
        {err && <p className="support-desc" role="alert">{err}</p>}
        {!ix && !err && <p className="support-desc">Cargando…</p>}
        {ix && (
          <>
            <p className="support-desc">
              {ix.sonidos.length} archivos · autores: {authors.join(', ')}. Verificado el {ix.verificado}.
            </p>
            <ul className="support-desc" style={{ maxHeight: 220, overflow: 'auto', paddingLeft: 18, margin: 0 }}>
              {ix.sonidos.map((s) => (
                <li key={s.id}>
                  {s.nombre} — {s.autor} — {s.licencia} —{' '}
                  <a href={s.fuente} onClick={externalClick}>origen</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  );
}
