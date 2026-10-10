/**
 * Pixi v8 の共有プール群を複数 Application 構成でも安全にするガード。
 *
 * `TexturePool` や Batcher の `batchPool` はモジュールシングルトンだが、Pixi は
 * どの renderer の `destroy()` でも `GlobalResourceRegistry.release()` を呼び、
 * 共有プールを全て `clear()` する。本アプリは画面ごとに Application を作る
 * （全社マップ / 部署ビュー / スプリント盤面。React StrictMode のゴースト
 * マウントも含む）ため、ある画面の破棄が生存中の別画面のプールを消して落ちる。
 *
 * `batchPool`（Batcher）はプール配列に貸出中 Batch への参照も保持しており、
 * clear がそれらを `destroy()`（textures=null 化）する。生存 renderer が
 * 返却→再取得すると `batch.textures.clear()` の null 参照で落ちる。
 *
 * `TexturePool` は Pixi 8.21 以降、clear 済みバケットへの `returnTexture()` を
 * 自分で破棄して受け止める。8.19 までの `_texturePool` / `_poolKeyHash` を読む
 * 包みは 8.22 でフィールドが消え、初期化中の返却が `undefined` 参照で落ちる。
 *
 * 対策は `retainPixiApp()` / `releasePixiApp()` で生存 Application を数え、
 * 生存中が残る間は `GlobalResourceRegistry.release()` を抑止する
 * （共有プールの purge は最後の 1 枚が消えるときだけ）。
 */
import { GlobalResourceRegistry } from 'pixi.js';

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
}
