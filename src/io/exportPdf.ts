import { jsPDF } from 'jspdf';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';

// Crea un PDF: cada página del diseño es una página del PDF.
export async function exportPagesToPdf(pages: Doc[]): Promise<Blob> {
  let pdf: jsPDF | null = null;
  for (const page of pages) {
    const w = page.width;
    const h = page.height;
    const orientation = w >= h ? 'landscape' : 'portrait';
    // PDF no maneja transparencia → fondo blanco.
    const canvas = await renderDocToCanvas(page, 1, '#ffffff');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
    } else {
      pdf.addPage([w, h], orientation);
    }
    pdf.addImage(dataUrl, 'JPEG', 0, 0, w, h);
  }
  return (pdf as jsPDF).output('blob');
}
