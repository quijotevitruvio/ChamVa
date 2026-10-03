import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { PageCard } from './PageCard';
import type { CanvasBridge } from './CanvasViewport';
import { mostVisibleIndex } from './stackLayout';
import '../../ui/pagestack.css';

// Evento para desplazar la pila a una página (lo lanza la barra de miniaturas).
export const STACK_SCROLL_EVENT = 'chamva:stack-scroll';
export function scrollStackToPage(index: number) {
  window.dispatchEvent(new CustomEvent(STACK_SCROLL_EVENT, { detail: index }));
}

// Modo apilado: todas las páginas una bajo otra. Solo la activa es el Stage real;
// las demás son imágenes (PageStill) que existen únicamente cerca de la pantalla.
export function PageStack({ scale, bridge }: { scale: number; bridge: CanvasBridge }) {
  const doc = useEditor((s) => s.doc);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const switchPage = useEditor((s) => s.switchPage);
  const area = bridge.areaRef;
  const rootRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<Set<string>>(() => new Set());
  // Evita que un desplazamiento hecho por código reactive páginas por scroll.
  const lockUntil = useRef(0);
  // Página activada con clic: no se desplaza la vista (se queda en su sitio).
  const noScrollFor = useRef<number | null>(null);

  // `pages[pageIndex]` puede estar obsoleta: la activa es siempre `doc`.
  const list = useMemo(() => pages.map((p, i) => (i === pageIndex ? doc : p)), [pages, doc, pageIndex]);

  // Páginas cercanas a la pantalla (una pantalla de margen arriba y abajo).
  useEffect(() => {
    const root = area.current;
    const el = rootRef.current;
    if (!root || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.pageId;
            if (!id) continue;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next.size === prev.size && [...next].every((x) => prev.has(x)) ? prev : next;
        });
      },
      { root, rootMargin: '100% 0px 100% 0px' },
    );
    el.querySelectorAll<HTMLElement>('.ps-card').forEach((c) => io.observe(c));
    return () => io.disconnect();
    // Se rehace al cambiar el conjunto/orden de páginas; la escala solo mueve alturas.
  }, [area, list.map((p) => p.id).join('|')]);

  const visibleIndex = useCallback(() => {
    const root = area.current;
    const el = rootRef.current;
    if (!root || !el) return -1;
    const vr = root.getBoundingClientRect();
    const rects = Array.from(el.querySelectorAll<HTMLElement>('.ps-card')).map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    return mostVisibleIndex(rects, vr.top, vr.bottom);
  }, [area]);

  const scrollToCard = useCallback(
    (i: number) => {
      const root = area.current;
      const card = rootRef.current?.querySelector<HTMLElement>(`.ps-card[data-page-index="${i}"]`);
      if (!root || !card) return;
      lockUntil.current = Date.now() + 400;
      const top = card.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8;
      root.scrollTo({ top: Math.max(0, top) });
    },
    [area],
  );

  // Al cambiar la página activa por otra vía (miniaturas, buscar, añadir, borrar…),
  // llevar la vista a su tarjeta si no es ya la más visible.
  useLayoutEffect(() => {
    if (noScrollFor.current === pageIndex) {
      noScrollFor.current = null;
      return;
    }
    if (visibleIndex() !== pageIndex) scrollToCard(pageIndex);
  }, [pageIndex, visibleIndex, scrollToCard]);

  // Clic en una miniatura de la barra (también la de la página ya activa).
  useEffect(() => {
    const on = (e: Event) => scrollToCard((e as CustomEvent<number>).detail);
    window.addEventListener(STACK_SCROLL_EVENT, on);
    return () => window.removeEventListener(STACK_SCROLL_EVENT, on);
  }, [scrollToCard]);

  // Al terminar el scroll, activa la página más visible (si no hay selección ni texto en edición).
  useEffect(() => {
    const root = area.current;
    if (!root) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Date.now() < lockUntil.current) return;
        const st = useEditor.getState();
        if (st.selectedId || st.selectedIds.length || st.editingTextId) return;
        const i = visibleIndex();
        if (i >= 0 && i !== st.pageIndex) {
          noScrollFor.current = i;
          st.switchPage(i);
        }
      }, 150);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener('scroll', onScroll);
    };
  }, [area, visibleIndex]);

  const activate = useCallback(
    (i: number) => {
      if (i === useEditor.getState().pageIndex) return;
      noScrollFor.current = i;
      switchPage(i);
    },
    [switchPage],
  );

  return (
    <div className="ps-stack" ref={rootRef}>
      {list.map((p, i) => (
        <PageCard
          key={p.id}
          doc={p}
          index={i}
          count={list.length}
          active={i === pageIndex}
          near={near.has(p.id)}
          scale={scale}
          bridge={bridge}
          onActivate={activate}
        />
      ))}
    </div>
  );
}
