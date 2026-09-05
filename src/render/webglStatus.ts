/** GPU初期化の待機・失敗を共有し、盤面が見えない間の自動進行を止める。 */
const pending = new Set<symbol>();
const listeners = new Set<() => void>();
let failed = false;
export type WebglStatus = 'ready' | 'loading' | 'failed';

export function getWebglStatus(): WebglStatus {
  return failed ? 'failed' : pending.size > 0 ? 'loading' : 'ready';
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
  publish();
  return () => {
    if (pending.delete(token)) publish();
  };
}

export function markWebglFailed(): void {
  failed = true;
  publish();
}

export function retryWebgl(): void {
  failed = false;
  publish();
}
