/**
 * 手札交換の利用不可理由と読み上げ文言（#1024）。
 *
 * 理由は同時に複数あっても優先度で1つにまとめる。読み上げは理由キーが変わったときだけ更新する。
 */

export interface HandExchangeStatusInput {
  exchangeUnavailableReason?: string;
  paused: boolean;
  handLength: number | undefined;
  exchangesUsed: number;
  maxExchanges: number;
  drawCount: number;
  focus: number;
  exchangeCost: number;
}

/** 交換を始められない理由。優先度は上から順。 */
export function resolveHandExchangeDisabledReason(
  input: HandExchangeStatusInput,
): string | undefined {
  if (input.exchangeUnavailableReason != null && input.exchangeUnavailableReason !== '') {
    return input.exchangeUnavailableReason;
  }
  if (input.paused) return '一時停止中';
  if (input.handLength === 0) return '手札がありません';
  if (input.exchangesUsed >= input.maxExchanges) return 'このスプリントの交換上限です';
  if (input.drawCount <= 0) return '山札に交換できるカードがありません';
  if (input.focus < input.exchangeCost) {
    return `集中力不足（${input.exchangeCost}必要）`;
  }
  return undefined;
}

export function formatHandExchangeVisibleStatus(
  disabledReason: string | undefined,
  isExchangeMode: boolean,
): string | undefined {
  if (disabledReason) return `交換不可: ${disabledReason}`;
  if (isExchangeMode) return '交換するカードを選択';
  return undefined;
}

/** 読み上げ重複を避けるための安定キー。 */
export function handExchangeAnnouncementKey(
  disabledReason: string | undefined,
  isExchangeMode: boolean,
): string {
  if (disabledReason) return `disabled:${disabledReason}`;
  if (isExchangeMode) return 'select';
  return '';
}

export function handExchangeAnnouncementText(key: string): string {
  if (key.startsWith('disabled:')) {
    return `交換不可: ${key.slice('disabled:'.length)}`;
  }
  if (key === 'select') return '交換するカードを選択';
  return '';
}

export function shouldAnnounceHandExchangeStatus(previousKey: string, nextKey: string): boolean {
  return previousKey !== nextKey;
}

/** live region に書き込むべき次の文。キーが同じなら null。 */
export function publishHandExchangeAnnouncement(
  lastSpokenKey: string | null,
  nextKey: string,
): { lastSpokenKey: string; text: string } | null {
  if (!shouldAnnounceHandExchangeStatus(lastSpokenKey ?? '', nextKey)) return null;
  return { lastSpokenKey: nextKey, text: handExchangeAnnouncementText(nextKey) };
}
