/**
 * 部署ビュー（SPEC 第4.9 / mockups/dept-screen）。
 *
 * 部門内の各チームを Coding ▸ Review ▸ Done の小パイプラインとして中解像度で表示し、
 * チーム間依存（連鎖炎上）と部門HUD・部門レバーを見せる。現場と全社の橋渡し層。
 * 状態は読むだけ（第22.2）。
 */
import { DEPARTMENT_LEVERS } from '../data/levers';
import type { DepartmentState } from '../sim/orgscale/types';
import { HEALTH_LABEL } from '../render/orgView';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { DeptBoard } from './DeptBoard';
import { EffectTagList } from './EffectTagList';

export interface DeptScreenProps {
  dept: DepartmentState;
  budget: number;
  onFocusTeam: (id: string) => void;
  onApplyLever: (leverId: string, deptId: string) => void;
}

export function DeptScreen({ dept, budget, onFocusTeam, onApplyLever }: DeptScreenProps) {
  return (
    <div className="dept-screen" data-testid="dept-screen">
      <header className="dept-head">
        <span className="dot" style={{ background: dept.def.color }} />
        <h2>🏢 {dept.def.name}</h2>
        <span className="dept-health" data-health={dept.health}>
          {HEALTH_LABEL[dept.health]}
        </span>
      </header>

      <dl className="dept-hud" data-testid="dept-hud">
        <Stat label="部門出荷" value={dept.shipping} />
        <Stat label="レビュー耐性" value={dept.reviewResilience} />
        <Stat label="部門AI依存度" value={dept.aiDependency} />
        <Stat label="部門技術的負債" value={dept.techDebt} />
        <Stat label="部門士気" value={dept.morale} />
        <Stat
          label="炎上チーム"
          value={dept.onFire}
          tone={dept.onFire > 0 ? 'bad' : 'good'}
          testid="dept-onfire"
        />
      </dl>

      <div className="dept-field" data-testid="dept-field">
        <DeptBoard dept={dept} onFocusTeam={onFocusTeam} />
      </div>

      <div className="dept-levers" data-testid="dept-levers">
        <span className="org-levers-title">部門レバー</span>
        {DEPARTMENT_LEVERS.map((l) => (
          <button
            type="button"
            key={l.id}
            className="org-lever"
            data-testid={`lever-${l.id}`}
            disabled={budget < l.cost}
            onClick={() => onApplyLever(l.id, dept.def.id)}
            title={formatLeverTooltip(l)}
          >
            <span className="org-lever-head">
              <b>{l.name}</b>
              <span className="org-lever-cost">💰{l.cost}</span>
            </span>
            <EffectTagList tags={formatLeverDefTags(l)} testId={`lever-tags-${l.id}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number | string;
  tone?: 'good' | 'bad';
  testid?: string;
}) {
  return (
    <div className={`org-stat${tone ? ` tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
