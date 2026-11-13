import { describe, expect, it } from 'vitest';
import {
  formatHandExchangeVisibleStatus,
  handExchangeAnnouncementKey,
  handExchangeAnnouncementText,
  publishHandExchangeAnnouncement,
  resolveHandExchangeDisabledReason,
  shouldAnnounceHandExchangeStatus,
} from '../../../src/render/handExchangeStatusView';

const base = {
  exchangeUnavailableReason: undefined as string | undefined,
  paused: false,
  handLength: 0,
  exchangesUsed: 0,
  maxExchanges: 2,
  drawCount: 0,
  focus: 8,
  exchangeCost: 2,
};

describe('手札交換の利用不可理由', () => {
  it('一時停止中は手札0より優先する', () => {
    expect(
      resolveHandExchangeDisabledReason({
        ...base,
        paused: true,
        handLength: 0,
      }),
    ).toBe('一時停止中');
  });

  it('停止していないときだけ手札0を出す', () => {
    expect(resolveHandExchangeDisabledReason({ ...base, handLength: 0 })).toBe('手札がありません');
    expect(resolveHandExchangeDisabledReason({ ...base, handLength: 1, drawCount: 0 })).toBe(
      '山札に交換できるカードがありません',
    );
  });

  it('表示文言は理由と交換モードから組み立てる', () => {
    expect(formatHandExchangeVisibleStatus('一時停止中', false)).toBe('交換不可: 一時停止中');
    expect(formatHandExchangeVisibleStatus(undefined, true)).toBe('交換するカードを選択');
  });
});

describe('手札交換の読み上げキー', () => {
  it('理由が変わらない間は読み上げ更新を抑止する', () => {
    const paused = handExchangeAnnouncementKey('一時停止中', false);
    expect(shouldAnnounceHandExchangeStatus(paused, paused)).toBe(false);
    expect(
      shouldAnnounceHandExchangeStatus(
        paused,
        handExchangeAnnouncementKey('手札がありません', false),
      ),
    ).toBe(true);
  });

  it('読み上げ文はキーから1文に決まる', () => {
    expect(handExchangeAnnouncementText(handExchangeAnnouncementKey('一時停止中', false))).toBe(
      '交換不可: 一時停止中',
    );
    expect(
      handExchangeAnnouncementText(handExchangeAnnouncementKey('手札がありません', false)),
    ).toBe('交換不可: 手札がありません');
  });

  it('手札0で ❚❚ を押したとき live region への書き込みは理由が変わる1回だけ', () => {
    let last: string | null = null;
    const writes: string[] = [];
    const commit = (paused: boolean) => {
      const reason = resolveHandExchangeDisabledReason({
        ...base,
        paused,
        handLength: 0,
      });
      const key = handExchangeAnnouncementKey(reason, false);
      const next = publishHandExchangeAnnouncement(last, key);
      if (!next) return;
      last = next.lastSpokenKey;
      writes.push(next.text);
    };

    commit(false);
    commit(true);
    commit(true);
    expect(writes).toEqual(['交換不可: 手札がありません', '交換不可: 一時停止中']);
  });
});
