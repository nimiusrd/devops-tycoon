/**
 * 複数タブの保存競合（RI-144）。
 *
 * 世代が一致したときだけ端末へ書く。古いタブの記録は上書きも削除もしない。
 */

export class TabConflictError extends Error {
  constructor() {
    super('another tab updated the saved record');
    this.name = 'TabConflictError';
  }
}

export function isTabConflict(error: unknown): error is TabConflictError {
  return error instanceof TabConflictError;
}

/** 書けたら ok。別タブの記録なら current を返し、呼び出し側はそれを維持する。 */
export type DurableWriteResult<T> =
  | { ok: true; runGeneration?: number }
  | { ok: false; current: T | null };

export function generationValue(stored: unknown): number {
  return typeof stored === 'number' && Number.isFinite(stored) && stored >= 0
    ? Math.floor(stored)
    : 0;
}
