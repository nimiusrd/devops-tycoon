/**
 * ボスカードのプレイヤー向け説明（#1011）。
 * 突破条件は `BossDef.clear`、ラン終了は `evaluateLose` / `evaluateBoss` と同じ定義から組む。
 */
import type { BossClearCheck, BossDef } from './bosses';
import { getDifficulty } from './difficulties';
import { REVIEW_FREEZE_LOSE_NAME, reviewFreezePeakCap } from '../sim/reviewFreezeLabels';
import {
  MORALE_LOSE_MAX,
  REVIEW_FREEZE_PEAK,
  SENIOR_HP_LOSE_MAX,
  TECH_DEBT_CAP,
} from '../sim/outcome';
import type { DifficultyId } from '../sim/types';

const BOSS_FLAVOR: Record<string, string> = {
  'big-release': 'タスク量が多い大型リリースの山場。',
  'major-incident': '炎上が連続する本番障害の山場。',
  'security-audit': '品質と技術的負債が問われる監査の山場。',
  'exec-review': 'AI 利用と組織健全性が問われる経営レビューの山場。',
};

function formatClearClause(check: BossClearCheck, bossTargetMul: number): string[] {
  const lines: string[] = [];
  if (check.minSprintDelivered !== undefined) {
    const target = Math.ceil(check.minSprintDelivered * bossTargetMul);
    lines.push(`スプリント出荷 ${target}pt 以上`);
  }
  if (check.maxSpread !== undefined) {
    lines.push(`延焼 ${check.maxSpread} 回以下`);
  }
  if (check.maxTechDebt !== undefined) {
    lines.push(`Tech Debt ${check.maxTechDebt} 以下`);
  }
  if (check.minAiPct !== undefined) {
    lines.push(`AI 利用率 ${check.minAiPct}% 以上`);
  }
  if (check.minMorale !== undefined) {
    lines.push(`Morale ${check.minMorale} 以上`);
  }
  if (check.minQuality !== undefined) {
    lines.push(`Quality ${check.minQuality} 以上`);
  }
  return lines;
}

function formatRunLoseClauses(): string[] {
  return [
    `レビュー待ちピーク ${reviewFreezePeakCap()} 件以上で${REVIEW_FREEZE_LOSE_NAME}`,
    `シニア体力 ${SENIOR_HP_LOSE_MAX} 以下でシニア燃え尽き`,
    `士気 ${MORALE_LOSE_MAX} 以下でチーム崩壊`,
    `Tech Debt ${TECH_DEBT_CAP} 以上で開発停止`,
  ];
}

/**
 * 難易度倍率を反映したボス説明。表示メタは bosses.ts に持たずここで組み立てる。
 */
export function planBossPlayerDescription(
  boss: Pick<BossDef, 'id' | 'clear'>,
  difficulty: DifficultyId = 'normal',
): string {
  const bossTargetMul = getDifficulty(difficulty).bossTargetMul;
  const flavor = BOSS_FLAVOR[boss.id] ?? '四半期末の試練。';
  const clearParts = formatClearClause(boss.clear, bossTargetMul);
  const loseParts = formatRunLoseClauses();
  const clearText =
    clearParts.length > 0 ? `突破: ${clearParts.join('・')}。` : '突破条件は四半期目標に従う。';
  const loseText = `ボス中も ${loseParts.slice(0, 2).join('、')} などでラン終了しうる。`;
  return `${flavor} ${clearText} ${loseText}`;
}

/** 説明文が参照するシミュレーション閾値（テスト用）。 */
export const BOSS_DESCRIPTION_SIM_ANCHORS = {
  reviewFreezePeak: REVIEW_FREEZE_PEAK,
  seniorHpLose: SENIOR_HP_LOSE_MAX,
  moraleLose: MORALE_LOSE_MAX,
  techDebtCap: TECH_DEBT_CAP,
} as const;
