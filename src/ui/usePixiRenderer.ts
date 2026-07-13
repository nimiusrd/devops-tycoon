/**
 * Pixi レンダラを使うかの判定フック（SPEC 第22.4 / RI-11 既定 Pixi 化）。
 *
 * 既定は Pixi（`getRendererKind`）。WebGL の初期化に失敗した環境（`app.init()` の
 * reject）では `onWebglError` の呼び出しでモジュール全体を DOM フォールバックへ
 * 切り替える（1 画面で失敗したら以降の画面も Pixi init を試みない）。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { getRendererKind } from '../render/adapters/selectRenderer';

let pixiUnavailable = false;
const listeners = new Set<() => void>();

function markPixiUnavailable(): void {
  if (pixiUnavailable) return;
  pixiUnavailable = true;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface PixiRendererChoice {
  /** true なら Pixi レンダラを使う（false は DOM/SVG フォールバック）。 */
  usePixi: boolean;
  /** Pixi ラッパーの init 失敗時に呼ぶ。全画面が DOM へフォールバックする。 */
  onWebglError: () => void;
}

export function usePixiRenderer(): PixiRendererChoice {
  const unavailable = useSyncExternalStore(
    subscribe,
    () => pixiUnavailable,
    () => true,
  );
  const onWebglError = useCallback(() => markPixiUnavailable(), []);
  const wantPixi =
    typeof window !== 'undefined' && getRendererKind(window.location.search) === 'pixi';
  return { usePixi: wantPixi && !unavailable, onWebglError };
}
