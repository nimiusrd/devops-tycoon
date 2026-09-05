import { describe, expect, it, vi } from 'vitest';

describe('WebGL準備と再試行', () => {
  it('全Canvasが準備できるまで待ち、二重解放でも別の待機を消さない', async () => {
    vi.resetModules();
    const state = await import('../../../src/render/webglStatus');
    const listener = vi.fn();
    const unsubscribe = state.subscribeWebglStatus(listener);
    const first = state.beginWebglLoading();
    const second = state.beginWebglLoading();
    expect(state.getWebglStatus()).toBe('loading');
    first();
    first();
    expect(state.getWebglStatus()).toBe('loading');
    second();
    expect(state.getWebglStatus()).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    state.markWebglFailed();
    expect(listener).toHaveBeenCalledTimes(4);
  });
  it('失敗はCanvasの解放後も残り、再試行してから再び描画の準備を待つ', async () => {
    vi.resetModules();
    const state = await import('../../../src/render/webglStatus');
    const finish = state.beginWebglLoading();
    state.markWebglFailed();
    finish();
    expect(state.getWebglStatus()).toBe('failed');
    state.retryWebgl();
    const retried = state.beginWebglLoading();
    expect(state.getWebglStatus()).toBe('loading');
    retried();
    expect(state.getWebglStatus()).toBe('ready');
  });
});
