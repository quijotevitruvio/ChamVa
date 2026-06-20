// Avisos tipo "toast" — reemplazo de alert() nativo.
// toast(mensaje, tipo) se puede llamar desde cualquier sitio; <Toaster/> los pinta.
import { useEffect, useState } from 'react';

type ToastType = 'info' | 'error' | 'success';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const subs = new Set<(t: ToastItem) => void>();
let seq = 0;

export function toast(message: string, type: ToastType = 'info') {
  const item = { id: ++seq, message, type };
  subs.forEach((f) => f(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const fn = (t: ToastItem) => {
      setItems((p) => [...p, t]);
      setTimeout(
        () => setItems((p) => p.filter((x) => x.id !== t.id)),
        t.type === 'error' ? 6000 : 3500,
      );
    };
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);

  return (
    <div className="toaster">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.type}`}
          onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}
        >
          {t.type === 'error' ? '⚠️ ' : t.type === 'success' ? '✅ ' : ''}
          {t.message}
        </div>
      ))}
    </div>
  );
}
