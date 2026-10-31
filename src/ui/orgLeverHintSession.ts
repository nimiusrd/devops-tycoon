/**
 * 組織レバー案内の一度きり（#943）。
 *
 * RunBar は編成とスプリントでマウント位置が変わる。開いたことと、
 * ショップ抽選が当たったことはラン世代に紐づけて残す。
 */
interface OrgLeverHintSession {
  epoch: number;
  dismissed: boolean;
  shopArrived: boolean;
}

let session: OrgLeverHintSession | null = null;

function sessionFor(epoch: number): OrgLeverHintSession {
  if (session?.epoch !== epoch) {
    session = { epoch, dismissed: false, shopArrived: false };
  }
  return session;
}

export function readOrgLeverHintSession(epoch: number): {
  dismissed: boolean;
  shopArrived: boolean;
} {
  const current = sessionFor(epoch);
  return { dismissed: current.dismissed, shopArrived: current.shopArrived };
}

export function dismissOrgLeverHint(epoch: number): void {
  sessionFor(epoch).dismissed = true;
}

export function noteOrgLeverShopArrived(epoch: number): void {
  sessionFor(epoch).shopArrived = true;
}

/** テスト間でラン世代の記憶を捨てる。 */
export function resetOrgLeverHintSession(): void {
  session = null;
}
