/**
 * ラン中 HUD の試練表示モデル。
 *
 * 適用中の試練 ID からラベル・説明・予算倍率を導出する純関数。
 * ライブは未知 ID を無視する（エンジンの budgetMul 積算と同じ）。
 * リプレイは記録時の定義（resolver）を優先する。
 */
import { getTrial } from '../data/difficulties';

export interface TrialHudView {
  id: string;
  label: string;
  description: string;
  budgetMul: number;
}

export type TrialHudResolver = (id: string) => TrialHudView | undefined;

/** 現行 `getTrial` から HUD 表示を作る。未知 ID は undefined。 */
export function resolveLiveTrial(id: string): TrialHudView | undefined {
  const def = getTrial(id);
  if (!def) return undefined;
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    budgetMul: def.budgetMul ?? 1,
  };
}

/** ラン中 HUD に出す試練。resolver が undefined を返した ID はスキップする。 */
export function trialHudViews(
  trialIds: readonly string[],
  resolveTrial: TrialHudResolver = resolveLiveTrial,
): TrialHudView[] {
  const views: TrialHudView[] = [];
  for (const id of trialIds) {
    const view = resolveTrial(id);
    if (!view) continue;
    views.push(view);
  }
  return views;
}

/** 開始予算を変える試練の HUD 詳細文。該当なしは undefined。 */
export function trialBudgetHudDetail(
  trialIds: readonly string[],
  resolveTrial: TrialHudResolver = resolveLiveTrial,
): string | undefined {
  const affecting = trialHudViews(trialIds, resolveTrial).filter((trial) => trial.budgetMul !== 1);
  if (affecting.length === 0) return undefined;
  return affecting.map((trial) => `試練「${trial.label}」で開始予算×${trial.budgetMul}`).join('、');
}

/** 予算 pill の title。試練で開始予算が変わるときは原因を添える。 */
export function budgetHudTitle(
  budgetDetail: string,
  trialIds: readonly string[],
  resolveTrial: TrialHudResolver = resolveLiveTrial,
): string {
  const trialDetail = trialBudgetHudDetail(trialIds, resolveTrial);
  return trialDetail ? `${budgetDetail}。${trialDetail}` : budgetDetail;
}
