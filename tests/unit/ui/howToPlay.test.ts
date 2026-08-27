import { describe, expect, it } from 'vitest';
import { HOW_TO_PLAY_SECTIONS } from '../../../src/ui/howToPlayContent';

const INTERVENTION_ONLY_PHRASES = [
  'アンドンはキューを捌く猶予',
  'AIスロットルは新規タスクをAIなしに',
  '点火の抑制はリテラシーが低いときだけ',
  '手戻りの抑制はワークフローが未熟なときだけ',
  '前提度が高く成熟しているときは工程ずれ',
] as const;

describe('遊び方ヘルプの節分担（#362）', () => {
  const intervention = HOW_TO_PLAY_SECTIONS.find((section) => section.id === 'intervention');
  const seniorHp = HOW_TO_PLAY_SECTIONS.find((section) => section.id === 'senior-hp');

  it('介入節に手順説明を置き、体力節へコピペしない', () => {
    expect(intervention?.title).toBe('スプリント中の介入');
    expect(seniorHp?.title).toBe('シニア体力と燃え尽き');
    for (const phrase of INTERVENTION_ONLY_PHRASES) {
      expect(intervention?.body).toContain(phrase);
      expect(seniorHp?.body).not.toContain(phrase);
    }
  });

  it('体力節は抽象値・燃え尽き敗北・自動鎮火・休息に絞る', () => {
    expect(seniorHp?.body).toContain('抽象値');
    expect(seniorHp?.body).toContain('燃え尽き');
    expect(seniorHp?.body).toContain('自動鎮火');
    expect(seniorHp?.body).toContain('休息');
    expect(seniorHp?.body).not.toContain('アンドン');
    expect(seniorHp?.body).not.toContain('AIスロットル');
    expect(seniorHp?.body).not.toContain('緊急対応');
    expect(seniorHp?.body).not.toContain('工程ずれ');
  });
});
