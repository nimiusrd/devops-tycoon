import { describe, expect, it } from 'vitest';
import {
  BALANCE_REGISTRY,
  defineBalanceEntry,
  defineProbabilityDistribution,
} from '../../../src/data/balance';
import { renderBalanceParametersMarkdown } from '../../../src/data/balance/documentation';

describe('バランスパラメータ表のMarkdown生成', () => {
  it('再生成方法と全列を含む、現在のレジストリの決定論的な表を生成する', () => {
    expect(renderBalanceParametersMarkdown(BALANCE_REGISTRY)).toBe(`\
# バランスパラメータ一覧

> **このファイルは自動生成です。直接編集しないでください。**
> 更新するには \`npm run balance:docs\` を実行してください。

| ID | ラベル | 現在値 | 単位 | 許容範囲 | 説明 | タグ | 派生値 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| \`process.ai.adoption\` | AI 導入時の既定採用率 | \`0.85\` | \`probability\` | \`0〜1\` | AI 導入済みの組織で、各タスクが AI 支援を使う既定確率。 | process, ai | いいえ |
| \`process.coding.aiSpeedup\` | AI Coding 高速化倍率 | \`2.6\` | \`multiplier\` | \`1〜5\` | AI 支援タスクの Coding 所要 tick を短縮する倍率。 | process, coding, ai | いいえ |
| \`process.coding.baseTicks\` | Coding 基礎所要 tick | \`7\` | \`ticks\` | \`1〜30\` | 標準規模かつ AI 支援なしのタスクを実装する基礎所要 tick。 | process, coding | いいえ |
`);
  });

  it('入力順にかかわらずID順にし、分布内エントリーと表セルを安全に表示する', () => {
    const later = defineBalanceEntry({
      id: 'test.zeta',
      value: 2,
      unit: 'count',
      allowedRange: { min: 0, max: 3 },
      label: '後|段',
      description: '複数行\nの説明',
      tags: ['zeta', 'two'],
      derived: true,
    });
    const earlier = defineBalanceEntry({
      id: 'test.alpha',
      value: 1,
      unit: 'count',
      allowedRange: { min: 0, max: 3 },
      label: '先頭',
      description: '先に表示する値。',
      tags: ['alpha'],
      derived: false,
    });
    const distribution = defineProbabilityDistribution({
      id: 'test.distribution',
      unit: 'probability',
      allowedRange: { min: 0, max: 1 },
      label: 'テスト分布',
      description: '平坦化の確認用。',
      tags: ['test'],
      derived: false,
      entries: [later],
    });

    const markdown = renderBalanceParametersMarkdown([distribution, earlier]);

    expect(markdown.indexOf('`test.alpha`')).toBeLessThan(markdown.indexOf('`test.zeta`'));
    expect(markdown).toContain('後\\|段');
    expect(markdown).toContain('複数行<br>の説明');
    expect(markdown).toContain('| はい |');
  });
});
