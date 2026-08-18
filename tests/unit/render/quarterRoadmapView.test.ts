/**
 * 複数四半期ロードマップの表示導出（RI-131）。
 */
import { describe, expect, it } from 'vitest';
import { getGoalAdjustment } from '../../../src/data/goalAdjustments';
import {
  NO_CARRYOVER_CONSTRAINT,
  ROADMAP_ROLE_LABELS,
  quarterRoadmapView,
  shouldConfirmGoalAdjustment,
} from '../../../src/render/quarterRoadmapView';
import { pickQuarterBossId } from '../../../src/sim/run/quarterBoss';
import {
  previewNextQuarterDeliveryTarget,
  projectForwardGoals,
} from '../../../src/sim/run/quarterReview';
import type { QuarterGoal } from '../../../src/sim/run/types';

const goal: QuarterGoal = {
  deliveryTarget: 2000,
  qualityTarget: 45,
  techDebtLimit: 55,
  moraleTarget: 40,
  incidentLimit: 6,
  aiAdoptionTarget: 40,
};

describe('quarterRoadmapView (RI-131)', () => {
  it('修正なしは Q+1 / Q+2 の減衰見通しと物理キャリーなしを出す', () => {
    const { next, following } = projectForwardGoals(goal);
    const rows = quarterRoadmapView({ quarterNumber: 1, goal });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      quarterNumber: 2,
      horizon: 1,
      roleLabel: ROADMAP_ROLE_LABELS[1],
      preview: false,
      constraints: [NO_CARRYOVER_CONSTRAINT],
    });
    expect(rows[1]).toMatchObject({
      quarterNumber: 3,
      horizon: 2,
      roleLabel: ROADMAP_ROLE_LABELS[2],
      preview: false,
      constraints: [NO_CARRYOVER_CONSTRAINT],
    });
    expect(rows[0].kpis.find((kpi) => kpi.id === 'delivery')?.target).toBe(next.deliveryTarget);
    expect(rows[1].kpis.find((kpi) => kpi.id === 'delivery')?.target).toBe(
      following.deliveryTarget,
    );
    expect(rows[0].kpis.map((kpi) => kpi.id)).toEqual([
      'delivery',
      'quality',
      'techDebt',
      'morale',
      'incident',
      'aiAdoption',
    ]);
  });

  it('ホバー中の修正は Q+1 に goalEffects と持ち越し制約を載せ、Q+2 はキャリーなし', () => {
    const cut = getGoalAdjustment('cut_scope')!;
    const extend = getGoalAdjustment('extend_deadline')!;
    const budget = getGoalAdjustment('request_budget')!;

    const cutRows = quarterRoadmapView({ quarterNumber: 2, goal, adjustment: cut });
    expect(cutRows[0].preview).toBe(true);
    expect(cutRows[0].quarterNumber).toBe(3);
    expect(cutRows[0].kpis.find((kpi) => kpi.id === 'delivery')?.target).toBe(
      previewNextQuarterDeliveryTarget(goal.deliveryTarget, cut),
    );
    expect(cutRows[0].constraints).toEqual([NO_CARRYOVER_CONSTRAINT]);
    expect(cutRows[1].constraints).toEqual([NO_CARRYOVER_CONSTRAINT]);

    const extendRows = quarterRoadmapView({ quarterNumber: 1, goal, adjustment: extend });
    expect(extendRows[0].constraints).toEqual(['期限延長の持ち越し']);
    expect(extendRows[1].constraints).toEqual([NO_CARRYOVER_CONSTRAINT]);

    const budgetRows = quarterRoadmapView({ quarterNumber: 1, goal, adjustment: budget });
    expect(budgetRows[0].constraints).toEqual(['追加予算申請の持ち越し', '次期予算上限 -15']);
    expect(budgetRows[1].constraints).toEqual([NO_CARRYOVER_CONSTRAINT]);
  });

  it('AI Adoption 目標が無いときは行に出さない', () => {
    const { aiAdoptionTarget: _, ...withoutAi } = goal;
    const rows = quarterRoadmapView({ quarterNumber: 1, goal: withoutAi });
    expect(rows[0].kpis.some((kpi) => kpi.id === 'aiAdoption')).toBe(false);
  });

  it('次ボスが exec-review なら見通しに AI Adoption を出す', () => {
    const { aiAdoptionTarget: _, ...withoutAi } = goal;
    let seed = '';
    for (let i = 0; i < 8000; i += 1) {
      const candidate = `ri131-exec-${i}`;
      if (pickQuarterBossId(candidate, 2) === 'exec-review') {
        seed = candidate;
        break;
      }
    }
    expect(seed).not.toBe('');
    const rows = quarterRoadmapView({
      quarterNumber: 1,
      goal: withoutAi,
      seed,
      difficulty: 'normal',
    });
    expect(rows[0].kpis.find((kpi) => kpi.id === 'aiAdoption')?.target).toBe(40);
  });

  it('ホバー不可なら同じカードの2回目で確定する', () => {
    expect(
      shouldConfirmGoalAdjustment({
        hoverCapable: true,
        previewedId: null,
        clickedId: 'cut_scope',
      }),
    ).toBe(true);
    expect(
      shouldConfirmGoalAdjustment({
        hoverCapable: false,
        previewedId: null,
        clickedId: 'cut_scope',
      }),
    ).toBe(false);
    expect(
      shouldConfirmGoalAdjustment({
        hoverCapable: false,
        previewedId: 'extend_deadline',
        clickedId: 'cut_scope',
      }),
    ).toBe(false);
    expect(
      shouldConfirmGoalAdjustment({
        hoverCapable: false,
        previewedId: 'cut_scope',
        clickedId: 'cut_scope',
      }),
    ).toBe(true);
  });
});
