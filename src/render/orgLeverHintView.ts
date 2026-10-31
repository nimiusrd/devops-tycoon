/**
 * Q1 の予算案内（#943 / #969）。
 *
 * 最安の組織レバー以上の予算があるとき、全社マップの入口を案内する。
 * 同じランで戻さないのは、レバーを一度開いたときと、予算が 0 になったときだけ。
 * ショップの提案で予算を温存しても消さない。予算の下限はレバー定義を正本にする。
 */
import { LEVER_DEFS } from '../data/levers';

/** 組織レバー定義の最安。これ未満ではレバーを発動できない。 */
export const MIN_ORG_LEVER_BUDGET = Math.min(...LEVER_DEFS.map((lever) => lever.cost));

export const ORG_LEVER_BUTTON_LABEL = '組織レバー';
export const ORG_LEVER_HINT_MESSAGE = '予算は組織レバーで使えます';

export interface OrgLeverHintDecisionInput {
  quarterNumber: number;
  budget: number;
  /** レバーを開いた、または予算が 0 になった。同じランでは戻さない。 */
  dismissed: boolean;
  readOnly: boolean;
}

/**
 * 案内を出すか。
 * Q1、予算が最安レバー以上、未消去、操作できるときだけ true。
 * 最安未満で 0 より大きい予算は、回復すれば再び出せる。0 と開封は dismissed が担う。
 */
export function shouldShowOrgLeverHint(input: OrgLeverHintDecisionInput): boolean {
  if (input.readOnly || input.dismissed) return false;
  if (input.quarterNumber !== 1) return false;
  return input.budget >= MIN_ORG_LEVER_BUDGET;
}
