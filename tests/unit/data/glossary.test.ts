import { describe, expect, it } from 'vitest';
import {
  GLOSSARY,
  GLOSSARY_MAX_DEFINITION_LENGTH,
  GLOSSARY_TERM_IDS,
} from '../../../src/data/glossary';

describe('glossary（#469）', () => {
  it('必須6語を持ち、定義は40字以内で空でない', () => {
    expect(GLOSSARY_TERM_IDS).toEqual([
      'pr',
      'spread',
      'seniorHp',
      'aiLiteracy',
      'rework',
      'focus',
    ]);
    expect(GLOSSARY.pr.term).toBe('PR');
    expect(GLOSSARY.spread.term).toBe('延焼');
    expect(GLOSSARY.seniorHp.term).toBe('シニア体力');
    expect(GLOSSARY.aiLiteracy.term).toBe('AIリテラシー');
    expect(GLOSSARY.rework.term).toBe('手戻り');
    expect(GLOSSARY.focus.term).toBe('マネジメント集中力');
    for (const id of GLOSSARY_TERM_IDS) {
      const { term, definition } = GLOSSARY[id];
      expect(term.length).toBeGreaterThan(0);
      expect(definition.length).toBeGreaterThan(0);
      expect(definition.length).toBeLessThanOrEqual(GLOSSARY_MAX_DEFINITION_LENGTH);
    }
  });
});
