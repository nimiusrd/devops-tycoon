/**
 * 完了四半期の診断・KPIスナップショット（RI-128）。
 *
 * ボス完了時に append する純関数。診断アルゴリズムは呼ばず、渡された値を写す。
 */
import { generateIndustry, RANKING_KINDS } from '../orgscale/industry';
import type { OrgScaleState, RankingKind } from '../orgscale/types';
import type { DiagnosisType, GoalKpiProgress, QuarterTrendSnapshot } from './types';

export interface BuildQuarterTrendSnapshotInput {
  quarterNumber: number;
  diagnosis: DiagnosisType;
  kpis: readonly GoalKpiProgress[];
  orgScale: OrgScaleState;
}

function selfRanksFor(orgScale: OrgScaleState): Record<RankingKind, number> {
  const ranks = {} as Record<RankingKind, number>;
  for (const kind of RANKING_KINDS) {
    ranks[kind] = generateIndustry(orgScale, kind).selfRank;
  }
  return ranks;
}

/** 全社マップ集約と四半期 KPI から履歴1件を作る。 */
export function buildQuarterTrendSnapshot(
  input: BuildQuarterTrendSnapshotInput,
): QuarterTrendSnapshot {
  const selfRanks = selfRanksFor(input.orgScale);
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
      selfRank: selfRanks.overall,
      selfRanks,
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

/**
 * 趨勢比較の基準になる直近スナップショット。
 * 表示中四半期が末尾なら、確定直後の自己比較を避けるため一つ前を使う。
 */
export function previousTrendSnapshot(
  history: readonly QuarterTrendSnapshot[],
  quarterNumber: number,
): QuarterTrendSnapshot | undefined {
  const last = history[history.length - 1];
  if (!last) return undefined;
  if (last.quarterNumber === quarterNumber) return history[history.length - 2];
  return last;
}

/** 指定ランキング種別の、比較元となる自社順位。種別の記録が無ければ総合のみ使う。 */
export function previousSelfRankForKind(
  history: readonly QuarterTrendSnapshot[],
  quarterNumber: number,
  kind: RankingKind,
): number | undefined {
  const previous = previousTrendSnapshot(history, quarterNumber);
  if (!previous) return undefined;
  return (
    previous.company.selfRanks?.[kind] ??
    (kind === 'overall' ? previous.company.selfRank : undefined)
  );
}

/** セーブ欠落や共有参照を避けるための複製。配列でない入力は空履歴。 */
export function cloneTrendHistory(
  history: readonly QuarterTrendSnapshot[] | undefined,
): QuarterTrendSnapshot[] {
  if (!Array.isArray(history)) return [];
  return history.map((entry) => structuredClone(entry));
}
