import type { Texture } from 'pixi.js';
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
      _poolKeyHash: {} as Record<number, string | undefined>,
      returnTexture,
    },
  };
});

vi.mock('pixi.js', () => ({
  GlobalResourceRegistry: pixi.registry,
  TexturePool: pixi.pool,
}));

function texture(uid: number) {
  const destroy = vi.fn();
  return { value: { uid, destroy } as unknown as Texture, destroy };
}

describe('Pixi の共有プール保護', () => {
  beforeEach(() => {
    vi.resetModules();
    pixi.registry.release = pixi.release.mockReset();
    pixi.pool.returnTexture = pixi.returnTexture.mockReset();
    pixi.pool._texturePool = {};
    pixi.pool._poolKeyHash = {};
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('生存する Application が残る間は共有資源を保持し、最後の破棄で解放する', async () => {
    const { ensureTexturePoolGuard, retainPixiApp, releasePixiApp } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    const sharedTextures = [texture(1).value];
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

  it.each([undefined, false, true])(
    '返却先が存在するテクスチャは resetStyle=%s を保って通常のプールへ返す',
    async (resetStyle) => {
      const { ensureTexturePoolGuard } =
        await import('../../../src/render/adapters/pixiTexturePoolGuard');
      const returned = texture(7);
      pixi.pool._poolKeyHash[7] = 'text';
      pixi.pool._texturePool.text = [];
      ensureTexturePoolGuard();

      pixi.pool.returnTexture(returned.value, resetStyle);

      expect(pixi.returnTexture).toHaveBeenCalledExactlyOnceWith(returned.value, resetStyle);
      expect(pixi.returnTexture.mock.contexts[0]).toBe(pixi.pool);
      expect(returned.destroy).not.toHaveBeenCalled();
    },
  );

  it.each(['key-missing', 'pool-cleared'] as const)(
    '%s で返却先が失われたテクスチャは source を含めて破棄する',
    async (condition) => {
      const { ensureTexturePoolGuard } =
        await import('../../../src/render/adapters/pixiTexturePoolGuard');
      const orphan = texture(8);
      if (condition === 'pool-cleared') pixi.pool._poolKeyHash[8] = 'cleared';
      ensureTexturePoolGuard();

      expect(() => pixi.pool.returnTexture(orphan.value)).not.toThrow();

      expect(orphan.destroy).toHaveBeenCalledExactlyOnceWith(true);
      expect(pixi.returnTexture).not.toHaveBeenCalled();
    },
  );

  it('複数画面から繰り返し導入しても、同じガードを一度だけ適用する', async () => {
    const { ensureTexturePoolGuard } =
      await import('../../../src/render/adapters/pixiTexturePoolGuard');
    ensureTexturePoolGuard();
    const guardedRelease = pixi.registry.release;
    const guardedReturn = pixi.pool.returnTexture;

    ensureTexturePoolGuard();
    ensureTexturePoolGuard();

    expect(pixi.registry.release).toBe(guardedRelease);
    expect(pixi.pool.returnTexture).toBe(guardedReturn);
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
    expect(pixi.pool.returnTexture).not.toBe(pixi.returnTexture);
  });
});
