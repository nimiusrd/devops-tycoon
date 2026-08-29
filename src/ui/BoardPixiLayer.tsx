/**
 * スプリント盤面の PixiJS 描画レイヤ（`?renderer=pixi` 時のみ Board からマウント）。
 *
 * 盤面 div（contain-fit 済み・1404:573）いっぱいに透明 canvas を重ねる。常駐物
 * （フロー線・タスク粒・ステーションキャラ・オーラ）は基盤 canvas、炎上・介入は
 * DOM のラベル・吹き出しより上の演出 canvas に分離する。DOM 版は不可視 fallback
 * として同じ時刻付き plan を進める。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import {
  PixiBoardRenderer,
  type BoardPixiInput,
  type BoardRenderMetrics,
} from '../render/adapters/pixiBoardRenderer';

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
  const effectsMountRef = useRef<HTMLDivElement>(null);
  const baseRendererRef = useRef<PixiBoardRenderer | null>(null);
  const effectsRendererRef = useRef<PixiBoardRenderer | null>(null);
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
    baseRendererRef.current?.setAnimationsPaused(animationsPaused);
    effectsRendererRef.current?.setAnimationsPaused(animationsPaused);
  }, [animationsPaused]);

  useEffect(() => {
    inputRef.current = { scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion };
  }, [scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    const effectsMount = effectsMountRef.current;
    if (!mount || !effectsMount) return;

    const emptyMetrics: BoardRenderMetrics = {
      dots: 0,
      actors: 0,
      flows: 0,
      reviewTrails: 0,
      reviewHeat: 0,
      effects: 0,
      auras: 0,
      assets: 0,
    };
    let baseMetrics = emptyMetrics;
    let effectMetrics = emptyMetrics;
    const writeMetrics = (): void => {
      const el = mountRef.current;
      const effectEl = effectsMountRef.current;
      if (!el || !effectEl) return;
      el.dataset.boardDots = String(baseMetrics.dots);
      el.dataset.boardActors = String(baseMetrics.actors);
      el.dataset.boardAssets = String(baseMetrics.assets);
      el.dataset.boardReviewTrails = String(baseMetrics.reviewTrails);
      el.dataset.boardReviewHeat = String(baseMetrics.reviewHeat);
      el.dataset.boardEffects = String(effectMetrics.effects);
      el.dataset.boardAuras = String(baseMetrics.auras);
      effectEl.dataset.boardEffects = String(effectMetrics.effects);
    };
    const baseRenderer = new PixiBoardRenderer({
      stratum: 'base',
      onRenderMetrics: (m) => {
        baseMetrics = m;
        writeMetrics();
      },
    });
    const effectsRenderer = new PixiBoardRenderer({
      stratum: 'effects',
      onRenderMetrics: (m) => {
        effectMetrics = m;
        writeMetrics();
      },
    });
    baseRendererRef.current = baseRenderer;
    effectsRendererRef.current = effectsRenderer;

    const syncLayout = (): void => {
      const el = mountRef.current;
      const base = baseRendererRef.current;
      const overlay = effectsRendererRef.current;
      if (!el || !base?.isReady || !overlay?.isReady) return;
      base.resize(el.clientWidth, el.clientHeight);
      overlay.resize(el.clientWidth, el.clientHeight);
      base.render(base.getLastInput() ?? inputRef.current);
      overlay.render(overlay.getLastInput() ?? inputRef.current);
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
      await Promise.all([baseRenderer.init(mount), effectsRenderer.init(effectsMount)]);
    };

    void initRenderer()
      .then(() => {
        if (cancelled) return;
        baseRenderer.resize(mount.clientWidth, mount.clientHeight);
        effectsRenderer.resize(mount.clientWidth, mount.clientHeight);
        baseRenderer.render(inputRef.current);
        effectsRenderer.render(inputRef.current);
        baseRenderer.setAnimationsPaused(animationsPausedRef.current);
        effectsRenderer.setAnimationsPaused(animationsPausedRef.current);
        onReadyRef.current?.();
        if (import.meta.env.DEV) {
          window.__boardPixiTest = {
            freezeForScreenshot: () => {
              baseRenderer.freezeForScreenshot();
              effectsRenderer.freezeForScreenshot();
            },
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
      baseRenderer.dispose();
      effectsRenderer.dispose();
      baseRendererRef.current = null;
      effectsRendererRef.current = null;
    };
    // mount/unmount のみ。入力は ref 経由（deps に入れると WebGL 再生成）。
  }, []);

  useEffect(() => {
    const baseRenderer = baseRendererRef.current;
    const effectsRenderer = effectsRendererRef.current;
    if (!baseRenderer?.isReady || !effectsRenderer?.isReady) return;
    const mount = mountRef.current;
    if (mount) {
      baseRenderer.resize(mount.clientWidth, mount.clientHeight);
      effectsRenderer.resize(mount.clientWidth, mount.clientHeight);
    }
    const input = { scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion };
    baseRenderer.render(input);
    effectsRenderer.render(input);
  }, [scene, draggableTaskIds, dragTaskId, effects, auras, reducedMotion]);

  return (
    <>
      <div
        ref={mountRef}
        className="board-pixi-mount"
        data-testid="board-pixi-mount"
        aria-hidden="true"
      />
      <div
        ref={effectsMountRef}
        className="board-pixi-effects-mount"
        data-testid="board-pixi-effects-mount"
        aria-hidden="true"
      />
    </>
  );
}
