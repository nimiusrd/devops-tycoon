/** GPU初期化の待機・失敗を共有し、盤面が見えない間の自動進行を止める。 */
const pending = new Set<symbol>();
const listeners = new Set<() => void>();
let failed = false;
let retryRequested = false;
export type WebglStatus = 'ready' | 'loading' | 'failed';

export function getWebglStatus(): WebglStatus {
  return failed ? 'failed' : retryRequested || pending.size > 0 ? 'loading' : 'ready';
}

export function subscribeWebglStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  for (const listener of listeners) listener();
}

export function beginWebglLoading(): () => void {
  const token = Symbol();
  pending.add(token);
  retryRequested = false;
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Suspenseのfallback解放とCanvasのlayout effect登録を同じコミット内で引き継ぐ。
    // 解放だけが先に観測されて一瞬readyになることを防ぐ。
    queueMicrotask(() => {
      if (pending.delete(token)) publish();
    });
  };
}

export function markWebglFailed(): void {
  failed = true;
  publish();
}

export function retryWebgl(): void {
  if (!failed) return;
  failed = false;
  // 再マウントが始まる前から待機し、最初の描画側の待機トークンへ引き継ぐ。
  retryRequested = true;
  publish();
}
