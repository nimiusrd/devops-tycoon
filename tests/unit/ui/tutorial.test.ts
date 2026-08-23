import { describe, expect, it } from 'vitest';
import {
  LEGACY_TUTORIAL_VERSION,
  TUTORIAL_CONTENT_VERSION,
  TUTORIAL_STEPS,
  ensureTutorialQuery,
  resolveTutorial,
  shouldShowTutorialGuide,
} from '../../../src/ui/tutorial';

describe('チュートリアルクエリ（RI-60）', () => {
  it('既知の ?tutorial= 値を解決し、未知値は null にする', () => {
    expect(resolveTutorial('?tutorial=1')).toBe('1');
    expect(resolveTutorial('?tutorial=force')).toBe('force');
    expect(resolveTutorial('?tutorial=help')).toBe('help');
    expect(resolveTutorial('?tutorial=off')).toBe('off');
    expect(resolveTutorial('?tutorial=')).toBeNull();
    expect(resolveTutorial('?tutorial=unknown')).toBeNull();
    expect(resolveTutorial('?seed=abc')).toBeNull();
    expect(resolveTutorial('')).toBeNull();
  });

  it('表示済み版とモードからガイド表示を判定する', () => {
    expect(shouldShowTutorialGuide(0, null)).toBe(true);
    expect(shouldShowTutorialGuide(TUTORIAL_CONTENT_VERSION, null)).toBe(false);
    expect(shouldShowTutorialGuide(LEGACY_TUTORIAL_VERSION, null)).toBe(true);
    expect(shouldShowTutorialGuide(TUTORIAL_CONTENT_VERSION, '1')).toBe(true);
    expect(shouldShowTutorialGuide(TUTORIAL_CONTENT_VERSION, 'force')).toBe(true);
    expect(shouldShowTutorialGuide(0, 'off')).toBe(false);
    expect(shouldShowTutorialGuide(0, 'help')).toBe(false);
  });

  it('段階ガイドは介入バー→シニア体力→渋滞→コンボの順（RI-67）', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'action-bar',
      'senior-hp',
      'jam-meter',
      'combo-gauge',
    ]);
    expect(TUTORIAL_STEPS.find((step) => step.id === 'senior-hp')).toMatchObject({
      targetTestId: 'hud-seniorHp',
    });
    const actionBar = TUTORIAL_STEPS.find((step) => step.id === 'action-bar');
    expect(actionBar?.body).toContain('緊急対応');
    expect(actionBar?.body).toContain('アンドン');
    expect(actionBar?.body).toContain('AIスロットル');
    const seniorHp = TUTORIAL_STEPS.find((step) => step.id === 'senior-hp');
    expect(seniorHp?.body).toContain('抽象値');
    expect(seniorHp?.body).toContain('緊急対応');
    expect(seniorHp?.body).toContain('自動鎮火');
    expect(seniorHp?.body).toContain('アンドンは流入を止めて');
    expect(seniorHp?.body).toContain('AIスロットルは');
    expect(seniorHp?.body).toContain('工程ずれ');
    expect(seniorHp?.body).not.toContain('アンドンやAIスロットルで流入');
  });

  it('ensureTutorialQuery は未指定時だけ off を付与し明示値は尊重する', () => {
    expect(ensureTutorialQuery('/?renderer=dom&seed=ops')).toBe(
      '/?renderer=dom&seed=ops&tutorial=off',
    );
    expect(ensureTutorialQuery('/?renderer=dom&tutorial=1')).toBe('/?renderer=dom&tutorial=1');
    expect(ensureTutorialQuery('/?tutorial=force&seed=x')).toBe('/?tutorial=force&seed=x');
  });
});
