export const QUARTER_REVIEW_LOAD_SLOW_MS = 150;
export const QUARTER_REVIEW_LOAD_TIMEOUT_MS = 10_000;

declare global {
  interface Window {
    /** E2E / 手動検証: chunk が解決しない・失敗する挙動を固定する。 */
    __blockQuarterReviewChunk?: { hang?: boolean };
    /** テスト専用: chunk 解決を遅らせる。 */
    __delayQuarterReviewChunkMs?: number;
    /** テスト専用: 読み込み待ちの上限（ミリ秒）。 */
    __quarterReviewChunkLoadTimeoutMs?: number;
  }
}

let modulePromise: Promise<typeof import('./QuarterReviewScreen')> | null = null;

function loadTimeoutMs(): number {
  const override =
    typeof window !== 'undefined' ? window.__quarterReviewChunkLoadTimeoutMs : undefined;
  return typeof override === 'number' && Number.isFinite(override) && override > 0
    ? override
    : QUARTER_REVIEW_LOAD_TIMEOUT_MS;
}

function importQuarterReviewScreen(): Promise<typeof import('./QuarterReviewScreen')> {
  const block = typeof window !== 'undefined' ? window.__blockQuarterReviewChunk : undefined;
  if (block?.hang) return new Promise(() => {});
  const delayMs = typeof window !== 'undefined' ? window.__delayQuarterReviewChunkMs : undefined;
  const load = () => import('./QuarterReviewScreen');
  if (typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs > 0) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        load().then(resolve, reject);
      }, delayMs);
    });
  }
  return load();
}

/** 失敗後の再試行で前回の reject を捨てる。 */
export function resetQuarterReviewScreenChunk(): void {
  modulePromise = null;
}

export function prefetchQuarterReviewScreen(): void {
  void loadQuarterReviewScreenModule().catch(() => {});
}

export function loadQuarterReviewScreenModule(): Promise<typeof import('./QuarterReviewScreen')> {
  if (!modulePromise) {
    modulePromise = importQuarterReviewScreen().catch((error) => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

export function waitForQuarterReviewScreenModule(signal: {
  cancelled: boolean;
}): Promise<'ready' | 'failed'> {
  const timeoutMs = loadTimeoutMs();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'ready' | 'failed') => {
      if (settled || signal.cancelled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('failed'), timeoutMs);
    loadQuarterReviewScreenModule()
      .then(() => finish('ready'))
      .catch(() => finish('failed'));
  });
}
