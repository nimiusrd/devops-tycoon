import type { ContentCatalog, ContentCatalogEntry } from './contentCatalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntryList(value: unknown): value is readonly ContentCatalogEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.order === 'number' &&
        Object.prototype.hasOwnProperty.call(item, 'execution'),
    )
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderValue(name: string, value: unknown, level: number, lines: string[]): void {
  const heading = '#'.repeat(level);
  lines.push(`${heading} ${name}`, '');

  if (isEntryList(value)) {
    lines.push('| Order | ID | Execution |', '| ---: | --- | --- |');
    for (const entry of value) {
      lines.push(
        `| ${entry.order} | ${escapeCell(entry.id)} | ${escapeCell(stableJson(entry.execution))} |`,
      );
    }
    lines.push('');
    return;
  }

  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) renderValue(key, nested, level + 1, lines);
    return;
  }

  lines.push('```json', stableJson(value), '```', '');
}

/** `CONTENT_CATALOG` を決定論的な Markdown へ変換する。 */
export function renderContentCatalogMarkdown(catalog: ContentCatalog): string {
  const lines = [
    '# Content Catalog',
    '',
    '<!-- このファイルは `npm run balance:docs` で生成されます。手動編集しないでください。 -->',
    '',
    '実行結果に影響するコンテンツ定義の射影です。表示用の名称・説明・色・アイコンは含みません。',
    '',
  ];

  for (const [name, value] of Object.entries(catalog)) renderValue(name, value, 2, lines);
  return `${lines.join('\n').trimEnd()}\n`;
}
