import { describe, expect, it } from 'vitest';
import {
  BALANCE_REGISTRY,
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
} from '../../../src/data/balance';
import { renderBalanceParametersMarkdown } from '../../../src/data/balance/documentation';

describe('バランスパラメータ表のMarkdown生成', () => {
  it('再生成方法と全列を含む、現在のレジストリの決定論的な表を生成する', () => {
    const markdown = renderBalanceParametersMarkdown(BALANCE_REGISTRY);
    const entries = flattenBalanceEntries(BALANCE_REGISTRY);

    expect(markdown).toContain('# バランスパラメータ一覧');
    expect(markdown).toContain('> 更新するには `npm run balance:docs` を実行してください。');
    expect(markdown).toContain(
      '| ID | ラベル | 現在値 | 単位 | 許容範囲 | 関連制約 | 説明 | タグ | 派生値 |',
    );
    expect(markdown.match(/^\| `[^`]+` \|/gm)).toHaveLength(entries.length);
    expect(markdown).toContain(
      '`process.review.hpEfficiency.floor` + `process.review.hpEfficiency.range` = 1',
    );
    expect(markdown).toContain(
      '`process.security.level.minimum` ≤ `process.security.level.maximum`',
    );
    expect(markdown).toContain(
      '`member.growth.promotion.middleLevel` < `member.growth.promotion.seniorLevel`',
    );
    expect(markdown).toContain(
      '`card.effect.multiplier.minimum` ≤ `card.effect.multiplier.maximum`',
    );
    for (const entry of entries) {
      expect(markdown).toContain(`| \`${entry.id}\` | ${entry.label} | \`${entry.value}\` |`);
    }
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
