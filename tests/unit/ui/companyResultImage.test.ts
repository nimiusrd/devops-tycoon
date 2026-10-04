import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { buildCompanyResult } from '../../../src/render/companyResultView';
import { fitImageText } from '../../../src/ui/companyResultPng';
import {
  normalizeReplay,
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
} from '../../../src/state/replay';

function terminal() {
  const engine = new RunEngine({ seed: 'company-image', difficulty: 'easy' });
  engine.startRun('easy', [], 'company-image');
  const frame = engine.exportReplayFrame()!;
  frame.status = 'won';
  frame.phase = 'won';
  frame.winType = 'healthy';
  frame.totals.delivered = 123;
  frame.org.seniorHp = 31;
  frame.org.morale = 50;
  frame.deck = [
    { defId: 'copilot', level: 2 },
    { defId: 'test', level: 3 },
    { defId: 'doc', level: 3 },
    { defId: 'fourth', level: 1 },
  ];
  return frame;
}

describe('会社結果画像', () => {
  it('記録の勝利種別・出荷・最大の消耗と、強化レベル上位3枚をコピーする', () => {
    const frame = terminal();
    const before = structuredClone(frame);
    const result = buildCompanyResult(frame, (id) => `記録名:${id}`);
    expect(result).toEqual({
      outcome: '健全勝利',
      won: true,
      delivered: 123,
      cost: { label: 'シニア体力', remaining: 31 },
      cards: [
        { name: '記録名:test', level: 3 },
        { name: '記録名:doc', level: 3 },
        { name: '記録名:copilot', level: 2 },
      ],
    });
    expect(frame).toEqual(before);
  });
  it('敗北・デッキ0枚・士気の消耗と、旧記録のIDを保持する', () => {
    const frame = terminal();
    frame.status = 'lost';
    frame.phase = 'lost';
    frame.winType = undefined;
    frame.loseReason = 'moraleCollapse';
    frame.deck = [];
    frame.org.morale = 0;
    expect(buildCompanyResult(frame, () => '参照しない')).toMatchObject({
      outcome: 'チーム崩壊',
      won: false,
      cost: { label: '士気', remaining: 0 },
      cards: [],
    });
    expect(buildCompanyResult(frame, () => '参照しない', true).outcome).toContain('moraleCollapse');
  });
  it('画像表示値をリプレイ保存・正規化で保持し、欠落した旧結果は補完しない', () => {
    const frame = terminal();
    frame.deck = [{ defId: 'copilot', level: 2 }];
    const keyframes = [{ phase: 'won' as const, frame }];
    const contentSnapshot = snapshotReplayContent(keyframes);
    contentSnapshot.companyResult!.outcome = '記録時の勝利名';
    contentSnapshot.companyResult!.cards[0].name = '記録時の長いカード名';
    const blob = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      id: 'test',
      seed: frame.seed,
      difficulty: frame.difficulty,
      trials: [],
      finishedAt: 1,
      outcome: { status: 'won', diagnosis: frame.diagnosis, score: 123 },
      keyframes,
      ruleset: { version: 1, fingerprint: 'test' },
      contentSnapshot,
    };
    expect(normalizeReplay(blob)?.contentSnapshot?.companyResult).toEqual(
      contentSnapshot.companyResult,
    );
    expect(
      normalizeReplay({ ...blob, contentSnapshot: { cards: contentSnapshot.cards, relics: [] } })
        ?.contentSnapshot?.companyResult,
    ).toBeUndefined();
    expect(
      normalizeReplay({
        ...blob,
        contentSnapshot: {
          ...contentSnapshot,
          companyResult: { ...contentSnapshot.companyResult, delivered: NaN },
        },
      }),
    ).toBeNull();
  });
  it('長い日本語も全文を保ち、すべての行を画像の領域に収める', () => {
    const text = '非常に長い日本語のカード名と経営上の選択'.repeat(20);
    const layout = fitImageText(text, 1080, 80, 34, (line, size) => Array.from(line).length * size);
    expect(layout.lines.join('')).toBe(text);
    expect(layout.lines.length * layout.size * 1.4).toBeLessThanOrEqual(80);
    expect(layout.lines.every((line) => Array.from(line).length * layout.size <= 1080)).toBe(true);
  });
});
