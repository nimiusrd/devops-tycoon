import { useLayoutEffect } from 'react';
import { beginWebglLoading } from '../render/webglStatus';

/** lazy chunkの取得中も見えない盤面の自動進行を止める。 */
export function WebglLoading() {
  useLayoutEffect(beginWebglLoading, []);
  return null;
}
