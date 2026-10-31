/**
 * 組織レバー案内の一度きり（#943 / #969）。
 *
 * RunBar は編成とスプリントでマウント位置が変わる。開いたことと、
 * 予算が 0 になったことはラン世代に紐づけて残す。
 * ショップで予算を温存しても消さない。
 */
import { shouldShowOrgLeverHint } from '../render/orgLeverHintView';

interface OrgLeverHintSession {
  epoch: number;
  dismissed: boolean;
}

let session: OrgLeverHintSession | null = null;

function sessionFor(epoch: number): OrgLeverHintSession {
  if (session?.epoch !== epoch) {
    session = { epoch, dismissed: false };
  }
  return session;
}

export function readOrgLeverHintSession(epoch: number): { dismissed: boolean } {
  const current = sessionFor(epoch);
  return { dismissed: current.dismissed };
}

export function dismissOrgLeverHint(epoch: number): void {
  sessionFor(epoch).dismissed = true;
}

/**
 * 予算が 0 以下なら、レバーを開いたときと同じくそのランでは案内を出さない。
 * リプレイの 0 は別ランの局面なので覚えない。正の予算では消さない。
 * 確定した描画の effect から呼ぶ。描画中に覚えると、捨てられた描画が残る。
 */
export function noteOrgLeverBudgetDepleted(epoch: number, budget: number, readOnly: boolean): void {
  if (readOnly || budget > 0) return;
  sessionFor(epoch).dismissed = true;
}

export interface ResolvedOrgLeverHint {
  show: boolean;
  dismissed: boolean;
}

/**
 * この描画で点と案内を出すか。
 * ライブの予算 0 はその場で消す。同じランで戻さない記録は noteOrgLeverBudgetDepleted が持つ。
 */
export function resolveOrgLeverHint(input: {
  epoch: number;
  quarterNumber: number;
  budget: number;
  readOnly: boolean;
  /** クリック直後など、この描画でレバーを開いた。 */
  opened?: boolean;
}): ResolvedOrgLeverHint {
  const depleted = !input.readOnly && input.budget <= 0;
  const dismissed =
    (input.opened ?? false) || depleted || readOrgLeverHintSession(input.epoch).dismissed;
  return {
    dismissed,
    show: shouldShowOrgLeverHint({
      quarterNumber: input.quarterNumber,
      budget: input.budget,
      dismissed,
      readOnly: input.readOnly,
    }),
  };
}

/** テスト間でラン世代の記憶を捨てる。 */
export function resetOrgLeverHintSession(): void {
  session = null;
}
