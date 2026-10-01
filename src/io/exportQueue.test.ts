import { describe, expect, it } from 'vitest';
import { ExportQueue } from './exportQueue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ExportQueue', () => {
  it('ejecuta en orden, de uno en uno', async () => {
    const q = new ExportQueue();
    const log: string[] = [];
    const mk = (n: string) => async () => {
      log.push('inicio ' + n);
      await tick();
      log.push('fin ' + n);
    };
    const a = q.enqueue('A', mk('A'));
    const b = q.enqueue('B', mk('B'));
    expect(await Promise.all([a.done, b.done])).toEqual(['done', 'done']);
    expect(log).toEqual(['inicio A', 'fin A', 'inicio B', 'fin B']);
  });
  it('cancelar uno en espera: no se ejecuta', async () => {
    const q = new ExportQueue();
    let ranB = false;
    const a = q.enqueue('A', async () => {
      await tick();
    });
    const b = q.enqueue('B', async () => {
      ranB = true;
    });
    q.cancel(b.id);
    expect(await b.done).toBe('cancelled');
    expect(await a.done).toBe('done');
    expect(ranB).toBe(false);
  });
  it('cancelar el que corre: avisa por signal y por onCancel', async () => {
    const q = new ExportQueue();
    let hook = 0;
    const a = q.enqueue('A', async (ctx) => {
      ctx.onCancel(() => hook++);
      while (!ctx.isCancelled()) await tick();
    });
    await tick();
    expect(q.getSnapshot()[0].status).toBe('running');
    q.cancel(a.id);
    expect(await a.done).toBe('cancelled');
    expect(hook).toBe(1);
  });
  it('un error no detiene la cola y queda anotado', async () => {
    const q = new ExportQueue();
    const a = q.enqueue('A', async () => {
      throw new Error('boom');
    });
    const b = q.enqueue('B', async () => {});
    expect(await a.done).toBe('error');
    expect(await b.done).toBe('done');
    expect(q.getSnapshot()[0].error).toBe('boom');
  });
  it('progreso, suscripción y limpieza', async () => {
    const q = new ExportQueue();
    let n = 0;
    q.subscribe(() => n++);
    const a = q.enqueue('A', async (ctx) => {
      ctx.progress(1, 4, 'uno');
      expect(q.getSnapshot()[0]).toMatchObject({ done: 1, total: 4, detail: 'uno' });
    });
    await a.done;
    expect(n).toBeGreaterThan(2);
    q.clearFinished();
    expect(q.getSnapshot()).toEqual([]);
  });
});
