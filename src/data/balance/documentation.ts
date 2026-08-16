import { flattenBalanceEntries } from './define';
import type { BalanceDefinition } from './types';

/** Markdown の表セルとして安全に表示できる文字列へ整形する。 */
function escapeTableCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r?\n|\r/g, '<br>');
}

/** ID のコードポイント順を使い、実行環境のロケール設定に依存させない。 */
function compareBalanceIds(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftCodePoints[index].codePointAt(0);
    const rightCodePoint = rightCodePoints[index].codePointAt(0);
    if (leftCodePoint === rightCodePoint) continue;
    return leftCodePoint < rightCodePoint ? -1 : 1;
  }

  return leftCodePoints.length - rightCodePoints.length;
}

/**
 * バランスレジストリを、Git 管理するパラメータ表のMarkdownへ変換する。
 *
 * 生成日時や実行環境の情報を含めず、同じ定義から常に同じ出力を得る。
 */
export function renderBalanceParametersMarkdown(definitions: readonly BalanceDefinition[]): string {
  const entries = [...flattenBalanceEntries(definitions)].sort((left, right) =>
    compareBalanceIds(left.id, right.id),
  );
  const rows = entries.map((entry) => {
    const range = `${entry.allowedRange.min}〜${entry.allowedRange.max}`;
    const tags = entry.tags.join(', ');
    const derived = entry.derived ? 'はい' : 'いいえ';

    return [
      `\`${escapeTableCell(entry.id)}\``,
      escapeTableCell(entry.label),
      `\`${entry.value}\``,
      `\`${entry.unit}\``,
      `\`${range}\``,
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
    '| ID | ラベル | 現在値 | 単位 | 許容範囲 | 説明 | タグ | 派生値 |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}
