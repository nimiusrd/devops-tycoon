import { getAction } from '../data/actions';
import {
  ANDON_BASE_MORALE_COST,
  ANDON_HP_COST,
  ANDON_THIN_MORALE_COST,
  ANDON_TICKS,
  INTERRUPT_HP_COST,
  isAndonReviewCongested,
} from '../sim/actions';
import type { OrgState, SprintState } from '../sim/types';
import {
  deriveActionAvailability,
  planActionPresentation,
  type ActionBarDisabledReason,
} from './actionBarView';

export const REVIEW_COMMAND_PANEL_ID = 'review-command-panel';
export const REVIEW_COMMAND_ACTIONS = ['interruptReview', 'pairReview', 'andon'] as const;
export type ReviewCommandAction = (typeof REVIEW_COMMAND_ACTIONS)[number];

export function planReviewCommand(
  sprint: SprintState,
  org: OrgState,
  tick: number,
  id: ReviewCommandAction,
  disabledReason?: ActionBarDisabledReason,
) {
  const action = getAction(id)!;
  const presentation = planActionPresentation(sprint, id);
  const availability = deriveActionAvailability(sprint, id, disabledReason, org, tick);
  const { targetCount } = availability;
  const thinQueue = id === 'andon' && !isAndonReviewCongested(sprint);
  let effect = presentation.effect;
  let tradeoff = presentation.tradeoff;

  switch (id) {
    case 'interruptReview':
      effect += `（現在 ${targetCount}件）`;
      tradeoff = `レビュー処理分のシニアHP＋割り込み分 最大${INTERRUPT_HP_COST}`;
      break;
    case 'pairReview':
      effect =
        targetCount === 0
          ? 'AI習熟＋運用安定（レビュー処理なし）'
          : `${effect}（現在 ${targetCount}件）`;
      if (targetCount > 0) tradeoff = 'レビュー処理分のシニアHP・再使用待ち';
      break;
    case 'andon': {
      effect += `（${ANDON_TICKS} tick）`;
      const moraleCost = ANDON_BASE_MORALE_COST + (thinQueue ? ANDON_THIN_MORALE_COST : 0);
      const hpCost = thinQueue ? `・シニアHP 最大${ANDON_HP_COST}` : '';
      tradeoff = `士気 最大${moraleCost}${hpCost}・出荷機会の減少`;
      break;
    }
  }

  return {
    action,
    availability,
    targetLabel: presentation.targetLabel,
    effect,
    tradeoff,
    cooldownRemaining: sprint.cooldowns[id] ?? 0,
    // 工程に対する操作なので、同じ件数・代償なら現在の先頭から処理する。
    confirmationKey: `${targetCount}:${thinQueue}`,
  };
}
