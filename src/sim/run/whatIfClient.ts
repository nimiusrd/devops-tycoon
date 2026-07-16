/**
 * what-if 試算の Worker クライアント（RI-13）。
 *
 * ブラウザでは Comlink + Vite `?worker` でオフロードし、Worker 不可環境
 * （Vitest / Node）や生成失敗時は同じ純関数を同期実行する。
 */
import { computeWhatIfState, type WhatIfComputeInput } from './whatIfState';
import type { WhatIfState } from './types';

type WhatIfApi = {
  computeWhatIfState(input: WhatIfComputeInput): WhatIfState | null | Promise<WhatIfState | null>;
};

let remote: WhatIfApi | null = null;
let initPromise: Promise<WhatIfApi | null> | null = null;
let workerDisabled = false;

function canUseWorker(): boolean {
  return !workerDisabled && typeof Worker !== 'undefined';
}

async function getRemote(): Promise<WhatIfApi | null> {
  if (!canUseWorker()) return null;
  if (remote) return remote;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const [{ wrap }, workerMod] = await Promise.all([
          import('comlink'),
          import('./whatIf.worker.ts?worker'),
        ]);
        const worker = new workerMod.default();
        remote = wrap<WhatIfApi>(worker);
        return remote;
      } catch {
        workerDisabled = true;
        remote = null;
        return null;
      }
    })();
  }
  return initPromise;
}

/** Worker があればオフロード、なければ同期フォールバック。 */
export async function requestWhatIfState(input: WhatIfComputeInput): Promise<WhatIfState | null> {
  const api = await getRemote();
  if (api) {
    try {
      return await api.computeWhatIfState(input);
    } catch {
      workerDisabled = true;
      remote = null;
      initPromise = null;
    }
  }
  return computeWhatIfState(input);
}

/** テスト用: Worker 利用可否をリセットする。 */
export function resetWhatIfClientForTests(): void {
  remote = null;
  initPromise = null;
  workerDisabled = false;
}
