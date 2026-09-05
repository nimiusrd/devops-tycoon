/** 盤面はPixiのみ。失敗時は再試行までCanvasをアンマウントする。 */
import { useSyncExternalStore } from 'react';
import { getWebglStatus, markWebglFailed, subscribeWebglStatus } from '../render/webglStatus';

export interface PixiRendererChoice {
  usePixi: boolean;
  onWebglError: () => void;
}

export function usePixiRenderer(): PixiRendererChoice {
  const status = useSyncExternalStore(subscribeWebglStatus, getWebglStatus, () => 'loading');
  return { usePixi: status !== 'failed', onWebglError: markWebglFailed };
}
