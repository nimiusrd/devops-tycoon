/**
 * スプリント評価の読み方（出荷点を母数にした健全比）。
 *
 * `SprintResult` を読むだけの純関数。描画・状態は知らない（第22.2）。
 * 等級そのものは `computeGrade` が正本で、ここは危機が等級にどう効いたかを説明する。
 * 最終健全比は `evaluateSprintGrade` と同じ入力（安定介入ボーナス込み）を使う。
 */
import { SPRINT_BALANCE } from '../data/balance';
import { evaluateSprintGrade } from '../sim/sprintGrade';
import type { SprintResult } from '../sim/types';

export interface GradeBreakdownRow {
  label: string;
  value: string;
}

export interface SprintGradeView {
  /** 健全比を百分率に丸めた値。 */
  ratioPct: number;
  /** 等級のすぐ下に出す一文。 */
  caption: string;
  rows: GradeBreakdownRow[];
  tip: string;
}

function formatPoints(value: number): string {
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  if (value > 0) return `+${text}pt`;
  if (value < 0) return `−${text}pt`;
  return '±0pt';
}

function formatRatioDelta(value: number): string {
  const pct = Math.round(value * 1000) / 10;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  if (value > 0) return `+${text}%`;
  if (value < 0) return `−${text}%`;
  return '±0%';
}

type GradeRatioInput = Pick<
  SprintResult,
  | 'delivered'
  | 'rework'
  | 'incidents'
  | 'spread'
  | 'seniorHpDelta'
  | 'gradeRatio'
  | 'stabilizingBonus'
  | 'stabilizingGrants'
>;

function hpLossOf(result: Pick<SprintResult, 'seniorHpDelta'>): number {
  return Math.max(0, -result.seniorHpDelta);
}

/** 出荷・手戻り・障害・延焼・シニア消耗・安定介入から健全比を再構成する。 */
export function gradeRatioFromResult(result: GradeRatioInput): {
  ratio: number;
  stabilizingBonus: number;
  stabilizingGrants: number;
  penalties: { rework: number; incident: number; spread: number; hp: number; total: number };
} {
  const score = evaluateSprintGrade({
    delivered: result.delivered,
    reworkCount: result.rework,
    incidentCount: result.incidents,
    spread: result.spread,
    hpLoss: hpLossOf(result),
    stabilizingGrants: result.stabilizingGrants ?? 0,
  });
  return {
    ratio: result.gradeRatio ?? score.ratio,
    stabilizingBonus: result.stabilizingBonus ?? score.stabilizingBonus,
    stabilizingGrants: result.stabilizingGrants ?? 0,
    penalties: score.penalties,
  };
}

function isMajorCrisis(result: SprintResult, hpLoss: number): boolean {
  return (
    hpLoss >= SPRINT_BALANCE.titleSeniorBurnoutHpLoss.value ||
    result.spread >= SPRINT_BALANCE.titleSpreadMinimum.value ||
    result.incidents >= SPRINT_BALANCE.titleUnstableIncidents.value * 2
  );
}

function isHighGrade(grade: string): boolean {
  return grade === 'S' || grade === 'A' || grade === 'B';
}

function captionFor(result: SprintResult, ratioPct: number, majorCrisis: boolean): string {
  if (majorCrisis && isHighGrade(result.grade)) {
    return `大きな危機を出しつつ出荷した（健全比 ${ratioPct}%）`;
  }
  if (ratioPct < Math.round(SPRINT_BALANCE.gradeThresholdB.value * 100)) {
    return `出荷に対して手戻り・障害・消耗が重い（健全比 ${ratioPct}%）`;
  }
  return `出荷に対する健全比 ${ratioPct}%`;
}

function tipFor(majorCrisis: boolean, hasPenalty: boolean, hasBonus: boolean): string {
  if (majorCrisis) {
    return '等級は出荷点を母数にした健全比です。出荷が多いと、シニア消耗や障害のペナルティが比率としては小さく見えます。';
  }
  if (hasBonus) {
    return '実際に安定を付与した介入が健全比を押し上げています。条件未成立の火消しや残業号令は加点しません。';
  }
  if (!hasPenalty) {
    return '手戻り・障害・延焼・シニア消耗のペナルティが少なく、出荷の大半が健全比に残っています。';
  }
  return '手戻り・障害・延焼・シニア消耗を差し引いた健全比で S〜D を付けています。';
}

/** リザルト用の評価内訳ビューを導出する。 */
export function planSprintGradeView(result: SprintResult): SprintGradeView {
  const hpLoss = hpLossOf(result);
  const { ratio, penalties, stabilizingBonus, stabilizingGrants } = gradeRatioFromResult(result);
  const ratioPct = Math.round(ratio * 100);
  const totalPenalty = penalties.total;
  const majorCrisis = isMajorCrisis(result, hpLoss);
  const hasPenalty = totalPenalty > 0;
  const hasBonus = stabilizingBonus > 0;

  const rows: GradeBreakdownRow[] = [{ label: '出荷', value: `${result.delivered}pt` }];
  if (penalties.rework > 0) {
    rows.push({
      label: 'Rework',
      value: `${formatPoints(-penalties.rework)}（${result.rework}件）`,
    });
  }
  if (penalties.incident > 0) {
    rows.push({
      label: 'Incident',
      value: `${formatPoints(-penalties.incident)}（${result.incidents}件）`,
    });
  }
  if (penalties.spread > 0) {
    rows.push({
      label: '延焼',
      value: `${formatPoints(-penalties.spread)}（${result.spread}回）`,
    });
  }
  if (penalties.hp > 0) {
    rows.push({
      label: 'シニアHP',
      value: `${formatPoints(-penalties.hp)}（${result.seniorHpDelta}）`,
    });
  }
  if (hasBonus) {
    rows.push({
      label: '安定介入',
      value: `${formatRatioDelta(stabilizingBonus)}（${stabilizingGrants}回）`,
    });
  }
  rows.push({ label: '健全比', value: `${ratioPct}% → ${result.grade}` });

  return {
    ratioPct,
    caption: captionFor(result, ratioPct, majorCrisis),
    rows,
    tip: tipFor(majorCrisis, hasPenalty, hasBonus),
  };
}
