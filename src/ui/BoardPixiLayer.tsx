/**
 * スプリント盤面の PixiJS 描画レイヤ（`?renderer=pixi` 時のみ Board からマウント）。
 *
 * 盤面 div（contain-fit 済み・1404:573）いっぱいに透明 canvas を重ね、常駐物
 * （フロー線・タスク粒・ステーションキャラ）だけを WebGL で描く。ラベル・吹き出し・
 * 凡例・イベント演出（FireEffects / InterventionEffects 等）は DOM のまま親が重ねる。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useEffect, useRef } from 'react';
import { PixiBoardRenderer, type BoardPixiInput } from '../render/adapters/pixiBoardRenderer';

/** Playwright Pixi 視覚回帰向け（dev のみ）。 */
declare global {
  interface Window {
    __boardPixiTest?: {
      freezeForScreenshot(): void;
    };
  }
}

export type BoardPixiLayerProps = BoardPixiInput & {
  /** WebGL 初期化失敗時に呼ぶ（親が DOM 版へフォールバックする）。 */
  onWebglError?: () => void;
};

export function BoardPixiLayer({
  scene,
  draggableTaskIds,
  dragTaskId,
  onWebglError,
}: BoardPixiLayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiBoardRenderer | null>(null);
  const inputRef = useRef<BoardPixiInput>({ scene, draggableTaskIds, dragTaskId });
  const onWebglErrorRef = useRef(onWebglError);

  useEffect(() => {
    onWebglErrorRef.current = onWebglError;
  }, [onWebglError]);

  useEffect(() => {
    inputRef.current = { scene, draggableTaskIds, dragTaskId };
  }, [scene, draggableTaskIds, dragTaskId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiBoardRenderer({
      onRenderMetrics: (m) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.boardDots = String(m.dots);
        el.dataset.boardActors = String(m.actors);
      },
    });
    rendererRef.current = renderer;

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r?.isReady) return;
      r.resize(el.clientWidth, el.clientHeight);
      r.render(r.getLastInput() ?? inputRef.current);
    };

    let cancelled = false;
    void renderer
      .init(mount)
      .then(() => {
        if (cancelled) return;
        renderer.resize(mount.clientWidth, mount.clientHeight);
        renderer.render(inputRef.current);
        if (import.meta.env.DEV) {
          window.__boardPixiTest = {
            freezeForScreenshot: () => renderer.freezeForScreenshot(),
          };
        }
      })
      .catch((err: unknown) => {
        // WebGL 不可の環境では DOM/SVG レンダラへフォールバックする。
        console.warn('PixiBoardRenderer init failed; falling back to DOM renderer', err);
        if (!cancelled) onWebglErrorRef.current?.();
      });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);

    return () => {
      cancelled = true;
      delete window.__boardPixiTest;
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
    // mount/unmount のみ。入力は ref 経由（deps に入れると WebGL 再生成）。
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady) return;
    const mount = mountRef.current;
    if (mount) renderer.resize(mount.clientWidth, mount.clientHeight);
    renderer.render({ scene, draggableTaskIds, dragTaskId });
  }, [scene, draggableTaskIds, dragTaskId]);

  return (
    <div
      ref={mountRef}
      className="board-pixi-mount"
      data-testid="board-pixi-mount"
      aria-label="スプリント盤面（WebGL）"
    />
  );
}
