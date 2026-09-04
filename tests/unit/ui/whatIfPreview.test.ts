import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { WhatIfPreview as PreviewData } from '../../../src/sim/run/types';
import { WhatIfPreview } from '../../../src/ui/WhatIfPreview';

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<{ children?: ReactNode }>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function preview(overrides: Partial<PreviewData> = {}): PreviewData {
  return {
    trials: 5,
    delivered: { min: 2.8, max: 5.1, mean: 3.7 },
    spread: { min: 0.4, max: 1.2, mean: 0.8 },
    ...overrides,
  };
}

describe('次スプリント予測', () => {
  it('未試算なら非表示にし、計算中は予測値の代わりに進捗を示す', () => {
    expect(WhatIfPreview({})).toBeNull();
    expect(WhatIfPreview({ preview: null })).toBeNull();
    const tree = WhatIfPreview({
      computing: true,
      compact: true,
      label: '選択後の予測',
      testId: 'preview',
    });
    expect(tree?.props['data-testid']).toBe('preview');
    expect(tree?.props['data-what-if-status']).toBe('computing');
    expect(tree?.props.className).toContain('compact');
    expect(content(tree)).toBe('選択後の予測試算中…');
    expect(content(WhatIfPreview({ computing: true }))).toBe('次スプリント予測試算中…');
  });

  it('出荷・延焼の下限を切り下げ、上限を切り上げて試算回数を添える', () => {
    const tree = WhatIfPreview({ preview: preview(), testId: 'range' });
    expect(content(tree)).toBe('次スプリント予測出荷 2〜6延焼 0〜25回試算');
    expect(tree?.props['data-testid']).toBe('range');
    expect(tree?.props.className).toBe('what-if-preview');
  });

  it('整数の範囲を広げず、再計算中でも取得済みの予測を表示する', () => {
    const tree = WhatIfPreview({
      preview: preview({
        delivered: { min: 4, max: 4, mean: 4 },
        spread: { min: 0, max: 0, mean: 0 },
      }),
      computing: true,
      compact: true,
      label: 'カード採用後',
    });
    expect(content(tree)).toBe('カード採用後出荷 4〜4延焼 0〜05回試算');
    expect(tree?.props.className).toBe('what-if-preview compact');
    expect(tree?.props['data-what-if-status']).toBeUndefined();
  });

  it.each([
    ['seniorBurnout', 'シニア燃え尽き'],
    ['techDebt', '技術的負債の崩壊'],
    ['moraleCollapse', 'チーム崩壊'],
    ['reviewFreeze', 'PR 凍結'],
    ['incidentCascade', '障害連鎖'],
    ['aiDependency', 'AI 依存の限界'],
    ['budgetExhausted', '予算枯渇'],
  ] as const)('即時敗北 %s の理由を表示し、通常の予測を隠す', (reason, label) => {
    const tree = WhatIfPreview({ preview: preview({ immediateLose: reason }), compact: true });
    expect(content(tree)).toBe(`即時敗北${label}`);
    expect(tree?.props['data-immediate-lose']).toBe(reason);
    expect(tree?.props.className).toBe('what-if-preview lose compact');
  });

  it('カード発動での敗北を即時敗北と区別し、両方ある場合は即時敗北を優先する', () => {
    const tree = WhatIfPreview({ preview: preview({ loseOnPlay: 'aiDependency' }), compact: true });
    expect(content(tree)).toBe('発動で敗北AI 依存の限界');
    expect(tree?.props['data-lose-on-play']).toBe('aiDependency');
    expect(tree?.props['data-immediate-lose']).toBeUndefined();
    expect(tree?.props.className).toBe('what-if-preview lose compact');
    const immediate = WhatIfPreview({
      preview: preview({ immediateLose: 'budgetExhausted', loseOnPlay: 'aiDependency' }),
    });
    expect(content(immediate)).toBe('即時敗北予算枯渇');
    expect(immediate?.props['data-lose-on-play']).toBeUndefined();
  });

  it('専用の表示名がない敗北理由も識別子を残す', () => {
    expect(content(WhatIfPreview({ preview: preview({ immediateLose: 'trustExhausted' }) }))).toBe(
      '即時敗北trustExhausted',
    );
    expect(content(WhatIfPreview({ preview: preview({ loseOnPlay: 'trustExhausted' }) }))).toBe(
      '発動で敗北trustExhausted',
    );
  });
});
