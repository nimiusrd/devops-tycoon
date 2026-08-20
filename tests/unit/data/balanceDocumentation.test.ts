import { describe, expect, it } from 'vitest';
import {
  BALANCE_REGISTRY,
  BALANCE_RULESET_FINGERPRINT,
  BALANCE_RULESET_FINGERPRINT_SCHEME,
  BALANCE_RULESET_VERSION,
  BALANCE_RULESET_VERSION_POLICY,
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
} from '../../../src/data/balance';
import { renderBalanceParametersMarkdown } from '../../../src/data/balance/documentation';

const CURRENT_RULESET = {
  version: BALANCE_RULESET_VERSION,
  fingerprint: BALANCE_RULESET_FINGERPRINT,
  fingerprintScheme: BALANCE_RULESET_FINGERPRINT_SCHEME,
  policy: BALANCE_RULESET_VERSION_POLICY,
};

describe('バランスパラメータ表のMarkdown生成', () => {
  it('再生成方法と全列を含む、現在のレジストリの決定論的な表を生成する', () => {
    const markdown = renderBalanceParametersMarkdown(BALANCE_REGISTRY, CURRENT_RULESET);
    const entries = flattenBalanceEntries(BALANCE_REGISTRY);

    expect(markdown).toContain('# バランスパラメータ一覧');
    expect(markdown).toContain('> 更新するには `npm run balance:docs` を実行してください。');
    expect(markdown).toContain('## ルールセット');
    expect(markdown).toContain(`- 版: \`${BALANCE_RULESET_VERSION}\``);
    expect(markdown).toContain(`- 指紋: \`${BALANCE_RULESET_FINGERPRINT}\``);
    expect(markdown).toContain('### 版を増やす条件');
    expect(markdown).toContain('### 版を増やさない条件');
    expect(markdown).toContain('### 指紋対象');
    expect(markdown).toContain('### 指紋対象外');
    for (const line of BALANCE_RULESET_VERSION_POLICY.bump) {
      expect(markdown).toContain(`- ${line}`);
    }
    for (const line of BALANCE_RULESET_VERSION_POLICY.noBump) {
      expect(markdown).toContain(`- ${line}`);
    }
    expect(markdown).toContain('seed と入力列');
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
    expect(markdown).toContain(
      '`run.event.softOutcome.loseThreshold` < `run.event.softOutcome.survivalFloor`',
    );
    expect(markdown).toContain('`sprint.grade.threshold.C` < `sprint.grade.threshold.B`');
    expect(markdown).toContain(
      '`sprint.grade.stabilizingBonusPerGrant` ≤ `sprint.grade.stabilizingBonusCap`',
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

    const markdown = renderBalanceParametersMarkdown([distribution, earlier], CURRENT_RULESET);

    expect(markdown.indexOf('`test.alpha`')).toBeLessThan(markdown.indexOf('`test.zeta`'));
    expect(markdown).toContain('後\\|段');
    expect(markdown).toContain('複数行<br>の説明');
    expect(markdown).toContain('| はい |');
  });
});
