import { describe, expect, it } from 'vitest';
import { renderBalanceCurvesSvg } from '../../../src/data/balance/curves';
import { ACHIEVEMENT_DEFS } from '../../../src/data/achievements';
import { ACTION_CONTENT_DEFS } from '../../../src/data/actions';
import { BOSS_TEMPLATES } from '../../../src/data/bosses';
import { planBossPlayerDescription } from '../../../src/data/bossPlayerCopy';
import { CARD_DEFS, RARITY_LABEL } from '../../../src/data/cards';
import { DIFFICULTY_DEFS } from '../../../src/data/difficulties';
import { EVOLUTION_NODES } from '../../../src/data/evolution';
import { EVENT_DEFS } from '../../../src/data/events';
import { GOAL_ADJUSTMENT_DEFS } from '../../../src/data/goalAdjustments';
import { LEVER_DEFS } from '../../../src/data/levers';
import { RELIC_DEFS } from '../../../src/data/relics';
import { TRAIT_DEFS } from '../../../src/data/traits';
import { UNLOCK_DEFS } from '../../../src/data/unlocks';
import { planInterventionAnalysis } from '../../../src/render/sprintInterventionAnalysis';
import { formatSprintEvent } from '../../../src/render/sprintEventView';

const INTERNAL_TICKET_ID = /\bRI-\d+/;
const ENGLISH_PATIENCE = /\bpatience\b/i;
/** #963: 画面・生成図に混在していた英語用語 */
const ISSUE_963_FORBIDDEN = [
  /AI Literacy/,
  /\bLiteracy\b/,
  /Review待ち/,
  /初回Review/,
  /\bTest Coverage\b/,
  /\bTech Debt\b/,
  /\bMorale\b/,
  /\bQuality\b/,
  /Review キュー/,
  /Review 渋滞/,
  /Review 待ち/,
  /\/ Docs /,
] as const;

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
  for (const boss of BOSS_TEMPLATES) {
    copy.push(planBossPlayerDescription(boss, 'normal'));
  }
  copy.push(
    formatSprintEvent({
      kind: 'spread',
      tick: 1,
      spreadToTaskId: 't1',
      debtGain: 6,
      moraleCost: 5,
    }),
    planInterventionAnalysis({
      done: 0,
      delivered: 0,
      maxCombo: 0,
      aiAssistedPct: 0,
      reviewQueueMax: 0,
      rework: 0,
      incidents: 0,
      contained: 0,
      spread: 0,
      seniorHpDelta: 0,
      actionCounts: {},
      grade: 'C',
      title: '',
      diagnosis: '',
      timeline: [],
      events: [],
      fireEvents: [],
      focusRemaining: 0,
      focusMax: 8,
      autoContainCount: 0,
    }).tip,
    'CI 0 / 文書 42 / AI 55',
  );
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

  it('#963: プレイヤー向け文言に AI Literacy 等の英語混在を残さない', () => {
    const sources = [...collectPlayerFacingCopy(), renderBalanceCurvesSvg()];
    const violations: string[] = [];
    for (const text of sources) {
      if (ISSUE_963_FORBIDDEN.some((pattern) => pattern.test(text))) {
        violations.push(text.slice(0, 120));
      }
    }
    expect(violations).toEqual([]);
  });
});
