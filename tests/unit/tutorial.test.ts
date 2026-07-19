import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  ensureTutorialQuery,
  resolveTutorial,
  shouldShowTutorialGuide,
} from '../../src/ui/tutorial';

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

  it('表示済みフラグとモードからガイド表示を判定する', () => {
    expect(shouldShowTutorialGuide(false, null)).toBe(true);
    expect(shouldShowTutorialGuide(true, null)).toBe(false);
    expect(shouldShowTutorialGuide(true, '1')).toBe(true);
    expect(shouldShowTutorialGuide(true, 'force')).toBe(true);
    expect(shouldShowTutorialGuide(false, 'off')).toBe(false);
    expect(shouldShowTutorialGuide(false, 'help')).toBe(false);
  });

  it('段階ガイドは介入バー→渋滞→コンボの順', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'action-bar',
      'jam-meter',
      'combo-gauge',
    ]);
  });

  it('ensureTutorialQuery は未指定時だけ off を付与し明示値は尊重する', () => {
    expect(ensureTutorialQuery('/?renderer=dom&seed=ops')).toBe(
      '/?renderer=dom&seed=ops&tutorial=off',
    );
    expect(ensureTutorialQuery('/?renderer=dom&tutorial=1')).toBe('/?renderer=dom&tutorial=1');
    expect(ensureTutorialQuery('/?tutorial=force&seed=x')).toBe('/?tutorial=force&seed=x');
  });
});
