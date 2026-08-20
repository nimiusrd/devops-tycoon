import { compareCanonicalStrings } from './canonical';
import { balanceEntryConstraintLabels, flattenBalanceEntries } from './define';
import type { BalanceRulesetVersionPolicy } from './ruleset';
import type { BalanceDefinition } from './types';

/** Markdown の表セルとして安全に表示できる文字列へ整形する。 */
function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n|\r/g, '<br>');
}

export interface BalanceRulesetDocumentation {
  readonly version: number;
  readonly fingerprint: string;
  readonly fingerprintScheme: number;
  readonly policy: BalanceRulesetVersionPolicy;
}

function renderRulesetSection(ruleset: BalanceRulesetDocumentation): string {
  const bump = ruleset.policy.bump.map((line) => `- ${line}`).join('\n');
  const noBump = ruleset.policy.noBump.map((line) => `- ${line}`).join('\n');
  const includes = ruleset.policy.fingerprintIncludes.map((line) => `- ${line}`).join('\n');
  const excludes = ruleset.policy.fingerprintExcludes.map((line) => `- ${line}`).join('\n');

  return [
    '## ルールセット',
    '',
    `- 版: \`${ruleset.version}\``,
    `- 指紋: \`${ruleset.fingerprint}\``,
    `- 指紋方式: \`${ruleset.fingerprintScheme}\``,
    '',
    '版は手動更新する単調増加整数である。結果へ影響する変更では直前の版から 1 増やす。',
    '',
    '### 版を増やす条件',
    '',
    bump,
    '',
    '### 版を増やさない条件',
    '',
    noBump,
    '',
    '### 指紋対象',
    '',
    includes,
    '',
    '### 指紋対象外',
    '',
    excludes,
    '',
  ].join('\n');
}

/**
 * バランスレジストリを、Git 管理するパラメータ表のMarkdownへ変換する。
 *
 * 生成日時や実行環境の情報を含めず、同じ定義から常に同じ出力を得る。
 */
export function renderBalanceParametersMarkdown(
  definitions: readonly BalanceDefinition[],
  ruleset: BalanceRulesetDocumentation,
): string {
  const entries = [...flattenBalanceEntries(definitions)].sort((left, right) =>
    compareCanonicalStrings(left.id, right.id),
  );
  const rows = entries.map((entry) => {
    const range = `${entry.allowedRange.min}〜${entry.allowedRange.max}${entry.integer ? '（整数）' : ''}`;
    const constraints = balanceEntryConstraintLabels(entry.id).join('<br>') || '—';
    const tags = entry.tags.join(', ');
    const derived = entry.derived ? 'はい' : 'いいえ';

    return [
      `\`${escapeTableCell(entry.id)}\``,
      escapeTableCell(entry.label),
      `\`${entry.value}\``,
      `\`${entry.unit}\``,
      `\`${range}\``,
      escapeTableCell(constraints),
      escapeTableCell(entry.description),
      escapeTableCell(tags),
      derived,
    ].join(' | ');
  });

  return [
    '# バランスパラメータ一覧',
    '',
    '> **このファイルは自動生成です。直接編集しないでください。**',
    '> 更新するには `npm run balance:docs` を実行してください。',
    '',
    renderRulesetSection(ruleset),
    '| ID | ラベル | 現在値 | 単位 | 許容範囲 | 関連制約 | 説明 | タグ | 派生値 |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}
