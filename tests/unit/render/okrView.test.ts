/**
 * 四半期 OKR の表示導出（RI-129）。
 *
 * テンプレートは既存 KPI の束ねであり、status を書き換えない。
 */
import { describe, expect, it } from 'vitest';
import { BOSS_DEFS } from '../../../src/data/bosses';
import {
  FALLBACK_OKR_TEMPLATE_ID,
  OKR_FOCUS_OBJECTIVE_ID,
  OKR_GUARDRAIL,
  OKR_KPI_IDS,
  OKR_TEMPLATES,
} from '../../../src/data/okrTemplates';
import { planOkrView } from '../../../src/render/okrView';
import type { GoalKpiProgress, QuarterGoal } from '../../../src/sim/run/types';

const GOAL: QuarterGoal = {
  deliveryTarget: 90,
  qualityTarget: 45,
  techDebtLimit: 55,
  moraleTarget: 40,
  incidentLimit: 6,
};

function progress(id: string, overrides: Partial<GoalKpiProgress> = {}): GoalKpiProgress {
  return {
    id,
    label: `${id}-label`,
    target: 10,
    actual: 11,
    status: 'met',
    ...overrides,
  };
}

function krIds(view: ReturnType<typeof planOkrView>): string[] {
  return view.objectives.flatMap((objective) => objective.keyResults.map((kr) => kr.id));
}

describe('planOkrView (RI-129)', () => {
  it('ボス4種はそれぞれ専用 templateId になる', () => {
    expect(planOkrView({ bossId: 'big-release', goal: GOAL }).templateId).toBe('ship-on-time');
    expect(planOkrView({ bossId: 'major-incident', goal: GOAL }).templateId).toBe(
      'contain-incidents',
    );
    expect(planOkrView({ bossId: 'security-audit', goal: GOAL }).templateId).toBe('audit-ready');
    expect(planOkrView({ bossId: 'exec-review', goal: GOAL }).templateId).toBe('ai-with-health');
  });

  it('未知のボスは大型リリース相当へフォールバックする', () => {
    const view = planOkrView({ bossId: 'unknown-boss', goal: GOAL });
    expect(view.templateId).toBe(FALLBACK_OKR_TEMPLATE_ID);
    expect(view.objectives[0]?.title).toBe(
      OKR_TEMPLATES.find((template) => template.id === FALLBACK_OKR_TEMPLATE_ID)?.focus.title,
    );
  });

  it('定義済みボスはいずれもテンプレートを持つ', () => {
    const bossIds = new Set(OKR_TEMPLATES.map((template) => template.bossId));
    expect(BOSS_DEFS.map((boss) => boss.id).every((id) => bossIds.has(id))).toBe(true);
  });

  it('既定目標では全 KPI が一度だけ出る', () => {
    const view = planOkrView({ bossId: 'big-release', goal: GOAL });
    const ids = krIds(view);
    expect(ids).toEqual(['delivery', 'incident', 'quality', 'techDebt', 'morale']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('AI Adoption は目標があるときだけ出す', () => {
    const without = planOkrView({ bossId: 'exec-review', goal: GOAL });
    expect(krIds(without)).not.toContain('aiAdoption');

    const withAi = planOkrView({
      bossId: 'exec-review',
      goal: { ...GOAL, aiAdoptionTarget: 40 },
    });
    expect(krIds(withAi)[0]).toBe('aiAdoption');
    expect(krIds(withAi)).toEqual([
      'aiAdoption',
      'morale',
      'quality',
      'delivery',
      'techDebt',
      'incident',
    ]);
    expect(new Set(krIds(withAi)).size).toBe(OKR_KPI_IDS.length);
  });

  it('経営レビュー以外でも AI Adoption 目標があればガードレールへ載せる', () => {
    const view = planOkrView({
      bossId: 'big-release',
      goal: { ...GOAL, aiAdoptionTarget: 30 },
    });
    const focus = view.objectives.find((objective) => objective.id === OKR_FOCUS_OBJECTIVE_ID);
    const guardrail = view.objectives.find((objective) => objective.id === OKR_GUARDRAIL.id);
    expect(focus?.keyResults.map((kr) => kr.id)).toEqual(['delivery', 'incident']);
    expect(guardrail?.keyResults.map((kr) => kr.id)).toContain('aiAdoption');
  });

  it('progress の status / target / actual / label を書き換えない', () => {
    const delivery = progress('delivery', {
      label: 'Delivery（四半期累計）',
      target: 90,
      actual: 70,
      status: 'missed',
    });
    const view = planOkrView({
      bossId: 'big-release',
      goal: GOAL,
      progress: [
        delivery,
        progress('quality', { status: 'exceeded', target: 45, actual: 60 }),
        progress('techDebt', { status: 'met', target: 55, actual: 40 }),
        progress('morale', { status: 'met', target: 40, actual: 41 }),
        progress('incident', { status: 'missed', target: 6, actual: 9, label: 'Incident' }),
      ],
    });
    const deliveryKr = view.objectives[0]?.keyResults[0];
    expect(deliveryKr).toEqual({
      id: 'delivery',
      label: 'Delivery（四半期累計）',
      target: 90,
      actual: 70,
      status: 'missed',
    });
    const incidentKr = view.objectives[0]?.keyResults[1];
    expect(incidentKr?.status).toBe('missed');
    expect(incidentKr?.label).toBe('Incident');
  });

  it('progress に無い KR はラベルだけの行にする', () => {
    const view = planOkrView({
      bossId: 'security-audit',
      goal: GOAL,
      progress: [progress('quality')],
    });
    const techDebt = view.objectives[0]?.keyResults.find((kr) => kr.id === 'techDebt');
    expect(techDebt).toEqual({ id: 'techDebt', label: 'Tech Debt' });
    expect(techDebt).not.toHaveProperty('status');
  });

  it('未知の progress id はガードレールへ足し、既存 KPI を隠さない', () => {
    const view = planOkrView({
      bossId: 'big-release',
      goal: GOAL,
      progress: [progress('customKpi', { label: 'Custom' })],
    });
    expect(krIds(view)).toContain('customKpi');
    expect(krIds(view)).toEqual([
      'delivery',
      'incident',
      'quality',
      'techDebt',
      'morale',
      'customKpi',
    ]);
  });
});
