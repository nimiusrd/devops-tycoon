/**
 * 採用・ショップ購入の支払前確認（RI-147）。
 *
 * 支払後残高と、予算枯渇でランが終わるかを純粋な表示モデルにする。
 * 敗北閾値は `evaluateLose` と同じ `BUDGET_EXHAUSTED_CAP` を使い、価格と敗北ルールは変えない。
 */
import { BUDGET_EXHAUSTED_CAP } from '../sim/outcome';

export const SPEND_RUN_END_WARNING = '予算枯渇でランが終了する';

export type SpendBlock = 'bought' | 'rosterFull' | 'short';

export interface SpendRiskInput {
  budget: number;
  cost: number;
  bought?: boolean;
  rosterFull?: boolean;
}

export interface SpendRiskView {
  cost: number;
  budget: number;
  balanceAfter: number;
  blocked: SpendBlock | null;
  endsRun: boolean;
  requiresConfirm: boolean;
  balanceLabel: string | null;
  warningLabel: typeof SPEND_RUN_END_WARNING | null;
  shortLabel: string | null;
}

/** 支払う前に、残高・枯渇・購入不可を区別する。 */
export function spendRiskView(input: SpendRiskInput): SpendRiskView {
  const balanceAfter = input.budget - input.cost;
  const blocked: SpendBlock | null = input.bought
    ? 'bought'
    : input.rosterFull
      ? 'rosterFull'
      : input.budget < input.cost
        ? 'short'
        : null;
  const endsRun = blocked === null && balanceAfter <= BUDGET_EXHAUSTED_CAP;
  return {
    cost: input.cost,
    budget: input.budget,
    balanceAfter,
    blocked,
    endsRun,
    requiresConfirm: endsRun,
    balanceLabel: blocked === null ? `支払後の残高 💰${balanceAfter}` : null,
    warningLabel: endsRun ? SPEND_RUN_END_WARNING : null,
    shortLabel: blocked === 'short' ? `予算が足りません（💰${input.cost} 必要）` : null,
  };
}

/** 操作ボタンに出す説明。購入済みと満員は呼び出し側の既存文言を優先する。 */
export function spendStatusText(
  view: SpendRiskView,
  readyText: string,
  blockedText?: string,
): string {
  if (view.blocked === 'bought' || view.blocked === 'rosterFull') {
    return blockedText ?? readyText;
  }
  if (view.blocked === 'short') return view.shortLabel ?? readyText;
  if (view.endsRun && view.balanceLabel && view.warningLabel) {
    return `${view.balanceLabel}。${view.warningLabel}`;
  }
  if (view.balanceLabel) return `${view.balanceLabel}。${readyText}`;
  return readyText;
}
