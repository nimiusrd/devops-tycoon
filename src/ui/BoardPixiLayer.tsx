/**
 * スプリント盤面の PixiJS 描画レイヤ（`?renderer=pixi` 時のみ Board からマウント）。
 *
 * 盤面 div（contain-fit 済み・1404:573）いっぱいに透明 canvas を重ね、常駐物
 * （フロー線・タスク粒・ステーションキャラ）と、炎上・介入・常駐オーラを WebGL で描く。
 * ラベル・吹き出し・凡例は DOM のまま親が重ね、イベント演出の DOM 版は不可視 fallback
 * として同じ時刻付き plan を進める。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { PixiBoardRenderer, type BoardPixiInput } from '../render/adapters/pixiBoardRenderer';

/** Playwright Pixi 視覚回帰向け（dev のみ）。 */
declare global {
  interface Window {
    __boardPixiTest?: {
      freezeForScreenshot(): void;
    };
    /** Playwright が WebGL 初期化失敗を決定論的に注入するためのフック。 */
    __forceBoardPixiInitFailure?: { delayMs?: number; waitForEffects?: boolean };
    /** Playwright が初回描画前の遅延を決定論的に注入するためのフック。 */
    __delayBoardPixiInit?: { delayMs: number; waitForEffects?: boolean };
  }
}

export type BoardPixiLayerProps = Omit<BoardPixiInput, 'reducedMotion'> & {
  /** WebGL 初期化失敗時に呼ぶ（親が DOM 版へフォールバックする）。 */
  onWebglError?: () => void;
  /** WebGL 初期化と初回描画が完了したあとに呼ぶ。 */
  onReady?: () => void;
  /** true なら ticker を止め、壁時計アニメで盤面が進まないようにする（#386）。 */
  animationsPaused?: boolean;
};

export function BoardPixiLayer({
  scene,
  draggableTaskIds,
  dragTaskId,
  effects,
  auras,
  onWebglError,
  onReady,
  animationsPaused = false,
}: BoardPixiLayerProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiBoardRenderer | null>(null);
  const inputRef = useRef<BoardPixiInput>({
    scene,
    draggableTaskIds,
    dragTaskId,
    effects,
    auras,
    reducedMotion,
  });
  const onWebglErrorRef = useRef(onWebglError);
  const onReadyRef = useRef(onReady);
  const animationsPausedRef = useRef(animationsPaused);

  useEffect(() => {
    onWebglErrorRef.current = onWebglError;
  }, [onWebglError]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    animationsPausedRef.current = animationsPaused;
    rendererRef.current?.setAnimationsPaused(animationsPaused);
  }, [animationsPaused]);

  useEffect(() => {
    inputRef.current = { scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion };
  }, [scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiBoardRenderer({
      onRenderMetrics: (m) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.boardDots = String(m.dots);
        el.dataset.boardActors = String(m.actors);
        el.dataset.boardAssets = String(m.assets);
        el.dataset.boardReviewTrails = String(m.reviewTrails);
        el.dataset.boardReviewHeat = String(m.reviewHeat);
        el.dataset.boardEffects = String(m.effects);
        el.dataset.boardAuras = String(m.auras);
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
    const waitForEffects = (): Promise<void> =>
      new Promise<void>((resolve) => {
        const poll = () => {
          if (cancelled || inputRef.current.effects.length > 0) {
            resolve();
            return;
          }
          window.setTimeout(poll, 16);
        };
        poll();
      });
    const initRenderer = async (): Promise<void> => {
      const delayedInit = window.__delayBoardPixiInit;
      if (delayedInit) {
        if (delayedInit.waitForEffects) await waitForEffects();
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, Math.max(0, delayedInit.delayMs)),
        );
        if (cancelled) return;
      }
      const forcedFailure = window.__forceBoardPixiInitFailure;
      if (forcedFailure) {
        if (forcedFailure.waitForEffects) await waitForEffects();
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, Math.max(0, forcedFailure.delayMs ?? 0)),
        );
        throw new Error('Forced BoardPixiLayer initialization failure');
      }
      await renderer.init(mount);
    };

    void initRenderer()
      .then(() => {
        if (cancelled) return;
        renderer.resize(mount.clientWidth, mount.clientHeight);
        renderer.render(inputRef.current);
        renderer.setAnimationsPaused(animationsPausedRef.current);
        onReadyRef.current?.();
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
    renderer.render({ scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion });
  }, [scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion]);

  return (
    <div
      ref={mountRef}
      className="board-pixi-mount"
      data-testid="board-pixi-mount"
      aria-hidden="true"
    />
  );
}
