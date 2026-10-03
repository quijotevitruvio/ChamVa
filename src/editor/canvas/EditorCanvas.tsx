import { useRef } from 'react';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { CanvasViewport } from './CanvasViewport';
import type { CanvasBridge } from './CanvasViewport';
import { PageStage } from './PageStage';

export { isTypingTarget } from './CanvasViewport';

// Lienzo del editor = contenedor con scroll/zoom (CanvasViewport) + la página
// activa (PageStage). Las refs compartidas viajan en un solo `bridge`.
export function EditorCanvas() {
  const doc = useEditor((s) => s.doc);
  const bridge: CanvasBridge = {
    areaRef: useRef<HTMLDivElement>(null),
    stageRef: useRef<Konva.Stage>(null),
    nodeRefs: useRef<Map<string, Konva.Node>>(new Map()),
    updateSelRectRef: useRef(null),
    dropRef: useRef(null),
    rulerGuideStartRef: useRef(null),
  };
  return (
    <CanvasViewport doc={doc} bridge={bridge}>
      {(scale) => <PageStage doc={doc} scale={scale} bridge={bridge} />}
    </CanvasViewport>
  );
}
