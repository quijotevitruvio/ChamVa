// Página de desarrollo (/dev/speed-ui.html): monta el inspector REAL de V8 con un proyecto sintético para comprobar la
// interfaz (curva de velocidad, invertir, bucle, reencuadre) a 390 px y con eventos de verdad. Cuelga de window.__ui.
import { createRoot } from 'react-dom/client';
import { useState, useSyncExternalStore } from 'react';
import * as VM from '../model';
import { Inspector } from '../../ui/video/Inspector';
import { PreviewEngine } from '../../ui/video/previewEngine';
import { MediaCache } from '../../ui/video/mediaCache';
import type { Aspect } from '../engine/formats';
import { makeSynthClip } from './synth';
import '../../ui/video/video.css';

const cache = new MediaCache();
const engine = new PreviewEngine({ cache });
engine.attach(document.getElementById('cv') as HTMLCanvasElement);
let hist = VM.createHistory(VM.createProject());
const listeners = new Set<() => void>();
const get = () => hist;
const commit = (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => {
  hist = VM.commit(hist, fn(hist.present), { group });
  engine.setProject(hist.present);
  listeners.forEach((l) => l());
  return hist.present;
};

function App() {
  const h = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), get);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [sel] = useState(['c']);
  const [keyClip, setKeyClip] = useState<{ prop: string; keys: VM.Keyframe[] }[]>([]);
  const [autoKey, setAutoKey] = useState(false);
  return (
    <div className="vx-root" style={{ maxWidth: 420 }}>
      <div className="vx-side" style={{ maxHeight: 'none' }}>
        <Inspector
          project={h.present}
          selection={sel}
          commit={commit}
          onSplit={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
          engine={engine}
          autoKey={autoKey}
          setAutoKey={setAutoKey}
          keyClip={keyClip}
          setKeyClip={setKeyClip}
          onSelect={() => {}}
          aspect={aspect}
          setAspect={(a) => {
            setAspect(a);
            engine.setFormat(a, 'contain');
          }}
          fit="contain"
        />
      </div>
    </div>
  );
}

(async () => {
  const s = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 14, toneAmp: 0.1, beepsAt: [3, 6, 9, 12] });
  let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'synth.mp4', duration: 14, blob: s.blob });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 14 }));
  hist = VM.createHistory(p);
  engine.setProject(p);
  engine.seek(2);
  createRoot(document.getElementById('app')!).render(<App />);
  Object.assign(window, {
    __ui: {
      engine,
      project: () => hist.present,
      history: () => hist,
      undo: () => {
        hist = VM.undo(hist);
        engine.setProject(hist.present);
        listeners.forEach((l) => l());
      },
      commit,
    },
  });
})();
