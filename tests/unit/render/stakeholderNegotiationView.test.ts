/**
 * ステークホルダー別交渉の表示導出（RI-130）。
 *
 * 提示集合は入力の availableAdjustments を並べ替えるだけ。
 * trustDelta 以外の条件種類を返し、姿勢は信頼の表示だけに使う。
 */
import { describe, expect, it } from 'vitest';
import {
  GOAL_ADJUSTMENT_DEFS,
  allGoalAdjustmentIds,
  getGoalAdjustment,
} from '../../../src/data/goalAdjustments';
import {
  NEGOTIATION_PANEL_ORDER,
  NEGOTIATION_TERM_KIND_LABELS,
  negotiationStance,
  negotiationTermKinds,
  planStakeholderNegotiation,
} from '../../../src/render/stakeholderNegotiationView';
import type { GoalAdjustmentId, StakeholderTrust } from '../../../src/sim/run/types';

const TRUST: StakeholderTrust = { management: 60, customers: 60, team: 60 };

function offerIds(panels: ReturnType<typeof planStakeholderNegotiation>): GoalAdjustmentId[] {
  return panels.flatMap((panel) => panel.offers.map((offer) => offer.id));
}

describe('planStakeholderNegotiation (RI-130)', () => {
  it('既存7種はいずれも交渉相手と trustDelta 以外の提示条件を持つ', () => {
    for (const def of GOAL_ADJUSTMENT_DEFS) {
      expect(def.negotiator, def.id).toBeDefined();
      const kinds = negotiationTermKinds(def);
      expect(kinds.length, def.id).toBeGreaterThan(0);
      expect(
        kinds.every((kind) => NEGOTIATION_TERM_KIND_LABELS[kind]),
        def.id,
      ).toBe(true);
    }
    expect(getGoalAdjustment('cut_scope')?.negotiator).toBe('customers');
    expect(getGoalAdjustment('extend_deadline')?.negotiator).toBe('management');
    expect(getGoalAdjustment('quality_pivot')?.negotiator).toBe('customers');
    expect(getGoalAdjustment('request_budget')?.negotiator).toBe('management');
    expect(getGoalAdjustment('pause_ai_rollout')?.negotiator).toBe('management');
    expect(getGoalAdjustment('reorg_teams')?.negotiator).toBe('team');
    expect(getGoalAdjustment('stakeholder_care')?.negotiator).toBe('all');
  });

  it('提示済み ID を交渉相手順に束ね、入力に無い ID は足さない', () => {
    const available = [
      'reorg_teams',
      'cut_scope',
      'request_budget',
    ] as const satisfies readonly GoalAdjustmentId[];
    const panels = planStakeholderNegotiation({
      availableAdjustments: available,
      trust: TRUST,
    });

    expect(panels.map((panel) => panel.negotiator)).toEqual(['management', 'customers', 'team']);
    expect(offerIds(panels)).toEqual(['request_budget', 'cut_scope', 'reorg_teams']);
    expect(new Set(offerIds(panels))).toEqual(new Set(available));
    expect(panels.some((panel) => panel.negotiator === 'all')).toBe(false);
  });

  it('パネル内の順は availableAdjustments を保つ', () => {
    const panels = planStakeholderNegotiation({
      availableAdjustments: ['pause_ai_rollout', 'extend_deadline', 'request_budget'],
      trust: TRUST,
    });
    expect(panels).toHaveLength(1);
    expect(panels[0]?.offers.map((offer) => offer.id)).toEqual([
      'pause_ai_rollout',
      'extend_deadline',
      'request_budget',
    ]);
  });

  it('空の提示集合は 0 件のまま', () => {
    expect(planStakeholderNegotiation({ availableAdjustments: [], trust: TRUST })).toEqual([]);
  });

  it('未知 ID は行を増やさない', () => {
    expect(
      planStakeholderNegotiation({
        availableAdjustments: ['unknown_adjustment' as GoalAdjustmentId],
        trust: TRUST,
      }),
    ).toEqual([]);
  });

  it('スコープ削減の提示条件は次期目標だけであり、信頼は含めない', () => {
    const kinds = negotiationTermKinds(getGoalAdjustment('cut_scope')!);
    expect(kinds).toEqual(['nextGoal']);
  });

  it('追加予算申請は予算・次期目標・次期予算上限・次四半期物理を条件にする', () => {
    expect(negotiationTermKinds(getGoalAdjustment('request_budget')!)).toEqual([
      'budget',
      'nextGoal',
      'nextBudgetCap',
      'nextQuarterPhysics',
    ]);
  });

  it('組織再編は予算・次期目標・組織状態・次四半期物理を条件にする', () => {
    expect(negotiationTermKinds(getGoalAdjustment('reorg_teams')!)).toEqual([
      'budget',
      'nextGoal',
      'orgState',
      'nextQuarterPhysics',
    ]);
  });

  it('姿勢は相手の現在信頼だけで変わり、提示 ID は変えない', () => {
    const available = allGoalAdjustmentIds();
    const hardline = planStakeholderNegotiation({
      availableAdjustments: available,
      trust: { management: 20, customers: 40, team: 70 },
    });
    const cooperative = planStakeholderNegotiation({
      availableAdjustments: available,
      trust: { management: 80, customers: 40, team: 70 },
    });

    expect(offerIds(hardline)).toEqual(available);
    expect(offerIds(cooperative)).toEqual(available);
    expect(hardline.map((panel) => panel.negotiator)).toEqual([...NEGOTIATION_PANEL_ORDER]);
    expect(hardline.find((panel) => panel.negotiator === 'management')?.stance).toBe('hardline');
    expect(cooperative.find((panel) => panel.negotiator === 'management')?.stance).toBe(
      'cooperative',
    );
    expect(hardline.find((panel) => panel.negotiator === 'customers')?.stance).toBe('cautious');
    expect(hardline.find((panel) => panel.negotiator === 'team')?.stance).toBe('cooperative');
    expect(hardline.find((panel) => panel.negotiator === 'all')?.stance).toBe('hardline');
  });

  it('三者協議の姿勢は最小信頼に合わせる', () => {
    expect(negotiationStance(25)).toBe('hardline');
    expect(negotiationStance(26)).toBe('cautious');
    expect(negotiationStance(50)).toBe('cautious');
    expect(negotiationStance(51)).toBe('cooperative');

    const panels = planStakeholderNegotiation({
      availableAdjustments: ['stakeholder_care'],
      trust: { management: 80, customers: 22, team: 90 },
    });
    expect(panels).toHaveLength(1);
    expect(panels[0]?.negotiator).toBe('all');
    expect(panels[0]?.stance).toBe('hardline');
    expect(panels[0]?.availabilityDemand).toContain('三者の信頼');
  });
});
