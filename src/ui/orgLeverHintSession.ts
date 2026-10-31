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
/** 編成画面を開いた時点の案内行。同じ開封では後から行を足さない。 */
const rowAtOpen = new Map<string, boolean>();
let openSerial = 0;

function sessionFor(epoch: number): OrgLeverHintSession {
  if (session?.epoch !== epoch) {
    session = { epoch, dismissed: false, shopArrived: false };
  }
  return session;
}

/** マウントごとの開封トークン。編成を開き直すと別トークンになる。 */
export function createOrgLeverHintOpenToken(kind: 'setup' | 'formation'): string {
  openSerial += 1;
  return `${kind}:${openSerial}`;
}

/**
 * 開いた直後の判定をそのトークンに固定する。
 * 開いている途中で条件を満たしても true にはしない。
 */
export function orgLeverHintRowFromOpen(openToken: string, eligibleNow: boolean): boolean {
  const saved = rowAtOpen.get(openToken);
  if (saved !== undefined) return saved;
  rowAtOpen.set(openToken, eligibleNow);
  return eligibleNow;
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
  rowAtOpen.clear();
}
