import { describe, expect, it } from 'vitest';
import {
  sprintResultDiagnosisPhraseKeys,
  sprintResultDiagnosisPhrases,
} from '../../../src/render/sprintResultDiagnosisPhrases';

describe('sprintResultDiagnosisPhrases', () => {
  it('公式診断文は文節の連結結果が元の文と一致する', () => {
    for (const diagnosis of sprintResultDiagnosisPhraseKeys()) {
      const phrases = sprintResultDiagnosisPhrases(diagnosis);
      expect(phrases.join(''), diagnosis).toBe(diagnosis);
    }
  });

  it('語中で割りやすい例を文節で分解する', () => {
    const diagnosis = 'AIの加速を、レビューと品質が受け止められています。理想的な導入です。';
    expect(sprintResultDiagnosisPhrases(diagnosis)).toEqual([
      'AIの加速を、',
      'レビューと品質が',
      '受け止められています。',
      '理想的な導入です。',
    ]);
  });
});
