import { describe, expect, it } from 'vitest';
import {
  FULLY_GENERATED_FILES,
  PARTIALLY_GENERATED_FILES,
  extractManagedRegion,
  generatedContentMatches,
} from '../../../scripts/check-balance.mjs';

const partialFile = PARTIALLY_GENERATED_FILES[0];

function partialDocument(generated = 'generated', manual = 'manual') {
  return ['手書きの前文', partialFile.begin, generated, partialFile.end, manual].join('\n');
}

describe('balance:checkの生成内容比較', () => {
  it('cleanな完全生成物と部分生成物を受理する', () => {
    const document = partialDocument();

    expect(generatedContentMatches(FULLY_GENERATED_FILES[0], 'same', 'same')).toBe(true);
    expect(generatedContentMatches(partialFile.path, document, document)).toBe(true);
  });

  it('部分生成物のマーカー外にある手書き変更を許容する', () => {
    const baseline = partialDocument('generated', '元の説明');
    const current = partialDocument('generated', '意図的に更新した説明');

    expect(generatedContentMatches(partialFile.path, baseline, current)).toBe(true);
  });

  it('部分生成物の管理範囲が古い場合は拒否する', () => {
    const baseline = partialDocument('generated');
    const current = partialDocument('stale');

    expect(generatedContentMatches(partialFile.path, baseline, current)).toBe(false);
  });

  it('完全生成物の内容差分を拒否する', () => {
    expect(generatedContentMatches(FULLY_GENERATED_FILES[0], 'baseline', 'changed')).toBe(false);
  });

  it.each([
    ['beginマーカーがない', partialDocument().replace(`${partialFile.begin}\n`, '')],
    ['endマーカーがない', partialDocument().replace(`\n${partialFile.end}`, '')],
    [
      'beginマーカーが重複する',
      partialDocument().replace(partialFile.begin, `${partialFile.begin}\n${partialFile.begin}`),
    ],
    [
      'endマーカーが重複する',
      partialDocument().replace(partialFile.end, `${partialFile.end}\n${partialFile.end}`),
    ],
    ['マーカーの順序が逆', [partialFile.end, 'generated', partialFile.begin].join('\n')],
  ])('%s場合は管理範囲の抽出を拒否する', (_label, content) => {
    expect(() => extractManagedRegion(content, partialFile)).toThrow();
  });
});
