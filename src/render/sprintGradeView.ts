/**
 * スプリント評価の読み方（出荷点を母数にした健全比）。
 *
 * `SprintResult` を読むだけの純関数。描画・状態は知らない（第22.2）。
 * 等級そのものは記録済み `grade` / `gradeRatio` を正本にし、減点内訳も記録値だけを出す。
 */
import { SPRINT_BALANCE } from '../data/balance';
import type { SprintGradePenalties, SprintResult } from '../sim/types';

export interface GradeBreakdownRow {
  label: string;
  value: string;
}

export interface SprintGradeView {
  /** 記録済み健全比を百分率に丸めた値。旧データは省略。 */
  ratioPct: number | undefined;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hpLossOf(result: Pick<SprintResult, 'seniorHpDelta' | 'seniorHpLoss'>): number {
  if (typeof result.seniorHpLoss === 'number' && Number.isFinite(result.seniorHpLoss)) {
    return Math.max(0, result.seniorHpLoss);
  }
  return Math.max(0, -result.seniorHpDelta);
}

function recordedRatioOf(result: SprintResult): number | undefined {
  return isFiniteNumber(result.gradeRatio) ? result.gradeRatio : undefined;
}

function recordedBonusOf(result: SprintResult): { bonus: number; grants: number } | undefined {
  if (!isFiniteNumber(result.stabilizingBonus)) return undefined;
  if (
    typeof result.stabilizingGrants !== 'number' ||
    !Number.isFinite(result.stabilizingGrants) ||
    !Number.isInteger(result.stabilizingGrants) ||
    result.stabilizingGrants < 0
  ) {
    return undefined;
  }
  return { bonus: result.stabilizingBonus, grants: result.stabilizingGrants };
}

function recordedPenaltiesOf(result: SprintResult): SprintGradePenalties | undefined {
  const penalties = result.gradePenalties;
  if (!penalties) return undefined;
  if (
    !isFiniteNumber(penalties.rework) ||
    !isFiniteNumber(penalties.incident) ||
    !isFiniteNumber(penalties.spread) ||
    !isFiniteNumber(penalties.hp) ||
    !isFiniteNumber(penalties.total)
  ) {
    return undefined;
  }
  return penalties;
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

function isBelowGradeB(result: SprintResult, ratio: number | undefined): boolean {
  if (typeof ratio === 'number') {
    return ratio < SPRINT_BALANCE.gradeThresholdB.value;
  }
  return result.grade === 'C' || result.grade === 'D';
}

function formatRatioLabel(ratioPct: number | undefined, grade: string): string {
  if (typeof ratioPct === 'number') return `健全比 ${ratioPct}%`;
  return `評価 ${grade}`;
}

function captionFor(
  result: SprintResult,
  ratio: number | undefined,
  ratioPct: number | undefined,
  majorCrisis: boolean,
): string {
  const ratioLabel = formatRatioLabel(ratioPct, result.grade);
  if (result.delivered === 0) {
    return typeof ratioPct === 'number'
      ? `未出荷のスプリントです（健全比 ${ratioPct}%）`
      : '未出荷のスプリントです';
  }
  if (majorCrisis && isHighGrade(result.grade)) {
    return `大きな危機を出しつつ出荷した（${ratioLabel}）`;
  }
  if (isBelowGradeB(result, ratio)) {
    return `出荷に対して手戻り・障害・消耗が重い（${ratioLabel}）`;
  }
  return `出荷に対する${ratioLabel}`;
}

function tipFor(
  result: SprintResult,
  majorCrisis: boolean,
  hasPenalty: boolean,
  hasBonus: boolean,
  hasRecordedPenalties: boolean,
  hasRecordedRatio: boolean,
): string {
  if (result.delivered === 0) {
    return '出荷点が 0 のため健全比の母数が立っていません。未出荷は危機の重さではなく、等級の母数がない状態です。';
  }
  if (!hasRecordedPenalties) {
    if (!hasRecordedRatio) {
      return 'このリザルトには評価内訳の記録がありません。等級は保存当時の評価です。';
    }
    return '減点内訳は記録されていないため、保存済みの健全比と等級を表示しています。';
  }
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
  const ratio = recordedRatioOf(result);
  const bonus = recordedBonusOf(result);
  const penalties = recordedPenaltiesOf(result);
  const ratioPct = typeof ratio === 'number' ? Math.round(ratio * 100) : undefined;
  const majorCrisis = isMajorCrisis(result, hpLoss);
  const hasPenalty = penalties !== undefined && penalties.total > 0;
  const hasBonus = bonus !== undefined && bonus.bonus > 0;

  const rows: GradeBreakdownRow[] = [{ label: '出荷', value: `${result.delivered}pt` }];
  if (penalties) {
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
  }
  if (hasBonus && bonus) {
    rows.push({
      label: '安定介入',
      value: `${formatRatioDelta(bonus.bonus)}（${bonus.grants}回）`,
    });
  }
  if (typeof ratioPct === 'number') {
    rows.push({ label: '健全比', value: `${ratioPct}% → ${result.grade}` });
  } else {
    rows.push({ label: '評価', value: result.grade });
  }

  return {
    ratioPct,
    caption: captionFor(result, ratio, ratioPct, majorCrisis),
    rows,
    tip: tipFor(
      result,
      majorCrisis,
      hasPenalty,
      hasBonus,
      penalties !== undefined,
      ratio !== undefined,
    ),
  };
}
