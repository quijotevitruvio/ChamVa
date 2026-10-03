import { useMemo, useRef } from 'react';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { CanvasViewport } from './CanvasViewport';
import type { CanvasBridge } from './CanvasViewport';
import { PageStage } from './PageStage';
import { PageStack } from './PageStack';

export { isTypingTarget } from './CanvasViewport';

// Lienzo del editor = contenedor con scroll/zoom (CanvasViewport) + la página
// activa (PageStage), o en modo apilado (`pageView: 'stack'`) la pila de páginas
// (PageStack). Las refs compartidas viajan en un solo `bridge`.
export function EditorCanvas() {
  const doc = useEditor((s) => s.doc);
  const pageView = useEditor((s) => s.pageView);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const updateSelRectRef = useRef(null);
  const dropRef = useRef(null);
  const rulerGuideStartRef = useRef(null);
  const bridge: CanvasBridge = useMemo(
    () => ({ areaRef, stageRef, nodeRefs, updateSelRectRef, dropRef, rulerGuideStartRef }),
    [],
  );
  if (pageView === 'stack') {
    // La activa es siempre `doc`; el resto, tal cual están en `pages`.
    const sizes = pages.map((p, i) => (i === pageIndex ? doc : p));
    return (
      <CanvasViewport doc={doc} bridge={bridge} stack={sizes}>
        {(scale) => <PageStack scale={scale} bridge={bridge} />}
      </CanvasViewport>
    );
  }
  return (
    <CanvasViewport doc={doc} bridge={bridge}>
      {(scale) => <PageStage doc={doc} scale={scale} bridge={bridge} />}
    </CanvasViewport>
  );
}
