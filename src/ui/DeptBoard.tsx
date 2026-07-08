/**
 * 部署ビューの等角盤面レンダラ（SPEC 第4.9 / mockups/dept-screen 準拠）。
 */
import { useLayoutEffect, useRef } from 'react';
import type { DepartmentState } from '../sim/orgscale/types';
import { DEPT_VIEW, planDeptBoardScene, type DeptTeamPlan } from '../render/deptBoardScene';
import { DeptDependencyFlows } from './DeptDependencyFlows';
import { DeptPlate } from './DeptPlate';
import { DeptTeamBanner, DeptTeamMini } from './DeptTeamMini';

const VIEW_W = DEPT_VIEW.w;
const VIEW_H = DEPT_VIEW.h;
const VIEW_RATIO = VIEW_W / VIEW_H;

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

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

function DeptTeamBlock({
  plan,
  deptColor,
  onClick,
}: {
  plan: DeptTeamPlan;
  deptColor: string;
  onClick: () => void;
}) {
  const { team } = plan;
  return (
    <div className="dept-team-group" style={{ zIndex: 20 + plan.depth }}>
      <div
        className={`dept-team-banner-wrap tone-${plan.banner.tone}`}
        style={{ left: pct(plan.banner.x, VIEW_W), top: pct(plan.banner.y, VIEW_H) }}
      >
        <DeptTeamBanner plan={plan} />
      </div>
      <button
        type="button"
        className={`dept-team health-${team.health}${team.isPlayer ? ' is-player' : ''}${
          plan.chained ? ' chained' : ''
        }`}
        data-testid={`team-${team.id}`}
        data-health={team.health}
        style={{
          left: pct(plan.x, VIEW_W),
          top: pct(plan.y, VIEW_H),
          width: `${27.064 * plan.scale}%`,
        }}
        onClick={onClick}
        title={`${team.name}の現場へ`}
      >
        <DeptTeamMini plan={plan} deptColor={deptColor} />
      </button>
    </div>
  );
}

export interface DeptBoardProps {
  dept: DepartmentState;
  onFocusTeam: (id: string) => void;
}

export function DeptBoard({ dept, onFocusTeam }: DeptBoardProps) {
  const scene = planDeptBoardScene(dept);
  const hot = dept.onFire > 0 || dept.health === 'reviewHell';
  const boardRef = useRef<HTMLDivElement>(null);
  useContainFit(boardRef);

  return (
    <div
      ref={boardRef}
      className={`dept-board iso-dept${hot ? ' dept-hell' : ''}`}
      data-testid="dept-board"
    >
      <DeptPlate plate={scene.plate} />
      <DeptDependencyFlows flows={scene.flows} />

      {scene.stageLabels.map((label) => (
        <div
          key={label.lane}
          className={`dept-stage-label${label.hot ? ' hot' : ''}`}
          style={{ left: pct(label.x, VIEW_W), top: pct(label.y, VIEW_H) }}
        >
          {label.label}
        </div>
      ))}

      {scene.teams.map((team) => (
        <DeptTeamBlock
          key={team.teamId}
          plan={team}
          deptColor={dept.def.color}
          onClick={() => onFocusTeam(team.teamId)}
        />
      ))}

      <div className="dept-board-hint">
        チームの島を<b>クリック</b>でそのチームの<b>現場（能動操作）</b>へ
      </div>
    </div>
  );
}
