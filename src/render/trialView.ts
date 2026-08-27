/**
 * ラン中 HUD の試練表示モデル。
 *
 * 適用中の試練 ID からラベル・説明・予算倍率を導出する純関数。
 * 未知 ID は無視する（エンジンの budgetMul 積算と同じ）。
 */
import { getTrial } from '../data/difficulties';

export interface TrialHudView {
  id: string;
  label: string;
  description: string;
  budgetMul: number;
}

/** ラン中 HUD に出す試練。未知 ID はスキップする。 */
export function trialHudViews(trialIds: readonly string[]): TrialHudView[] {
  const views: TrialHudView[] = [];
  for (const id of trialIds) {
    const def = getTrial(id);
    if (!def) continue;
    views.push({
      id: def.id,
      label: def.label,
      description: def.description,
      budgetMul: def.budgetMul ?? 1,
    });
  }
  return views;
}

/** 開始予算を変える試練の HUD 詳細文。該当なしは undefined。 */
export function trialBudgetHudDetail(trialIds: readonly string[]): string | undefined {
  const affecting = trialHudViews(trialIds).filter((trial) => trial.budgetMul !== 1);
  if (affecting.length === 0) return undefined;
  return affecting.map((trial) => `試練「${trial.label}」で開始予算×${trial.budgetMul}`).join('、');
}

/** 予算 pill の title。試練で開始予算が変わるときは原因を添える。 */
export function budgetHudTitle(budgetDetail: string, trialIds: readonly string[]): string {
  const trialDetail = trialBudgetHudDetail(trialIds);
  return trialDetail ? `${budgetDetail}。${trialDetail}` : budgetDetail;
}
