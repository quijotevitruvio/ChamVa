// Pestaña «Sonidos» del panel de medios: biblioteca CC0 incluida en la app (public/sounds). Busca por nombre o etiqueta, filtra por
// categoría, escucha de uno en uno y arrastra a la línea de tiempo o pulsa «＋» (pista de audio en el cabezal). El índice y los
// archivos se piden solo al abrir la pestaña / usar un sonido (carga perezosa).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { filterSounds, fmtSoundDuration, type SoundEntry, type SoundIndex } from '../../video/sounds/soundIndex';
import { loadSoundIndex, previewStore, SOUND_MIME, stopPreview, togglePreview } from '../../video/sounds/soundLibrary';

interface Props {
  /** añade el sonido en el cabezal (un paso de deshacer) */
  onAddSound: (s: SoundEntry) => void;
}

export function SoundsPanel({ onAddSound }: Props) {
  const [ix, setIx] = useState<SoundIndex | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState('');
  useSyncExternalStore(previewStore.subscribe, previewStore.getVersion);
  const { playingId, loadingId, error } = previewStore.state();

  const load = () => {
    setErr('');
    loadSoundIndex().then(setIx, (e) => setErr(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    load();
    return () => stopPreview(); // al salir de la pestaña, se calla
  }, []);

  const list = useMemo(() => (ix ? filterSounds(ix.sonidos, { query: q, category: cat }) : []), [ix, q, cat]);
  const catName = (id: string) => ix?.categorias.find((c) => c.id === id)?.nombre ?? id;

  if (err) {
    return (
      <div className="vx-snd">
        <p className="vx-note" role="alert">{err}</p>
        <button type="button" onClick={load}>Reintentar</button>
      </div>
    );
  }
  if (!ix) return <div className="vx-snd"><p className="vx-note" role="status">Cargando la biblioteca de sonidos…</p></div>;

  return (
    <div className="vx-snd">
      <div className="vx-snd-head">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar sonido, p. ej. lluvia, risa, clic…" aria-label="Buscar sonidos por nombre o etiqueta" />
        <div className="vx-snd-cats" role="group" aria-label="Categorías de sonidos">
          <button type="button" className={cat === '' ? 'on' : ''} aria-pressed={cat === ''} onClick={() => setCat('')}>Todos</button>
          {ix.categorias.map((c) => (
            <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? '' : c.id)}>{c.nombre}</button>
          ))}
        </div>
      </div>
      <div className="vx-bin-list vx-snd-list" role="list" aria-label="Sonidos">
        {list.length === 0 && <p className="vx-note">Ningún sonido coincide con la búsqueda.</p>}
        {list.map((s) => {
          const on = playingId === s.id;
          const loading = loadingId === s.id;
          return (
            <div
              key={s.id}
              role="listitem"
              className={`vx-media k-audio vx-snd-item${on ? ' playing' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SOUND_MIME, s.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <button type="button" className="mini vx-snd-play" onClick={() => void togglePreview(s)} aria-pressed={on || loading} aria-label={on || loading ? `Detener ${s.nombre}` : `Escuchar ${s.nombre}`} title={on || loading ? 'Detener' : 'Escuchar'}>
                {loading ? '…' : on ? '■' : '▶'}
              </button>
              <div className="vx-media-info">
                <span className="vx-media-name" title={s.nombre}>{s.nombre}</span>
                <span className="vx-media-meta">{catName(s.categoria)} · {fmtSoundDuration(s.duracion)}{s.bucle ? ' · bucle' : ''}</span>
              </div>
              <button
                type="button"
                className="mini"
                disabled={busy === s.id}
                onClick={() => {
                  setBusy(s.id);
                  Promise.resolve(onAddSound(s)).finally(() => setBusy(''));
                }}
                aria-label={`Añadir ${s.nombre} al cabezal`}
                title="Añadir al cabezal (pista de audio)"
              >
                ＋
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="vx-note" role="alert">{error}</p>}
      <p className="vx-note vx-snd-foot">
        {list.length} de {ix.sonidos.length} sonidos · todos de dominio público (CC0), sin atribución obligatoria. Procedencia: Ajustes → Licencias.
      </p>
    </div>
  );
}
