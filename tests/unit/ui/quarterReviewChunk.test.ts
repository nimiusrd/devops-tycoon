import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadQuarterReviewScreenModule,
  resetQuarterReviewScreenChunk,
  waitForQuarterReviewScreenModule,
} from '../../../src/ui/quarterReviewChunk';

describe('quarterReviewChunk', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetQuarterReviewScreenChunk();
    vi.stubGlobal('window', {
      __blockQuarterReviewChunk: undefined,
      __delayQuarterReviewChunkMs: undefined,
      __quarterReviewChunkLoadTimeoutMs: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetQuarterReviewScreenChunk();
  });

  it('chunk 取得に成功すれば ready を返す', async () => {
    const promise = waitForQuarterReviewScreenModule({ cancelled: false });
    await expect(promise).resolves.toBe('ready');
    await expect(loadQuarterReviewScreenModule()).resolves.toHaveProperty('QuarterReviewScreen');
  });

  it('ハングするとタイムアウトで failed を返す', async () => {
    (window as Window).__blockQuarterReviewChunk = { hang: true };
    (window as Window).__quarterReviewChunkLoadTimeoutMs = 500;
    const promise = waitForQuarterReviewScreenModule({ cancelled: false });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe('failed');
  });

  it('リセット後は新しい import を試せる', async () => {
    (window as Window).__blockQuarterReviewChunk = { hang: true };
    (window as Window).__quarterReviewChunkLoadTimeoutMs = 200;
    const failed = waitForQuarterReviewScreenModule({ cancelled: false });
    await vi.advanceTimersByTimeAsync(200);
    await expect(failed).resolves.toBe('failed');
    delete (window as Window).__blockQuarterReviewChunk;
    resetQuarterReviewScreenChunk();
    const retry = waitForQuarterReviewScreenModule({ cancelled: false });
    await expect(retry).resolves.toBe('ready');
  });
});
