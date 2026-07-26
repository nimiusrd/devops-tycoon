/**
 * 部署ビューの PixiJS 描画領域（`?renderer=pixi` 時のみ DeptScreen からマウント）。
 *
 * DOM の部門 HUD / レバー / ヒントは親側が描き、ここは等角盤面（プレート・依存
 * フロー・チームミニ盤面・バナー・工程ラベル）だけを canvas に描く。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DepartmentState } from '../sim/orgscale/types';
import { DEPT_VIEW } from '../render/deptBoardScene';
import { PixiDeptRenderer } from '../render/adapters/pixiDeptRenderer';

/** Playwright Pixi 視覚回帰向け（dev のみ）。 */
declare global {
  interface Window {
    __deptPixiTest?: {
      freezeForScreenshot(): void;
    };
  }
}

const VIEW_RATIO = DEPT_VIEW.w / DEPT_VIEW.h;

/** 盤面を親スロットに「両軸 contain」で収める（DeptBoard の useContainFit と同じ）。 */
function useContainFit(ref: React.RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const slot = el?.parentElement;
    if (!el || !slot) return;
    const apply = () => {
      const w = slot.clientWidth;
      const h = slot.clientHeight;
      if (w === 0 || h === 0) return;
      el.style.width = `${Math.min(w, h * VIEW_RATIO)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [ref]);
}

export interface DeptPixiBoardProps {
  dept: DepartmentState;
  onFocusTeam: (id: string) => void;
  /** WebGL 初期化失敗時に呼ぶ（親が DOM 版へフォールバックする）。 */
  onWebglError?: () => void;
}

export function DeptPixiBoard({ dept, onFocusTeam, onWebglError }: DeptPixiBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiDeptRenderer | null>(null);
  const deptRef = useRef(dept);
  const onFocusTeamRef = useRef(onFocusTeam);
  const onWebglErrorRef = useRef(onWebglError);
  useContainFit(boardRef);

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
    void renderer
      .init(mount)
      .then(() => {
        if (cancelled) return;
        renderer.resize(mount.clientWidth, mount.clientHeight);
        renderer.render(deptRef.current);
        if (import.meta.env.DEV) {
          window.__deptPixiTest = {
            freezeForScreenshot: () => renderer.freezeForScreenshot(),
          };
        }
      })
      .catch((err: unknown) => {
        // WebGL 不可の環境では DOM/SVG レンダラへフォールバックする。
        console.warn('PixiDeptRenderer init failed; falling back to DOM renderer', err);
        if (!cancelled) onWebglErrorRef.current?.();
      });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);

    return () => {
      cancelled = true;
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
    <div
      ref={boardRef}
      className={`dept-board iso-dept${hot ? ' dept-hell' : ''}`}
      data-testid="dept-board"
    >
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
