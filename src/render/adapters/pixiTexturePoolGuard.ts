/**
 * Pixi v8 の共有 `TexturePool` を複数 Application 構成でも安全にするガード。
 *
 * `TexturePool` はモジュールシングルトンだが、Pixi はどの renderer の
 * `destroy()` でも共有プールを `clear()` する（`WebGLRenderer.destroy` →
 * destroyables release）。本アプリは画面ごとに Application を作る（全社マップ /
 * 部署ビュー。React StrictMode のゴーストマウントも含む）ため、ある画面の破棄が
 * 生存中の別画面のプールを消し、貸出中だった CanvasText テクスチャの
 * `returnTexture()` が `_texturePool[key].push` の undefined 参照で落ちる
 * （破棄時だけでなく `_updateGpuText` 経由の通常レンダリング中も起きる）。
 *
 * ここでは `returnTexture` を包み、clear 済みで返却先が無いテクスチャは
 * プールへ戻さず破棄する（孤児化によるリークも防ぐ）。挙動は「clear 時に
 * プール内テクスチャが破棄される」Pixi 本来の意味論と一致する。
 */
import { TexturePool, type Texture } from 'pixi.js';

let installed = false;

/** 冪等。ブラウザで Pixi レンダラを init する前に一度呼ぶ。 */
export function ensureTexturePoolGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const pool = TexturePool as unknown as {
    _texturePool: Record<string, unknown[] | undefined>;
    _poolKeyHash: Record<number, string | undefined>;
    returnTexture(texture: Texture, resetStyle?: boolean): void;
  };
  const originalReturn = pool.returnTexture.bind(TexturePool);
  pool.returnTexture = (texture, resetStyle) => {
    const key = pool._poolKeyHash[texture.uid];
    if (key === undefined || pool._texturePool[key] === undefined) {
      texture.destroy(true);
      return;
    }
    originalReturn(texture, resetStyle);
  };
}
