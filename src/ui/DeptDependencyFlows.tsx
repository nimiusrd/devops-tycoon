/**
 * 部署ビューのチーム間依存フロー（等角パス + heat 色）。
 */
import type { DeptFlowPlan } from '../render/deptBoardScene';
import { DEPT_VIEW } from '../render/deptBoardScene';
import { VISUAL_TOKENS } from '../render/visualTokens';

export function DeptDependencyFlows({ flows }: { flows: readonly DeptFlowPlan[] }) {
  return (
    <svg
      className="dept-flows"
      viewBox={`0 0 ${DEPT_VIEW.w} ${DEPT_VIEW.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker id="dept-ah" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={VISUAL_TOKENS.colors.flow.normal} />
        </marker>
        <marker id="dept-ahr" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={VISUAL_TOKENS.colors.flow.hot} />
        </marker>
      </defs>
      {flows.map((f) => (
        <path
          key={f.id}
          className={`dept-miniflow${f.hot ? ' hot' : ''}`}
          data-testid={f.hot ? 'chain-flow' : undefined}
          d={f.d}
          fill="none"
          stroke={f.stroke}
          strokeWidth={f.strokeWidth}
          opacity={f.opacity}
          markerEnd={`url(#${f.hot ? 'dept-ahr' : 'dept-ah'})`}
        />
      ))}
    </svg>
  );
}
