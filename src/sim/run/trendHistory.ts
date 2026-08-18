/**
 * 完了四半期の診断・KPIスナップショット（RI-128）。
 *
 * ボス完了時に append する純関数。診断アルゴリズムは呼ばず、渡された値を写す。
 */
import { generateIndustry } from '../orgscale/industry';
import type { OrgScaleState } from '../orgscale/types';
import type { DiagnosisType, GoalKpiProgress, QuarterTrendSnapshot } from './types';

export interface BuildQuarterTrendSnapshotInput {
  quarterNumber: number;
  diagnosis: DiagnosisType;
  kpis: readonly GoalKpiProgress[];
  orgScale: OrgScaleState;
}

/** 全社マップ集約と四半期 KPI から履歴1件を作る。 */
export function buildQuarterTrendSnapshot(
  input: BuildQuarterTrendSnapshotInput,
): QuarterTrendSnapshot {
  const industry = generateIndustry(input.orgScale, 'overall');
  return {
    quarterNumber: input.quarterNumber,
    diagnosis: input.diagnosis,
    kpis: input.kpis.map((kpi) => ({ ...kpi })),
    company: {
      shipping: input.orgScale.shipping,
      aiDependency: input.orgScale.aiDependency,
      techDebt: input.orgScale.techDebt,
      morale: input.orgScale.morale,
      onFire: input.orgScale.onFire,
      healthRank: input.orgScale.healthRank,
      selfRank: industry.selfRank,
    },
    departments: input.orgScale.departments.map((dept) => ({
      deptId: dept.def.id,
      aiDependency: dept.aiDependency,
      techDebt: dept.techDebt,
      morale: dept.morale,
      health: dept.health,
    })),
  };
}

/** セーブ欠落や共有参照を避けるための複製。配列でない入力は空履歴。 */
export function cloneTrendHistory(
  history: readonly QuarterTrendSnapshot[] | undefined,
): QuarterTrendSnapshot[] {
  if (!Array.isArray(history)) return [];
  return history.map((entry) => structuredClone(entry));
}
