import type { Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assets = vi.hoisted(() => ({
  load: vi.fn<(url: string) => Promise<Texture>>(),
}));

vi.mock('pixi.js', () => ({ Assets: assets }));

function texture(label: string): Texture {
  return { label } as Texture;
}

function pendingTexture() {
  let resolve!: (value: Texture) => void;
  const promise = new Promise<Texture>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('共有ゲームアセットテクスチャ', () => {
  beforeEach(() => {
    vi.resetModules();
    assets.load.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('並行した同一 ID の要求と読み込み完了後の要求で、同じ Promise とテクスチャを共有する', async () => {
    const { loadGameAssetTexture } = await import('../../../src/render/adapters/gameAssetTextures');
    const pending = pendingTexture();
    assets.load.mockReturnValue(pending.promise);

    const first = loadGameAssetTexture('ci-bot');
    const concurrent = loadGameAssetTexture('ci-bot');
    expect(concurrent).toBe(first);
    expect(assets.load).toHaveBeenCalledExactlyOnceWith('/assets/game/ci-bot.svg');

    const loaded = texture('ci-bot');
    pending.resolve(loaded);
    await expect(first).resolves.toBe(loaded);
    await expect(concurrent).resolves.toBe(loaded);
    expect(loadGameAssetTexture('ci-bot')).toBe(first);
    expect(assets.load).toHaveBeenCalledTimes(1);
  });

  it('読み込み失敗を null へ変換し、同じ ID の再要求では再試行や警告を繰り返さない', async () => {
    const { loadGameAssetTexture } = await import('../../../src/render/adapters/gameAssetTextures');
    const error = new Error('SVG を取得できません');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assets.load.mockRejectedValue(error);

    const first = loadGameAssetTexture('incident-flame');
    const concurrent = loadGameAssetTexture('incident-flame');
    await expect(first).resolves.toBeNull();
    await expect(concurrent).resolves.toBeNull();
    const later = loadGameAssetTexture('incident-flame');
    expect(later).toBe(first);
    await expect(later).resolves.toBeNull();
    expect(assets.load).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'Game asset failed to load: incident-flame',
      error,
    );

    const loaded = texture('ci-bot');
    assets.load.mockResolvedValue(loaded);
    await expect(loadGameAssetTexture('ci-bot')).resolves.toBe(loaded);
  });

  it('preload は重複を読み直さず、完了順によらず入力順で結果を返す', async () => {
    const { loadGameAssetTexture, preloadGameAssetTextures } =
      await import('../../../src/render/adapters/gameAssetTextures');
    const first = pendingTexture();
    const second = pendingTexture();
    assets.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const alreadyLoading = loadGameAssetTexture('ci-bot');
    const preload = preloadGameAssetTextures(['ci-bot', 'deploy-crate', 'ci-bot']);
    const completed = vi.fn();
    void preload.then(completed);
    expect(assets.load.mock.calls).toEqual([
      ['/assets/game/ci-bot.svg'],
      ['/assets/game/deploy-crate.svg'],
    ]);

    const bot = texture('ci-bot');
    const crate = texture('deploy-crate');
    second.resolve(crate);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    first.resolve(bot);

    await expect(alreadyLoading).resolves.toBe(bot);
    const result = await preload;
    expect(result).toEqual([bot, crate, bot]);
    expect(result[0]).toBe(result[2]);
  });

  it('preload は一部失敗でも全体を reject せず、失敗位置だけ null を返す', async () => {
    const { preloadGameAssetTextures } =
      await import('../../../src/render/adapters/gameAssetTextures');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bot = texture('ci-bot');
    assets.load.mockResolvedValueOnce(bot).mockRejectedValueOnce(new Error('missing'));

    await expect(preloadGameAssetTextures(['ci-bot', 'incident-flame', 'ci-bot'])).resolves.toEqual(
      [bot, null, bot],
    );
    expect(assets.load).toHaveBeenCalledTimes(2);
  });

  it('空の preload は読み込みを開始せず空配列を返す', async () => {
    const { preloadGameAssetTextures } =
      await import('../../../src/render/adapters/gameAssetTextures');

    await expect(preloadGameAssetTextures([])).resolves.toEqual([]);
    expect(assets.load).not.toHaveBeenCalled();
  });
});
