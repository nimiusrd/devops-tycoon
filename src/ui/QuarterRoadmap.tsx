/**
 * 今四半期より先の目標見通し（RI-131）。
 *
 * 導出は `quarterRoadmapView` に任せ、状態は読むだけ（第22.2）。拘束力は持たない。
 */
import { useMemo } from 'react';
import type { GoalAdjustmentDef } from '../data/goalAdjustments';
import { quarterRoadmapView } from '../render/quarterRoadmapView';
import type { QuarterGoal } from '../sim/run/types';

export interface QuarterRoadmapProps {
  quarterNumber: number;
  goal: QuarterGoal;
  adjustment?: GoalAdjustmentDef;
}

export function QuarterRoadmap({ quarterNumber, goal, adjustment }: QuarterRoadmapProps) {
  const rows = useMemo(
    () => quarterRoadmapView({ quarterNumber, goal, adjustment }),
    [quarterNumber, goal, adjustment],
  );

  return (
    <section
      className="quarter-roadmap"
      data-testid="quarter-roadmap"
      data-preview={adjustment?.id}
      aria-label="見通し（拘束なし）"
    >
      <p className="result-section-label">見通し（拘束なし）</p>
      {adjustment ? (
        <p className="quarter-roadmap-preview" data-testid="quarter-roadmap-preview">
          プレビュー: {adjustment.label}
        </p>
      ) : (
        <p className="quarter-roadmap-note">現状目標の減衰。修正カードに合わせると次期が変わる。</p>
      )}
      <ol className="quarter-roadmap-list">
        {rows.map((row) => {
          const delivery = row.kpis.find((kpi) => kpi.id === 'delivery')?.target;
          return (
            <li
              key={row.horizon}
              className={row.preview ? 'quarter-roadmap-row preview' : 'quarter-roadmap-row'}
              data-testid="quarter-roadmap-row"
              data-horizon={row.horizon}
              data-quarter={row.quarterNumber}
              data-delivery={delivery}
            >
              <span className="quarter-roadmap-quarter">Q{row.quarterNumber}</span>
              <span className="quarter-roadmap-role">{row.roleLabel}</span>
              <span className="quarter-roadmap-kpis">
                {row.kpis.map((kpi) => (
                  <span key={kpi.id} data-kpi={kpi.id}>
                    {kpi.label} {kpi.target}
                  </span>
                ))}
              </span>
              <span
                className="quarter-roadmap-constraints"
                data-testid="quarter-roadmap-constraints"
              >
                {row.constraints.join(' / ')}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
