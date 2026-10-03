import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSaveStatus,
  markError,
  markPending,
  markSaved,
  markSaving,
  resetSaveStatus,
  subscribeSaveStatus,
} from './saveStatus';

beforeEach(() => resetSaveStatus());

describe('saveStatus', () => {
  it('pending → saving → saved y recuerda cuándo', () => {
    expect(getSaveStatus().state).toBe('idle');
    markPending();
    expect(getSaveStatus().state).toBe('pending');
    markSaving();
    expect(getSaveStatus().state).toBe('saving');
    markSaved(1234);
    expect(getSaveStatus()).toEqual({ state: 'saved', savedAt: 1234 });
  });

  it('error conserva la última hora guardada', () => {
    markSaved(50);
    markPending();
    markSaving();
    markError();
    expect(getSaveStatus()).toEqual({ state: 'error', savedAt: 50 });
  });

  it('avisa a los suscriptores solo cuando cambia', () => {
    const fn = vi.fn();
    const off = subscribeSaveStatus(fn);
    markPending();
    markPending();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    markSaving();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
