/**
 * 全社マップのチーム間フローレーン（等角パス + heat 色）。
 * 旧モック org-screen（git 履歴）/ Board.tsx FlowArrows 準拠。
 */
import type { OrgFlowPlan } from '../render/orgBoardScene';
import { ORG_VIEW } from '../render/orgBoardScene';
import { VISUAL_TOKENS } from '../render/visualTokens';

export function OrgFlowLanes({ flows }: { flows: readonly OrgFlowPlan[] }) {
  return (
    <svg
      className="org-flows"
      viewBox={`0 0 ${ORG_VIEW.w} ${ORG_VIEW.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker id="org-ah" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={VISUAL_TOKENS.colors.flow.normal} />
        </marker>
        <marker id="org-ahr" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={VISUAL_TOKENS.colors.flow.hot} />
        </marker>
      </defs>
      {flows.map((f) => (
        <path
          key={f.id}
          className={`org-miniflow${f.hot ? ' hot' : ''}`}
          d={f.d}
          fill="none"
          stroke={f.stroke}
          strokeWidth={f.strokeWidth}
          opacity={f.opacity}
          markerEnd={`url(#${f.hot ? 'org-ahr' : 'org-ah'})`}
        />
      ))}
    </svg>
  );
}
