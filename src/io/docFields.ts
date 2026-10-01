// Páginas del proyecto abierto, para los campos dinámicos del texto ({{pagina}},
// {{total}}). Import dinámico: así la exportación no arrastra el store al cargarse.
export async function pagesForFields(): Promise<{ id: string }[] | undefined> {
  try {
    const m = await import('../editor/state/store');
    return m.useEditor.getState().pages;
  } catch {
    return undefined;
  }
}
