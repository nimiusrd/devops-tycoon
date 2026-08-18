/**
 * 四半期 OKR の表示（RI-129）。
 *
 * 導出は `planOkrView` に任せ、状態は読むだけ（第22.2）。
 * レビューでは既存 KPI 行の testid を維持し、編成ではタイトルと KR 名だけ出す。
 */
import { useMemo, type ReactNode } from 'react';
import { KPI_STATUS_LABELS } from '../render/reviewHistoryView';
import { planOkrView, type OkrView } from '../render/okrView';
import type { GoalKpiProgress, QuarterGoal } from '../sim/run/types';

export interface QuarterOkrProps {
  bossId: string;
  goal: QuarterGoal;
  progress?: readonly GoalKpiProgress[];
  variant: 'review' | 'setup';
}

function statusLabel(status: GoalKpiProgress['status'] | undefined): string {
  if (!status) return '—';
  return KPI_STATUS_LABELS[status];
}

function ReviewOkr({ view }: { view: OkrView }): ReactNode {
  return (
    <section
      className="quarter-okr"
      data-testid="quarter-okr"
      data-template={view.templateId}
      aria-label="今四半期の OKR"
    >
      <p className="result-section-label">今四半期の OKR</p>
      <div className="quarter-kpi-table" data-testid="quarter-kpi">
        <div className="quarter-kpi-header">
          <span>KPI</span>
          <span>目標</span>
          <span>実績</span>
          <span>判定</span>
        </div>
        {view.objectives.map((objective) => (
          <div key={objective.id} className="quarter-okr-objective" data-objective={objective.id}>
            <p className="quarter-okr-kicker">Objective</p>
            <h3 className="quarter-okr-title">{objective.title}</h3>
            <p className="quarter-okr-desc">{objective.description}</p>
            {objective.keyResults.map((kr) => (
              <div className="quarter-kpi-row" key={kr.id} data-kpi={kr.id}>
                <span>{kr.label}</span>
                <span>{kr.target ?? '—'}</span>
                <span>{kr.actual ?? '—'}</span>
                <span className={kr.status ? `kpi-badge kpi-${kr.status}` : 'kpi-badge'}>
                  {statusLabel(kr.status)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function SetupOkr({ view }: { view: OkrView }): ReactNode {
  return (
    <section
      className="setup-okr"
      data-testid="setup-okr"
      data-template={view.templateId}
      aria-label="今四半期の OKR"
    >
      <p className="setup-okr-kicker">今四半期の OKR</p>
      {view.objectives.map((objective) => (
        <div key={objective.id} className="setup-okr-objective" data-objective={objective.id}>
          <p className="setup-okr-title">{objective.title}</p>
          <div className="setup-okr-chips">
            {objective.keyResults.map((kr) => (
              <span key={kr.id} className="pill" data-okr-kr={kr.id}>
                {kr.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function QuarterOkr({ bossId, goal, progress, variant }: QuarterOkrProps) {
  const view = useMemo(() => planOkrView({ bossId, goal, progress }), [bossId, goal, progress]);
  return variant === 'review' ? <ReviewOkr view={view} /> : <SetupOkr view={view} />;
}
