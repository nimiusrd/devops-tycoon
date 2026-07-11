/**
 * スプリント盤面の PixiJS 描画領域（`?renderer=pixi` 時のみ Board からマウント）。
 *
 * FireEffects / InterventionEffects / オーラは親 Board が DOM で重ねる。
 */
import { useEffect, useRef } from 'react';
import type { Task } from '../sim/types';
import { BOARD_DOT_BUDGET, PixiBoardRenderer } from '../render/adapters/pixiBoardRenderer';

declare global {
  interface Window {
    __boardPixiTest?: {
      freezeForScreenshot(): void;
      getDotCount(): number | null;
    };
  }
}

export interface BoardPixiFieldProps {
  tasks: Task[];
}

export function BoardPixiField({ tasks }: BoardPixiFieldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiBoardRenderer | null>(null);
  const tasksRef = useRef(tasks);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiBoardRenderer({
      spriteBudget: BOARD_DOT_BUDGET,
      onPlanMetrics: (metrics) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.boardSprites = String(metrics.sprites);
        el.dataset.boardDots = String(metrics.dots);
        el.dataset.boardStations = String(metrics.stations);
      },
    });
    rendererRef.current = renderer;

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r) return;
      r.resize(el.clientWidth, el.clientHeight);
      r.renderTasks(tasksRef.current);
    };

    let cancelled = false;
    void renderer.init(mount).then(() => {
      if (cancelled) return;
      syncLayout();
      if (import.meta.env.DEV) {
        window.__boardPixiTest = {
          freezeForScreenshot: () => renderer.freezeForScreenshot(),
          getDotCount: () => renderer.getPoolStats()?.active ?? null,
        };
      }
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
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady) return;
    const mount = mountRef.current;
    if (mount) renderer.resize(mount.clientWidth, mount.clientHeight);
    renderer.renderTasks(tasks);
  }, [tasks]);

  return (
    <div
      ref={mountRef}
      className="board-pixi-mount"
      data-testid="board-pixi-mount"
      aria-label="現場盤面（WebGL）"
    />
  );
}
