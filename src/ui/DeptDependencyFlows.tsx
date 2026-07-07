/**
 * 部署ビューのチーム間依存フロー（等角パス + heat 色）。
 */
import type { DeptFlowPlan } from '../render/deptBoardScene';

export function DeptDependencyFlows({ flows }: { flows: readonly DeptFlowPlan[] }) {
  return (
    <svg
      className="dept-flows"
      viewBox="0 0 1404 573"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker id="dept-ah" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#cdbff0" />
        </marker>
        <marker id="dept-ahr" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#ff9a93" />
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
