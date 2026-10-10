import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pixi = vi.hoisted(() => {
  const release = vi.fn();
  const returnTexture = vi.fn();
  return {
    release,
    returnTexture,
    registry: { release },
    pool: {
      _texturePool: {} as Record<string, unknown[] | undefined>,
      returnTexture,
    },
  };
});

vi.mock('pixi.js', () => ({
  GlobalResourceRegistry: pixi.registry,
  TexturePool: pixi.pool,
}));

describe('Pixi の共有プール保護', () => {
  beforeEach(() => {
    vi.resetModules();
    pixi.registry.release = pixi.release.mockReset();
    pixi.pool.returnTexture = pixi.returnTexture.mockReset();
    pixi.pool._texturePool = {};
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('生存する Application が残る間は共有資源を保持し、最後の破棄で解放する', async () => {
    const { ensureTexturePoolGuard, retainPixiApp, releasePixiApp } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    const sharedTextures = [{ uid: 1 }];
    pixi.pool._texturePool.text = sharedTextures;
    pixi.release.mockImplementation(() => {
      pixi.pool._texturePool = {};
    });
    ensureTexturePoolGuard();
    retainPixiApp();
    retainPixiApp();
    retainPixiApp();

    for (let remaining = 2; remaining > 0; remaining -= 1) {
      releasePixiApp();
      pixi.registry.release();
      expect(pixi.pool._texturePool.text).toBe(sharedTextures);
      expect(pixi.release).not.toHaveBeenCalled();
    }

    releasePixiApp();
    pixi.registry.release();
    expect(pixi.pool._texturePool).toEqual({});
    expect(pixi.release).toHaveBeenCalledTimes(1);
    expect(pixi.release.mock.contexts[0]).toBe(pixi.registry);
  });

  it('余分な release があっても、その後に開始した Application の資源を解放しない', async () => {
    const { ensureTexturePoolGuard, retainPixiApp, releasePixiApp } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    ensureTexturePoolGuard();
    releasePixiApp();
    releasePixiApp();
    retainPixiApp();
    pixi.registry.release();
    expect(pixi.release).not.toHaveBeenCalled();

    releasePixiApp();
    pixi.registry.release();
    expect(pixi.release).toHaveBeenCalledTimes(1);
  });

  it('Pixi 8.21 以降の returnTexture は包まず、共有資源の解放だけを抑止する', async () => {
    const { ensureTexturePoolGuard } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    ensureTexturePoolGuard();

    expect(pixi.pool.returnTexture).toBe(pixi.returnTexture);
    pixi.pool.returnTexture({ uid: 10 }, true);
    expect(pixi.returnTexture).toHaveBeenCalledExactlyOnceWith({ uid: 10 }, true);
  });

  it('複数画面から繰り返し導入しても、同じガードを一度だけ適用する', async () => {
    const { ensureTexturePoolGuard } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    ensureTexturePoolGuard();
    const guardedRelease = pixi.registry.release;

    ensureTexturePoolGuard();
    ensureTexturePoolGuard();

    expect(pixi.registry.release).toBe(guardedRelease);
    expect(pixi.pool.returnTexture).toBe(pixi.returnTexture);
    pixi.registry.release();
    expect(pixi.release).toHaveBeenCalledTimes(1);
  });

  it('SSR では Pixi を変更せず、後からブラウザで導入できる', async () => {
    vi.stubGlobal('window', undefined);
    const { ensureTexturePoolGuard } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');

    ensureTexturePoolGuard();
    expect(pixi.registry.release).toBe(pixi.release);
    expect(pixi.pool.returnTexture).toBe(pixi.returnTexture);

    vi.stubGlobal('window', {});
    ensureTexturePoolGuard();
    expect(pixi.registry.release).not.toBe(pixi.release);
    expect(pixi.pool.returnTexture).toBe(pixi.returnTexture);
  });
});
