import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { getRelic } from '../../../src/data/relics';
import { createReplayContentResolver } from '../../../src/ui/replayContent';

describe('リプレイ表示コンテンツの解決', () => {
  it('保存済み定義を現行定義より優先する', () => {
    const card = { ...getCard('copilot')!, name: '記録時のCopilot' };
    const relic = { ...getRelic('psych-safety')!, name: '記録時の安全文化' };
    const resolver = createReplayContentResolver({
      cards: [card],
      relics: [relic],
    });

    expect(resolver.isReplaySnapshot).toBe(true);
    expect(resolver.resolveCard('copilot').name).toBe('記録時のCopilot');
    expect(resolver.resolveRelic('psych-safety').name).toBe('記録時の安全文化');
  });

  it('削除済みIDはプレースホルダーとして残す', () => {
    const resolver = createReplayContentResolver({ cards: [], relics: [] });

    expect(resolver.resolveCard('removed-card').name).toContain('removed-card');
    expect(resolver.resolveRelic('removed-relic').name).toContain('removed-relic');
  });

  it('旧v1向けのnullスナップショットは現行定義へフォールバックする', () => {
    const resolver = createReplayContentResolver(null);

    expect(resolver.isReplaySnapshot).toBe(false);
    expect(resolver.resolveCard('copilot')).toEqual(getCard('copilot'));
    expect(resolver.resolveRelic('psych-safety')).toEqual(getRelic('psych-safety'));
  });
});
