/**
 * Pixi v8 の共有プール群を複数 Application 構成でも安全にするガード。
 *
 * `TexturePool` や Batcher の `batchPool` はモジュールシングルトンだが、Pixi は
 * どの renderer の `destroy()` でも `GlobalResourceRegistry.release()` を呼び、
 * 共有プールを全て `clear()` する。本アプリは画面ごとに Application を作る
 * （全社マップ / 部署ビュー / スプリント盤面。React StrictMode のゴースト
 * マウントも含む）ため、ある画面の破棄が生存中の別画面のプールを消して落ちる:
 *
 * - `TexturePool`: 貸出中だった CanvasText テクスチャの `returnTexture()` が
 *   `_texturePool[key].push` の undefined 参照で落ちる（破棄時だけでなく
 *   `_updateGpuText` 経由の通常レンダリング中も起きる）。
 * - `batchPool`（Batcher）: プール配列は貸出中 Batch への参照も保持しており、
 *   clear がそれらを `destroy()`（textures=null 化）する。生存 renderer が
 *   返却→再取得すると `batch.textures.clear()` の null 参照で落ちる。
 *
 * 対策は二段:
 * 1. `retainPixiApp()` / `releasePixiApp()` で生存 Application を数え、
 *    生存中が残る間は `GlobalResourceRegistry.release()` を抑止する
 *    （共有プールの purge は最後の 1 枚が消えるときだけ）。
 * 2. `returnTexture` を包み、clear 済みで返却先が無いテクスチャは
 *    プールへ戻さず破棄する（孤児化によるリークも防ぐ）。
 */
import { GlobalResourceRegistry, TexturePool, type Texture } from 'pixi.js';

let installed = false;

/** ガード対象の生存 Application 数（retain/release で増減）。 */
let liveApps = 0;

/**
 * Application を生存として数える。`init()` 成功後に呼ぶ。
 * dispose 時は `releasePixiApp()` を `app.destroy()` より前に呼ぶこと
 * （自分を除いた生存数で release 可否を判定させる）。
 */
export function retainPixiApp(): void {
  liveApps += 1;
}

export function releasePixiApp(): void {
  liveApps = Math.max(0, liveApps - 1);
}

/** 冪等。ブラウザで Pixi レンダラを init する前に一度呼ぶ。 */
export function ensureTexturePoolGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 生存 Application が残っている間は共有プールの purge を抑止する。
  const registry = GlobalResourceRegistry as unknown as { release(): void };
  const originalRelease = registry.release.bind(GlobalResourceRegistry);
  registry.release = () => {
    if (liveApps > 0) return;
    originalRelease();
  };

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
