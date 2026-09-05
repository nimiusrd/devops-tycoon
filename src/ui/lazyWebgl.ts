import { createElement, useSyncExternalStore, type ComponentType } from 'react';
import { getWebglAttempt, getWebglStatus, subscribeWebglStatus } from '../render/webglStatus';
import { WebglScene } from './WebglScene';

/** モジュールスコープで定義し、Reactツリーとlazyのエラーを試行ごとにリセットする。 */
export function lazyWebgl<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return function WebglComponent(props: P) {
    const status = useSyncExternalStore(subscribeWebglStatus, getWebglStatus, () => 'loading');
    const attempt = useSyncExternalStore(subscribeWebglStatus, getWebglAttempt, () => 0);
    return status === 'failed'
      ? null
      : createElement(WebglScene<P>, { key: attempt, load, componentProps: props });
  };
}
