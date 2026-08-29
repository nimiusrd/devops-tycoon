/**
 * スプリント評価の健全比（出荷点を母数にした outcome + 安定介入ボーナス）。
 *
 * `computeGrade` とリザルト内訳が同じ入力・同じ式を使うための正本。
 */
import { SPRINT_BALANCE } from '../data/balance';
import type { SprintGradePenalties } from './types';

export type { SprintGradePenalties } from './types';

export interface SprintGradeInput {
  delivered: number;
  reworkCount: number;
  incidentCount: number;
  spread: number;
  hpLoss: number;
  stabilizingGrants: number;
}

export interface SprintGradeScore {
  grade: string;
  /** ペナルティ後 + 安定介入ボーナスの最終健全比。 */
  ratio: number;
  /** ペナルティだけを差し引いた健全比。 */
  outcomeRatio: number;
  /** 安定介入ボーナス（0..cap）。 */
  stabilizingBonus: number;
  penalties: SprintGradePenalties;
}

const GRADE_THRESHOLDS = {
  S: SPRINT_BALANCE.gradeThresholdS.value,
  A: SPRINT_BALANCE.gradeThresholdA.value,
  B: SPRINT_BALANCE.gradeThresholdB.value,
  C: SPRINT_BALANCE.gradeThresholdC.value,
} as const;

const STABILIZING_ACTION_BONUS = SPRINT_BALANCE.stabilizingBonusPerGrant.value;
const MAX_STABILIZING_ACTION_BONUS = SPRINT_BALANCE.stabilizingBonusCap.value;

function gradeFromRatio(ratio: number): string {
  if (ratio >= GRADE_THRESHOLDS.S) return 'S';
  if (ratio >= GRADE_THRESHOLDS.A) return 'A';
  if (ratio >= GRADE_THRESHOLDS.B) return 'B';
  if (ratio >= GRADE_THRESHOLDS.C) return 'C';
  return 'D';
}

/** 出荷・危機ペナルティ・安定介入から評価と健全比を算出する。 */
export function evaluateSprintGrade(input: SprintGradeInput): SprintGradeScore {
  const penalties = {
    rework: input.reworkCount * SPRINT_BALANCE.gradePenaltyRework.value,
    incident: input.incidentCount * SPRINT_BALANCE.gradePenaltyIncident.value,
    spread: input.spread * SPRINT_BALANCE.gradePenaltySpread.value,
    hp:
      Math.max(0, input.hpLoss - SPRINT_BALANCE.gradePenaltyHpLossFree.value) *
      SPRINT_BALANCE.gradePenaltyHpLossMultiplier.value,
  };
  const total = penalties.rework + penalties.incident + penalties.spread + penalties.hp;
  const base = Math.max(1, input.delivered);
  const outcomeRatio = (input.delivered - total) / base;
  const stabilizingBonus = Math.min(
    MAX_STABILIZING_ACTION_BONUS,
    Math.max(0, input.stabilizingGrants) * STABILIZING_ACTION_BONUS,
  );
  const ratio = outcomeRatio + stabilizingBonus;
  return {
    grade: gradeFromRatio(ratio),
    ratio,
    outcomeRatio,
    stabilizingBonus,
    penalties: { ...penalties, total },
  };
}
