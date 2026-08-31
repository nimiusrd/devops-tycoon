import { afterEach, describe, expect, it, vi } from 'vitest';

const react = vi.hoisted(() => ({
  contextValue: null as { width: 'wide' | 'narrow'; height: 'normal' | 'short' } | null,
  effectCleanup: undefined as (() => void) | undefined,
  runEffects: true,
  stateValue: undefined as unknown,
  stateUpdates: [] as unknown[],
}));

vi.mock('react', () => ({
  createContext: vi.fn((value: unknown) => ({ defaultValue: value })),
  useContext: vi.fn(() => react.contextValue),
  useEffect: vi.fn((effect: () => void | (() => void)) => {
    if (!react.runEffects) return;
    react.effectCleanup = effect() ?? undefined;
  }),
  useState: vi.fn((initializer: () => unknown) => {
    react.stateValue = initializer();
    const setState = (update: unknown) => {
      react.stateUpdates.push(update);
      if (typeof update === 'function') {
        react.stateValue = (update as (current: unknown) => unknown)(react.stateValue);
      } else {
        react.stateValue = update;
      }
    };
    return [react.stateValue, setState];
  }),
}));

import { useResponsiveMode, useViewportResponsiveMode } from '../../../src/ui/responsiveModeCore';

describe('responsive mode hooks', () => {
  afterEach(() => {
    react.contextValue = null;
    react.effectCleanup = undefined;
    react.runEffects = true;
    react.stateValue = undefined;
    react.stateUpdates = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('window が無い初期化では wide/normal を返す', () => {
    vi.stubGlobal('window', undefined);
    react.runEffects = false;

    expect(useViewportResponsiveMode()).toEqual({ width: 'wide', height: 'normal' });
  });

  it('viewport を初期値にし、モードが変わる resize だけ状態を更新して解除する', () => {
    let resize: (() => void) | undefined;
    const addEventListener = vi.fn((_event: string, listener: () => void) => {
      resize = listener;
    });
    const removeEventListener = vi.fn();
    const viewport = { innerWidth: 900, innerHeight: 800, addEventListener, removeEventListener };
    vi.stubGlobal('window', viewport);

    expect(useViewportResponsiveMode()).toEqual({ width: 'wide', height: 'normal' });
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(react.stateUpdates).toHaveLength(1);
    expect(react.stateValue).toEqual({ width: 'wide', height: 'normal' });

    viewport.innerWidth = 700;
    viewport.innerHeight = 600;
    resize?.();
    expect(react.stateValue).toEqual({ width: 'narrow', height: 'short' });

    react.effectCleanup?.();
    expect(removeEventListener).toHaveBeenCalledWith('resize', resize);
  });

  it('Provider 外は例外にし、Context の値はそのまま返す', () => {
    expect(() => useResponsiveMode()).toThrow(
      'useResponsiveMode must be used within ResponsiveModeProvider',
    );

    react.contextValue = { width: 'narrow', height: 'short' };
    expect(useResponsiveMode()).toBe(react.contextValue);
  });
});
