/**
 * 複数四半期ロードマップの表示用導出（RI-131）。
 *
 * 拘束力は持たない見通し。sim・保存・勝敗契約は知らない純関数。
 */
import type { GoalAdjustmentDef } from '../data/goalAdjustments';
import { hasNextQuarterCarryover, projectForwardGoals } from '../sim/run/quarterReview';
import type { QuarterGoal } from '../sim/run/types';

export const ROADMAP_ROLE_LABELS = {
  1: '次期',
  2: 'その次',
} as const;

export const NO_CARRYOVER_CONSTRAINT = '物理キャリーなし';

export interface QuarterRoadmapKpi {
  id: string;
  label: string;
  target: number;
}

export interface QuarterRoadmapRow {
  quarterNumber: number;
  horizon: 1 | 2;
  roleLabel: string;
  kpis: QuarterRoadmapKpi[];
  constraints: string[];
  preview: boolean;
}

export interface QuarterRoadmapViewInput {
  quarterNumber: number;
  goal: QuarterGoal;
  adjustment?: GoalAdjustmentDef;
}

function goalKpis(goal: QuarterGoal): QuarterRoadmapKpi[] {
  const kpis: QuarterRoadmapKpi[] = [
    { id: 'delivery', label: 'Delivery', target: goal.deliveryTarget },
    { id: 'quality', label: 'Quality', target: goal.qualityTarget },
    { id: 'techDebt', label: 'Tech Debt', target: goal.techDebtLimit },
    { id: 'morale', label: 'Morale', target: goal.moraleTarget },
    { id: 'incident', label: 'Incident', target: goal.incidentLimit },
  ];
  if (goal.aiAdoptionTarget !== undefined) {
    kpis.push({ id: 'aiAdoption', label: 'AI Adoption', target: goal.aiAdoptionTarget });
  }
  return kpis;
}

function formatSignedDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function constraintsFor(def: GoalAdjustmentDef | undefined, horizon: 1 | 2): string[] {
  if (horizon === 2) return [NO_CARRYOVER_CONSTRAINT];
  if (!def) return [NO_CARRYOVER_CONSTRAINT];
  const out: string[] = [];
  if (hasNextQuarterCarryover(def)) out.push(`${def.label}の持ち越し`);
  if (def.nextBudgetCapDelta !== undefined && def.nextBudgetCapDelta !== 0) {
    out.push(`次期予算上限 ${formatSignedDelta(def.nextBudgetCapDelta)}`);
  }
  if (out.length === 0) out.push(NO_CARRYOVER_CONSTRAINT);
  return out;
}

/** Q+1 / Q+2 の見通し行を作る。`adjustment` があるときだけその goalEffects を載せる。 */
export function quarterRoadmapView(input: QuarterRoadmapViewInput): QuarterRoadmapRow[] {
  const preview = input.adjustment !== undefined;
  const { next, following } = projectForwardGoals(input.goal, input.adjustment);
  return [
    {
      quarterNumber: input.quarterNumber + 1,
      horizon: 1,
      roleLabel: ROADMAP_ROLE_LABELS[1],
      kpis: goalKpis(next),
      constraints: constraintsFor(input.adjustment, 1),
      preview,
    },
    {
      quarterNumber: input.quarterNumber + 2,
      horizon: 2,
      roleLabel: ROADMAP_ROLE_LABELS[2],
      kpis: goalKpis(following),
      constraints: constraintsFor(input.adjustment, 2),
      preview,
    },
  ];
}
