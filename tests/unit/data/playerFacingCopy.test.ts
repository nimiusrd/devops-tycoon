import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_DEFS } from '../../../src/data/achievements';
import { ACTION_CONTENT_DEFS } from '../../../src/data/actions';
import { CARD_DEFS, RARITY_LABEL } from '../../../src/data/cards';
import { DIFFICULTY_DEFS } from '../../../src/data/difficulties';
import { EVOLUTION_NODES } from '../../../src/data/evolution';
import { EVENT_DEFS } from '../../../src/data/events';
import { GOAL_ADJUSTMENT_DEFS } from '../../../src/data/goalAdjustments';
import { LEVER_DEFS } from '../../../src/data/levers';
import { RELIC_DEFS } from '../../../src/data/relics';
import { TRAIT_DEFS } from '../../../src/data/traits';
import { UNLOCK_DEFS } from '../../../src/data/unlocks';

const INTERNAL_TICKET_ID = /\bRI-\d+/;
const ENGLISH_PATIENCE = /\bpatience\b/i;

function collectPlayerFacingCopy(): string[] {
  const copy: string[] = [];

  for (const def of GOAL_ADJUSTMENT_DEFS) {
    copy.push(def.label, def.description);
  }
  for (const def of EVENT_DEFS) {
    copy.push(def.title, def.prompt);
    for (const choice of def.choices) {
      copy.push(choice.label, choice.description);
    }
  }
  for (const def of CARD_DEFS) {
    copy.push(def.name, ...def.description);
  }
  for (const def of RELIC_DEFS) {
    copy.push(def.name, def.description);
  }
  for (const def of LEVER_DEFS) {
    copy.push(def.name, def.description);
  }
  for (const def of Object.values(DIFFICULTY_DEFS)) {
    copy.push(def.label, def.description);
  }
  for (const def of EVOLUTION_NODES) {
    copy.push(def.name, def.description);
  }
  for (const def of TRAIT_DEFS) {
    copy.push(def.name, def.description);
  }
  for (const def of UNLOCK_DEFS) {
    copy.push(def.label, def.description);
  }
  for (const def of ACHIEVEMENT_DEFS) {
    copy.push(def.label, def.hint);
  }
  for (const def of ACTION_CONTENT_DEFS) {
    copy.push(def.label, def.description, def.sideEffect ?? '');
  }
  copy.push(...Object.values(RARITY_LABEL));

  return copy.filter((text) => text.length > 0);
}

describe('playerFacingCopy', () => {
  it('コンテンツ定義の表示文言に内部チケット ID や英語 patience を含めない', () => {
    const violations: string[] = [];
    for (const text of collectPlayerFacingCopy()) {
      if (INTERNAL_TICKET_ID.test(text) || ENGLISH_PATIENCE.test(text)) {
        violations.push(text);
      }
    }
    expect(violations).toEqual([]);
  });
});
