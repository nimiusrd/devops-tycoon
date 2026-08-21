/**
 * 四半期レビュー / 目標修正画面（SPEC 第4.6.1）。
 *
 * 勝敗画面ではなくレビュー会議として、OKR・目標達成度・信頼・未達理由・修正選択肢を表示する。
 */
import { useState, type ReactNode } from 'react';
import { getGoalAdjustment } from '../data/goalAdjustments';
import { OUTCOME_LABELS } from '../sim/run/quarterReview';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import { QuarterOkr } from './QuarterOkr';
import { QuarterRoadmap } from './QuarterRoadmap';
import { RewardCeremony } from './JuicyEffects';
import { ReviewHistoryList } from './ReviewHistoryList';
import { StakeholderNegotiationList } from './StakeholderNegotiationList';
import { useReplayContent } from './replayContent';

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
  const [previewAdjustmentId, setPreviewAdjustmentId] = useState<GoalAdjustmentId | null>(null);
  const { resolveRelic } = useReplayContent();
  const review = state.quarterReview;
  if (!review) return null;

  const { outcome, progress, missedReasons, availableAdjustments, trust } = review;
  const canWin = outcome === 'exceeded' || outcome === 'met';
  const canAdjust = outcome === 'missed_adjustable';
  const isTerminal =
    outcome === 'shutdown' || outcome === 'reorg_required' || outcome === 'missed_crisis';
  const bossRelic = state.bossRelicReward ? resolveRelic(state.bossRelicReward) : undefined;
  const previewAdjustment =
    canAdjust && previewAdjustmentId ? getGoalAdjustment(previewAdjustmentId) : undefined;

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

        <ReviewHistoryList reviewHistory={state.reviewHistory} quarterReview={review} />

        {canAdjust ? (
          <QuarterRoadmap
            quarterNumber={state.quarterNumber}
            goal={review.goal}
            seed={state.seed}
            difficulty={state.difficulty}
            adjustment={previewAdjustment}
          />
        ) : null}

        <QuarterOkr variant="review" bossId={state.bossId} goal={review.goal} progress={progress} />

        <div className="quarter-trust" data-testid="quarter-trust">
          <p className="result-section-label">ステークホルダー信頼</p>
          {trustBar('経営', trust.management)}
          {trustBar('顧客', trust.customers)}
          {trustBar('チーム', trust.team)}
        </div>

        {bossRelic && (
          <div className="result-diagnosis" data-testid="boss-relic-reward">
            <p className="result-section-label">ボス突破報酬</p>
            <RewardCeremony
              kind="relic"
              title={`${bossRelic.name} を獲得`}
              detail="組織に新しい文化が宿った"
            />
            <p className="diagnosis-type">◆ {bossRelic.name}</p>
            <p>{bossRelic.description}</p>
          </div>
        )}

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
          <StakeholderNegotiationList
            availableAdjustments={availableAdjustments}
            trust={trust}
            hasAiAdoptionTarget={review.goal.aiAdoptionTarget !== undefined}
            currentDeliveryTarget={review.goal.deliveryTarget}
            previewedAdjustmentId={previewAdjustmentId}
            onChooseAdjustment={onChooseAdjustment}
            onPreviewAdjustment={setPreviewAdjustmentId}
          />
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
