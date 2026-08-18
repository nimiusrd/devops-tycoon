/**
 * 四半期レビューのステークホルダー別交渉（RI-130）。
 *
 * 導出は `planStakeholderNegotiation` に任せ、状態は読むだけ（第22.2）。
 * カードの効果タグは既存の `formatGoalAdjustmentTags` を維持する。
 */
import { useMemo } from 'react';
import { getGoalAdjustment } from '../data/goalAdjustments';
import { formatGoalAdjustmentTags } from '../render/eventOutcomeView';
import { planStakeholderNegotiation } from '../render/stakeholderNegotiationView';
import type { GoalAdjustmentId, StakeholderTrust } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';

export interface StakeholderNegotiationListProps {
  availableAdjustments: readonly GoalAdjustmentId[];
  trust: StakeholderTrust;
  hasAiAdoptionTarget: boolean;
  currentDeliveryTarget: number;
  onChooseAdjustment: (id: GoalAdjustmentId) => void;
  /** 見通しプレビュー用。ホバー/フォーカスで ID、離脱で null（RI-131）。 */
  onPreviewAdjustment?: (id: GoalAdjustmentId | null) => void;
}

export function StakeholderNegotiationList({
  availableAdjustments,
  trust,
  hasAiAdoptionTarget,
  currentDeliveryTarget,
  onChooseAdjustment,
  onPreviewAdjustment,
}: StakeholderNegotiationListProps) {
  const panels = useMemo(
    () => planStakeholderNegotiation({ availableAdjustments, trust }),
    [availableAdjustments, trust],
  );
  if (panels.length === 0) return null;

  return (
    <div className="quarter-adjustments" data-testid="quarter-adjustments">
      <p className="result-section-label">目標修正 — ステークホルダー別交渉</p>
      <div className="quarter-negotiation" data-testid="quarter-negotiation">
        {panels.map((panel) => (
          <section
            key={panel.negotiator}
            className="quarter-negotiation-panel"
            data-testid="quarter-negotiation-panel"
            data-negotiator={panel.negotiator}
            data-stance={panel.stance}
            aria-label={`${panel.label}との交渉`}
          >
            <header className="quarter-negotiation-header">
              <h3 className="quarter-negotiation-title">{panel.label}との交渉</h3>
              <span className="quarter-negotiation-stance" data-stance={panel.stance}>
                {panel.stanceLabel}
              </span>
            </header>
            <p className="quarter-negotiation-dialogue">{panel.dialogue}</p>
            <p className="quarter-negotiation-demand">{panel.availabilityDemand}</p>
            <div className="quarter-adjustment-grid">
              {panel.offers.map((offer) => {
                const def = getGoalAdjustment(offer.id);
                if (!def) return null;
                return (
                  <button
                    key={offer.id}
                    type="button"
                    className="quarter-adjustment-card"
                    data-adjustment={offer.id}
                    data-negotiator={offer.negotiator}
                    onClick={() => onChooseAdjustment(offer.id)}
                    onMouseEnter={() => onPreviewAdjustment?.(offer.id)}
                    onMouseLeave={() => onPreviewAdjustment?.(null)}
                    onFocus={() => onPreviewAdjustment?.(offer.id)}
                    onBlur={() => onPreviewAdjustment?.(null)}
                  >
                    <strong>{def.label}</strong>
                    <span
                      className="quarter-negotiation-terms"
                      data-testid={`negotiation-terms-${offer.id}`}
                    >
                      相手の条件: {offer.termKindLabels.join(' / ')}
                    </span>
                    <EffectTagList
                      tags={formatGoalAdjustmentTags(def, {
                        hasAiAdoptionTarget,
                        currentDeliveryTarget,
                      })}
                      testId={`adjustment-tags-${offer.id}`}
                    />
                    <span>{def.description}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
