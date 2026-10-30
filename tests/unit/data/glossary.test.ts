import { describe, expect, it } from 'vitest';
import { OUTCOME_BALANCE } from '../../../src/data/balance/outcome';
import {
  aiLiteracyGlossaryPhrases,
  GLOSSARY,
  GLOSSARY_MAX_DEFINITION_LENGTH,
  GLOSSARY_TERM_IDS,
} from '../../../src/data/glossary';
import { AI_DEPENDENCY_HELP } from '../../../src/render/status';
import { loseNextActionView } from '../../../src/render/loseNextActionView';

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
    expect(GLOSSARY.aiLiteracy.definition).toContain('手戻り');
    expect(GLOSSARY.aiLiteracy.definition).toContain('敗北');
    expect(GLOSSARY.aiLiteracy.definition).not.toContain('依存だけ');
    for (const id of GLOSSARY_TERM_IDS) {
      const { term, definition, phrases } = GLOSSARY[id];
      expect(term.length).toBeGreaterThan(0);
      expect(definition.length).toBeGreaterThan(0);
      expect(definition.length).toBeLessThanOrEqual(GLOSSARY_MAX_DEFINITION_LENGTH);
      if (phrases) expect(phrases.join('')).toBe(definition);
    }
  });

  it('AIリテラシーは依存度だけでは敗北せず、HUDと敗北画面と同じしきい値を示す（#941）', () => {
    const literacy = OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value;
    const dependency = OUTCOME_BALANCE.loseAiDependencyCap.value;
    const definition = GLOSSARY.aiLiteracy.definition;
    const phrases = GLOSSARY.aiLiteracy.phrases;

    expect(definition).toBe(aiLiteracyGlossaryPhrases().join(''));
    expect(phrases).toEqual(aiLiteracyGlossaryPhrases());
    expect(definition).toBe(
      `低いと手戻り増。リテラシー${literacy}以下かつ依存${dependency}%以上で敗北。`,
    );
    expect(definition).toContain('リテラシー');
    expect(definition).toContain(`${literacy}以下`);
    expect(definition).toContain(`依存${dependency}%以上`);
    expect(definition).toContain('かつ');
    expect(definition).not.toContain('値が');
    expect(definition).not.toContain('依存が高いと敗北');
    expect(definition).not.toMatch(/依存(度)?だけ/);

    const nextAction = loseNextActionView('aiDependency').nextAction;
    for (const text of [definition, AI_DEPENDENCY_HELP, nextAction]) {
      expect(text).toContain(String(literacy));
      expect(text).toContain(String(dependency));
      expect(text).toMatch(/以下/);
    }

    const literacyRange = OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.allowedRange;
    const dependencyRange = OUTCOME_BALANCE.loseAiDependencyCap.allowedRange;
    for (const literacyMax of [literacyRange.min, literacyRange.max]) {
      for (const dependencyCap of [dependencyRange.min, dependencyRange.max]) {
        const extreme = aiLiteracyGlossaryPhrases(literacyMax, dependencyCap);
        expect(extreme.join('').length).toBeLessThanOrEqual(GLOSSARY_MAX_DEFINITION_LENGTH);
        expect(extreme.join('')).toContain('リテラシー');
        expect(extreme.join('')).toContain(`${literacyMax}以下`);
        expect(extreme.join('')).toContain(`依存${dependencyCap}%以上`);
        expect(extreme.join('')).toContain('かつ');
        expect(extreme.join('')).not.toContain('値が');
      }
    }
  });
});
