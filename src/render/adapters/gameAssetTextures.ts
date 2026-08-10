/** Pixi向け共有SVGテクスチャローダー。アプリ寿命中は共有し、rendererごとに破棄しない。 */
import { Assets, type Texture } from 'pixi.js';
import type { GameAssetId } from '../../data/assets';
import { getGameAssetUrl } from '../../data/assets';

const texturePromises = new Map<GameAssetId, Promise<Texture | null>>();

/** 取得失敗はnullに変換し、呼び出し側が既存ベクターへフォールバックできるようにする。 */
export function loadGameAssetTexture(id: GameAssetId): Promise<Texture | null> {
  const existing = texturePromises.get(id);
  if (existing) return existing;

  const promise = Assets.load<Texture>(getGameAssetUrl(id)).catch((error: unknown) => {
    console.warn(`Game asset failed to load: ${id}`, error);
    return null;
  });
  texturePromises.set(id, promise);
  return promise;
}

export function preloadGameAssetTextures(
  ids: readonly GameAssetId[],
): Promise<readonly (Texture | null)[]> {
  return Promise.all(ids.map((id) => loadGameAssetTexture(id)));
}
