/**
 * what-if 試算用 Web Worker（RI-13）。
 *
 * Comlink で `computeWhatIfState` を公開し、メインスレッドのフレームを止めない。
 */
import { expose } from 'comlink';
import { computeWhatIfState, type WhatIfComputeInput } from './whatIfState';
import type { WhatIfState } from './types';

export interface WhatIfWorkerApi {
  computeWhatIfState(input: WhatIfComputeInput): WhatIfState | null;
}

const api: WhatIfWorkerApi = {
  computeWhatIfState,
};

expose(api);
