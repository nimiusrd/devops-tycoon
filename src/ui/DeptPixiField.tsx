/**
 * 部署ビューの PixiJS 描画領域（`?renderer=pixi` 時のみ DeptScreen からマウント）。
 *
 * DOM の HUD / レバーは親が描き、ここは等角盤面だけ。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 * チームのクリックヒットは DOM 透明ボタンで担保し、E2E の `team-*` testid を維持する。
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { DepartmentState } from '../sim/orgscale/types';
import { DEPT_SPRITE_BUDGET, PixiDeptRenderer } from '../render/adapters/pixiDeptRenderer';
import { DEPT_VIEW, planDeptBoardScene, TEAM_MINI_DESIGN_W } from '../render/deptBoardScene';

/** Playwright Pixi 視覚回帰向け（dev のみ）。 */
declare global {
  interface Window {
    __deptPixiTest?: {
      freezeForScreenshot(): void;
      getTeamCount(): number | null;
    };
  }
}

export interface DeptPixiFieldProps {
  dept: DepartmentState;
  onFocusTeam: (id: string) => void;
}

const VIEW_RATIO = DEPT_VIEW.w / DEPT_VIEW.h;

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

export function DeptPixiField({ dept, onFocusTeam }: DeptPixiFieldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiDeptRenderer | null>(null);
  const deptRef = useRef(dept);
  const onFocusTeamRef = useRef(onFocusTeam);
  const scene = useMemo(() => planDeptBoardScene(dept), [dept]);

  useLayoutEffect(() => {
    onFocusTeamRef.current = onFocusTeam;
  }, [onFocusTeam]);

  useEffect(() => {
    deptRef.current = dept;
  }, [dept]);

  /** DOM DeptBoard と同じ contain fit。 */
  useLayoutEffect(() => {
    const el = boardRef.current;
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
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiDeptRenderer({
      spriteBudget: DEPT_SPRITE_BUDGET,
      onFocusTeam: (id) => onFocusTeamRef.current(id),
      onPlanMetrics: (metrics) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.deptSprites = String(metrics.sprites);
        el.dataset.deptTeams = String(metrics.teams);
        el.dataset.deptFlows = String(metrics.flows);
      },
    });
    rendererRef.current = renderer;

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r) return;
      r.resize(el.clientWidth, el.clientHeight);
      r.renderDept(deptRef.current);
    };

    let cancelled = false;
    void renderer.init(mount).then(() => {
      if (cancelled) return;
      syncLayout();
      if (import.meta.env.DEV) {
        window.__deptPixiTest = {
          freezeForScreenshot: () => renderer.freezeForScreenshot(),
          getTeamCount: () => renderer.getPoolStats()?.active ?? null,
        };
      }
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
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady) return;
    const mount = mountRef.current;
    if (mount) renderer.resize(mount.clientWidth, mount.clientHeight);
    renderer.renderDept(dept);
  }, [dept]);

  const hot = dept.onFire > 0 || dept.health === 'reviewHell';

  return (
    <div
      ref={boardRef}
      className={`dept-board iso-dept dept-board-pixi${hot ? ' dept-hell' : ''}`}
      data-testid="dept-board"
      data-renderer="pixi"
    >
      <div
        ref={mountRef}
        className="dept-pixi-mount"
        data-testid="dept-pixi-mount"
        aria-label="部署ビュー（WebGL）"
      />
      {scene.teams.map((team) => (
        <button
          type="button"
          key={team.teamId}
          className="dept-pixi-hit"
          data-testid={`team-${team.teamId}`}
          data-health={team.team.health}
          style={{
            left: pct(team.x, DEPT_VIEW.w),
            top: pct(team.y, DEPT_VIEW.h),
            width: `${(TEAM_MINI_DESIGN_W / DEPT_VIEW.w) * 100 * team.scale}%`,
            aspectRatio: `${TEAM_MINI_DESIGN_W} / 240`,
          }}
          onClick={() => onFocusTeam(team.teamId)}
          title={`${team.team.name}の現場へ`}
        />
      ))}
    </div>
  );
}
