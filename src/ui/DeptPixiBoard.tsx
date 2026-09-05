/**
 * 部署ビューの PixiJS 描画領域（`?renderer=pixi` 時のみ DeptScreen からマウント）。
 *
 * DOM の部門 HUD / レバー / ヒントは親側が描き、ここは等角盤面（プレート・依存
 * フロー・チームミニ盤面・バナー・工程ラベル）だけを canvas に描く。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CIではPlaywrightで検証する）。
 */
import { beginWebglLoading } from '../render/webglStatus';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DepartmentState } from '../sim/orgscale/types';
import { PixiDeptRenderer } from '../render/adapters/pixiDeptRenderer';

/** Playwright Pixi 視覚回帰向け（dev のみ）。 */
declare global {
  interface Window {
    __deptPixiTest?: {
      freezeForScreenshot(): void;
    };
  }
}

export interface DeptPixiBoardProps {
  dept: DepartmentState;
  onFocusTeam: (id: string) => void;
  /** WebGL 初期化失敗時に呼ぶ（再試行の案内を表示する）。 */
  onWebglError?: () => void;
}

export function DeptPixiBoard({ dept, onFocusTeam, onWebglError }: DeptPixiBoardProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiDeptRenderer | null>(null);
  const deptRef = useRef(dept);
  const onFocusTeamRef = useRef(onFocusTeam);
  const onWebglErrorRef = useRef(onWebglError);

  useLayoutEffect(() => {
    onFocusTeamRef.current = onFocusTeam;
    onWebglErrorRef.current = onWebglError;
  }, [onFocusTeam, onWebglError]);

  useEffect(() => {
    deptRef.current = dept;
  }, [dept]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiDeptRenderer({
      onFocusTeam: (id) => {
        const r = rendererRef.current;
        const team = deptRef.current.teams.find((t) => t.id === id);
        // RI-04 / RI-64: アクティブチームは現場へ着地するため、カメラが寄ってから
        // 状態遷移する。非アクティブは engine が department 止まりなので即時遷移。
        // ズーム中に unmount（dispose）されたら completed=false になり遷移しない。
        if (r?.isReady && team?.isActive) {
          void r.focusTeamZoom(id).then((completed) => {
            if (completed) onFocusTeamRef.current(id);
          });
        } else {
          onFocusTeamRef.current(id);
        }
      },
      onRenderMetrics: (m) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.deptTeams = String(m.teams);
        el.dataset.deptFlows = String(m.flows);
        el.dataset.deptAssets = String(m.assets);
      },
    });
    rendererRef.current = renderer;

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r?.isReady) return;
      r.resize(el.clientWidth, el.clientHeight);
      r.render(r.getLastDept() ?? deptRef.current);
    };

    let cancelled = false;
    const finishLoading = beginWebglLoading();
    void renderer
      .init(mount)
      .then(() => {
        if (cancelled) return;
        renderer.resize(mount.clientWidth, mount.clientHeight);
        renderer.render(deptRef.current);
        finishLoading();
        if (import.meta.env.DEV) {
          window.__deptPixiTest = {
            freezeForScreenshot: () => renderer.freezeForScreenshot(),
          };
        }
      })
      .catch((err: unknown) => {
        // WebGL失敗は共有の案内へ通知し、自動進行を止める。
        console.warn('PixiDeptRenderer init failed; WebGL is unavailable', err);
        if (!cancelled) onWebglErrorRef.current?.();
        finishLoading();
      });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);

    return () => {
      cancelled = true;
      finishLoading();
      delete window.__deptPixiTest;
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
    // mount/unmount のみ。onFocusTeam は ref 経由（deps に入れると WebGL 再生成）。
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady) return;
    const mount = mountRef.current;
    if (mount) renderer.resize(mount.clientWidth, mount.clientHeight);
    renderer.render(dept);
  }, [dept]);

  const hot = dept.onFire > 0 || dept.health === 'reviewHell';

  return (
    <div className={`dept-board iso-dept${hot ? ' dept-hell' : ''}`} data-testid="dept-board">
      <div
        ref={mountRef}
        className="dept-pixi-mount"
        data-testid="dept-pixi-mount"
        aria-label="部署ビュー（WebGL）"
      />
      <div className="dept-board-hint">
        チームの島を<b>クリック</b>で状態確認。パネルから<b>入り込む</b>
      </div>
    </div>
  );
}
