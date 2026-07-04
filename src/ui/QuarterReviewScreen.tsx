/**
 * 四半期レビュー / 目標修正画面（SPEC 第4.6.1）。
 *
 * 勝敗画面ではなくレビュー会議として、目標達成度・信頼・未達理由・修正選択肢を表示する。
 */
import { getGoalAdjustment } from '../data/goalAdjustments';
import { OUTCOME_LABELS } from '../sim/run/quarterReview';
import { formatGoalAdjustmentTags } from '../render/eventOutcomeView';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ReactNode } from 'react';
import { EffectTagList } from './EffectTagList';

export interface QuarterReviewScreenProps {
  state: RunState;
  onAcknowledge: () => void;
  onChooseAdjustment: (id: GoalAdjustmentId) => void;
}

function trustBar(label: string, value: number): ReactNode {
  return (
    <div className="quarter-trust-row" key={label}>
      <span className="quarter-trust-label">{label}</span>
      <div className="quarter-trust-track">
        <div className="quarter-trust-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="quarter-trust-value">{value}</span>
    </div>
  );
}

export function QuarterReviewScreen({
  state,
  onAcknowledge,
  onChooseAdjustment,
}: QuarterReviewScreenProps) {
  const review = state.quarterReview;
  if (!review) return null;

  const { outcome, progress, missedReasons, availableAdjustments, trust } = review;
  const canWin = outcome === 'exceeded' || outcome === 'met';
  const canAdjust = outcome === 'missed_adjustable';
  const isTerminal =
    outcome === 'shutdown' || outcome === 'reorg_required' || outcome === 'missed_crisis';

  return (
    <div
      className="result-overlay quarter-review"
      data-testid="quarter-review"
      data-outcome={outcome}
      role="dialog"
      aria-label="Quarter Review"
    >
      <div className="result-card quarter-review-card">
        <p className="result-eyebrow">QUARTER REVIEW</p>
        <h2 className="quarter-review-title">
          Q{state.quarterNumber} 四半期レビュー — {OUTCOME_LABELS[outcome]}
        </h2>

        <div className="quarter-kpi-table" data-testid="quarter-kpi">
          <div className="quarter-kpi-header">
            <span>KPI</span>
            <span>目標</span>
            <span>実績</span>
            <span>判定</span>
          </div>
          {progress.map((kpi) => (
            <div className="quarter-kpi-row" key={kpi.id} data-kpi={kpi.id}>
              <span>{kpi.label}</span>
              <span>{kpi.target}</span>
              <span>{kpi.actual}</span>
              <span className={`kpi-badge kpi-${kpi.status}`}>
                {kpi.status === 'exceeded' ? '超過' : kpi.status === 'met' ? '達成' : '未達'}
              </span>
            </div>
          ))}
        </div>

        <div className="quarter-trust" data-testid="quarter-trust">
          <p className="result-section-label">ステークホルダー信頼</p>
          {trustBar('経営', trust.management)}
          {trustBar('顧客', trust.customers)}
          {trustBar('チーム', trust.team)}
        </div>

        {missedReasons.length > 0 && (
          <div className="quarter-reasons" data-testid="quarter-reasons">
            <p className="result-section-label">未達理由</p>
            <ul>
              {missedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {canAdjust && (
          <div className="quarter-adjustments" data-testid="quarter-adjustments">
            <p className="result-section-label">目標修正 — 次四半期へ継続</p>
            <div className="quarter-adjustment-grid">
              {availableAdjustments.map((id) => {
                const def = getGoalAdjustment(id);
                if (!def) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    className="quarter-adjustment-card"
                    data-adjustment={id}
                    onClick={() => onChooseAdjustment(id)}
                  >
                    <strong>{def.label}</strong>
                    <EffectTagList
                      tags={formatGoalAdjustmentTags(def, {
                        hasAiAdoptionTarget: review.goal.aiAdoptionTarget !== undefined,
                      })}
                      testId={`adjustment-tags-${id}`}
                    />
                    <span>{def.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="quarter-review-actions">
          {canWin && (
            <button
              type="button"
              className="btn primary"
              data-testid="quarter-acknowledge"
              onClick={onAcknowledge}
            >
              四半期を完遂
            </button>
          )}
          {isTerminal && (
            <button
              type="button"
              className="btn danger"
              data-testid="quarter-shutdown"
              onClick={onAcknowledge}
            >
              プロジェクト終了
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
