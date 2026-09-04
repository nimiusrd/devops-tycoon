import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PixiRendererChoice } from '../../../src/ui/usePixiRenderer';

interface HookInstance {
  server: boolean;
  notifications: number;
  unsubscribe?: () => void;
  callback?: () => void;
}

const hooks = vi.hoisted(() => ({ active: undefined as HookInstance | undefined }));

// React 境界の購読・解除と SSR snapshot だけを再現し、ストアと URL 選択は本体を使う。
vi.mock('react', () => ({
  useSyncExternalStore(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => boolean,
    getServerSnapshot: () => boolean,
  ) {
    const instance = hooks.active!;
    if (instance.server) return getServerSnapshot();
    instance.unsubscribe ??= subscribe(() => {
      instance.notifications += 1;
    });
    return getSnapshot();
  },
  useCallback(callback: () => void) {
    const instance = hooks.active!;
    instance.callback ??= callback;
    return instance.callback;
  },
}));

const mounted: HookInstance[] = [];

function mountHook(useHook: () => PixiRendererChoice, server = false) {
  const instance: HookInstance = { server, notifications: 0 };
  mounted.push(instance);
  const render = () => {
    hooks.active = instance;
    try {
      return useHook();
    } finally {
      hooks.active = undefined;
    }
  };
  return { instance, render, initial: render() };
}

describe('usePixiRenderer', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { search: '' } });
  });

  afterEach(() => {
    for (const instance of mounted.splice(0)) instance.unsubscribe?.();
    hooks.active = undefined;
    vi.unstubAllGlobals();
  });

  it.each([
    ['', true],
    ['?renderer=pixi', true],
    ['?renderer=dom', false],
    ['?seed=fixed&renderer=dom', false],
    ['?renderer=unknown', true],
  ])('URL %s では Pixi の使用を %s にする', async (search, expected) => {
    vi.stubGlobal('window', { location: { search } });
    const { usePixiRenderer } = await import('../../../src/ui/usePixiRenderer');

    const screen = mountHook(usePixiRenderer);

    expect(screen.initial.usePixi).toBe(expected);
    expect(screen.instance.notifications).toBe(0);
  });

  it('1 画面の初期化失敗を全購読者へ通知し、解除済み画面を除いて以降も DOM を使う', async () => {
    const { usePixiRenderer } = await import('../../../src/ui/usePixiRenderer');
    const board = mountHook(usePixiRenderer);
    const company = mountHook(usePixiRenderer);
    const disposed = mountHook(usePixiRenderer);
    expect(board.initial.usePixi).toBe(true);
    expect(company.initial.usePixi).toBe(true);
    disposed.instance.unsubscribe?.();

    board.initial.onWebglError();

    expect(board.instance.notifications).toBe(1);
    expect(company.instance.notifications).toBe(1);
    expect(disposed.instance.notifications).toBe(0);
    expect(board.render().usePixi).toBe(false);
    expect(company.render().usePixi).toBe(false);
    expect(mountHook(usePixiRenderer).initial.usePixi).toBe(false);

    company.initial.onWebglError();
    board.initial.onWebglError();
    expect(board.instance.notifications).toBe(1);
    expect(company.instance.notifications).toBe(1);
    expect(disposed.instance.notifications).toBe(0);
  });

  it('window が無い環境では Pixi を選ばず、SSR は購読を開始しない', async () => {
    vi.stubGlobal('window', undefined);
    const { usePixiRenderer } = await import('../../../src/ui/usePixiRenderer');

    const server = mountHook(usePixiRenderer, true);

    expect(server.initial.usePixi).toBe(false);
    expect(server.instance.unsubscribe).toBeUndefined();
    expect(server.instance.notifications).toBe(0);
  });

  it('hydration の server snapshot は DOM を使い、その後のブラウザ描画は Pixi を選べる', async () => {
    const { usePixiRenderer } = await import('../../../src/ui/usePixiRenderer');
    const screen = mountHook(usePixiRenderer, true);
    expect(screen.initial.usePixi).toBe(false);

    screen.instance.server = false;

    expect(screen.render().usePixi).toBe(true);
    expect(screen.instance.unsubscribe).toBeTypeOf('function');
  });
});
