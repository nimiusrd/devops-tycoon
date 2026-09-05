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
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('loading');
    second();
    await Promise.resolve();
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
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('failed');
    state.retryWebgl();
    expect(state.getWebglStatus()).toBe('loading');
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('loading');
    const retried = state.beginWebglLoading();
    expect(state.getWebglStatus()).toBe('loading');
    retried();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('ready');
  });

  it('lazy fallbackから複数Canvasへの交代中はreadyを通知せず、全初期化完了を待つ', async () => {
    vi.resetModules();
    const state = await import('../../../src/render/webglStatus');
    const observed: string[] = [];
    state.subscribeWebglStatus(() => observed.push(state.getWebglStatus()));
    const fallback = state.beginWebglLoading();
    fallback();
    expect(state.getWebglStatus()).toBe('loading');
    const first = state.beginWebglLoading();
    const second = state.beginWebglLoading();
    await Promise.resolve();
    first();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('loading');
    expect(observed).not.toContain('ready');
    second();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('ready');
    expect(observed.filter((status) => status === 'ready')).toHaveLength(1);
  });

  it('再失敗後の古い解放が新しい待機を解除せず、離脱後は待機が残らない', async () => {
    vi.resetModules();
    const state = await import('../../../src/render/webglStatus');
    const old = state.beginWebglLoading();
    state.markWebglFailed();
    state.retryWebgl();
    const current = state.beginWebglLoading();
    old();
    old();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('loading');
    state.markWebglFailed();
    current();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('failed');
    state.retryWebgl();
    const next = state.beginWebglLoading();
    next();
    await Promise.resolve();
    expect(state.getWebglStatus()).toBe('ready');
    state.retryWebgl();
    expect(state.getWebglStatus()).toBe('ready');
  });
});
