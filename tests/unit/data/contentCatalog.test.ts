import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_DEFS, ACHIEVEMENT_IDS } from '../../../src/data/achievements';
import { ACTION_CONTENT_DEFS, ACTION_DEFS } from '../../../src/data/actions';
import { ACTION_IDS } from '../../../src/data/actionIds';
import { CARD_DEFS } from '../../../src/data/cards';
import { BOSS_DEFS } from '../../../src/data/bosses';
import {
  CONTENT_CATALOG,
  projectAction,
  projectDepartment,
  projectEvent,
  projectRelic,
  validateContentCatalog,
} from '../../../src/data/contentCatalog';
import { renderContentCatalogMarkdown } from '../../../src/data/contentCatalogDocumentation';
import { DEPARTMENT_DEFS } from '../../../src/data/departments';
import { DIFFICULTY_DEFS, TRIAL_DEFS } from '../../../src/data/difficulties';
import { EVOLUTION_NODES } from '../../../src/data/evolution';
import { EVENT_DEFS, getEvent } from '../../../src/data/events';
import { GOAL_ADJUSTMENT_DEFS } from '../../../src/data/goalAdjustments';
import { LEVER_DEFS } from '../../../src/data/levers';
import {
  MEMBER_NAMES,
  RECRUIT_ARCHETYPES,
  STARTER_ARCHETYPES,
  STARTER_DEFAULT_AI_ARCHETYPE_ID,
} from '../../../src/data/members';
import { RUN_BALANCE } from '../../../src/data/balance/run';
import { RELIC_DEFS } from '../../../src/data/relics';
import { DEFAULT_SCENARIO, SCENARIO_ORDER, SCENARIOS } from '../../../src/sim/scenarios';
import { ALL_ACTION_IDS } from '../../../src/sim/actions';
import { TRAIT_DEFS } from '../../../src/data/traits';
import { UNLOCK_DEFS } from '../../../src/data/unlocks';
import { ACHIEVEMENT_DEFS as META_ACHIEVEMENT_DEFS } from '../../../src/state/meta';

function ids(definitions: readonly { id: string }[]): string[] {
  return definitions.map((definition) => definition.id);
}

function expectCatalogCategory(
  catalogEntries: readonly { id: string; order: number }[],
  sourceIds: readonly string[],
): void {
  expect(catalogEntries).toHaveLength(sourceIds.length);
  expect(ids(catalogEntries)).toEqual(sourceIds);
  expect(catalogEntries.map((entry) => entry.order)).toEqual(sourceIds.map((_, order) => order));
  expect(new Set(ids(catalogEntries)).size).toBe(catalogEntries.length);
}

describe('CONTENT_CATALOG', () => {
  it('全カテゴリの件数・ID・定義順・重複なしを正本と一致させる', () => {
    expectCatalogCategory(CONTENT_CATALOG.cards, ids(CARD_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.events, ids(EVENT_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.difficulties, Object.keys(DIFFICULTY_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.trials, ids(TRIAL_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.bosses, ids(BOSS_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.relics, ids(RELIC_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.traits, ids(TRAIT_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.evolution, ids(EVOLUTION_NODES));
    expectCatalogCategory(CONTENT_CATALOG.goalAdjustments, ids(GOAL_ADJUSTMENT_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.levers, ids(LEVER_DEFS));
    expect(CONTENT_CATALOG.members.namePool).toEqual(MEMBER_NAMES);
    expect(CONTENT_CATALOG.members.defaultAiArchetypeId).toBe(STARTER_DEFAULT_AI_ARCHETYPE_ID);
    expect(new Set(CONTENT_CATALOG.members.namePool).size).toBe(MEMBER_NAMES.length);
    expectCatalogCategory(CONTENT_CATALOG.members.starter, ids(STARTER_ARCHETYPES));
    expectCatalogCategory(CONTENT_CATALOG.members.recruit, ids(RECRUIT_ARCHETYPES));
    expectCatalogCategory(CONTENT_CATALOG.unlocks, ids(UNLOCK_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.departments, ids(DEPARTMENT_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.actions, ids(ACTION_CONTENT_DEFS));
    expectCatalogCategory(CONTENT_CATALOG.startingScenarios, [...SCENARIO_ORDER]);
    expectCatalogCategory(CONTENT_CATALOG.achievements, ids(ACHIEVEMENT_DEFS));
  });

  it('クロスリファレンスと定義間の整合性を検証できる', () => {
    expect(validateContentCatalog(CONTENT_CATALOG)).toEqual([]);
    expect(META_ACHIEVEMENT_DEFS).toBe(ACHIEVEMENT_DEFS);
    expect(ACHIEVEMENT_DEFS.map((definition) => definition.id)).toEqual(
      Object.values(ACHIEVEMENT_IDS),
    );
  });

  it('アクション ID・ActionDef・アクションバー順を同じ正本から導出する', () => {
    expect(ACTION_IDS).toEqual(ids(ACTION_CONTENT_DEFS));
    expect(ALL_ACTION_IDS).toEqual(ACTION_IDS);
    expect(ACTION_DEFS.map((definition) => definition.id)).toEqual(ACTION_IDS);
    expect(CONTENT_CATALOG.actions.map((entry) => entry.id)).toEqual(ACTION_IDS);
  });

  it('表示専用メタデータを変更しても実行射影は変わらない', () => {
    const department = DEPARTMENT_DEFS[0]!;
    expect(projectDepartment({ ...department, name: '表示名変更', color: '#ffffff' })).toEqual(
      projectDepartment(department),
    );

    const action = ACTION_CONTENT_DEFS[0]!;
    expect(
      projectAction({
        ...action,
        label: '表示文言変更',
        icon: '🧪',
        description: '説明変更',
        sideEffect: '副作用表示変更',
        tone: 'heavy',
      }),
    ).toEqual(projectAction(action));

    const event = EVENT_DEFS[0]!;
    expect(
      projectEvent({
        ...event,
        title: 'タイトル変更',
        prompt: '説明変更',
        tone: 'good',
        choices: event.choices.map((choice) => ({
          ...choice,
          label: '選択肢表示変更',
          description: '結果表示変更',
        })),
      }),
    ).toEqual(projectEvent(event));
    expect(projectEvent({ ...event, triggers: { moraleLow: 0, ...event.triggers } })).toEqual(
      projectEvent(event),
    );
    expect(
      projectEvent({
        ...event,
        minSignal: { moraleLow: 0, ...event.minSignal },
        maxSignal: { moraleLow: 1, ...event.maxSignal },
      }),
    ).toEqual(projectEvent(event));
    expect(
      projectEvent({
        ...event,
        choices: event.choices.map((choice) => ({
          ...choice,
          outcome: {
            morale: 0,
            grantRecruit: false,
            preserveAboveLose: false,
            ...choice.outcome,
          },
        })),
      }),
    ).toEqual(projectEvent(event));

    const catalogJson = JSON.stringify(CONTENT_CATALOG);
    expect(catalogJson).not.toContain('プロダクト事業部');
    expect(catalogJson).not.toContain('割り込みレビュー');
    expect(catalogJson).not.toContain('緊急のお願い');
  });

  it('ID・順序・重み・境界・効果など実行項目の変更は射影を変える', () => {
    const department = DEPARTMENT_DEFS[0]!;
    expect(projectDepartment({ ...department, teamCount: department.teamCount + 1 })).not.toEqual(
      projectDepartment(department),
    );

    const event = getEvent('review-freeze')!;
    expect(
      projectEvent({
        ...event,
        minSignal: { ...event.minSignal, seniorHpLow: 0.6 },
      }),
    ).not.toEqual(projectEvent(event));
    expect(
      projectEvent({
        ...event,
        weight: (event.weight ?? 1) + 1,
      }),
    ).not.toEqual(projectEvent(event));
    expect(
      projectEvent({
        ...event,
        choices: event.choices.map((choice, index) =>
          index === 0 ? { ...choice, outcome: { ...choice.outcome, seniorHp: -1 } } : choice,
        ),
      }),
    ).not.toEqual(projectEvent(event));

    const firstDepartment = CONTENT_CATALOG.departments[0]!;
    expect({ ...firstDepartment, id: 'changed-id' }).not.toEqual(firstDepartment);
    expect({ ...firstDepartment, order: firstDepartment.order + 1 }).not.toEqual(firstDepartment);
  });

  it('開始シナリオ順と難易度順を定義から導出する', () => {
    expect(SCENARIO_ORDER).toEqual(Object.keys(SCENARIOS));
    expect(CONTENT_CATALOG.startingScenarios.map((entry) => entry.id)).toEqual(SCENARIO_ORDER);
    expect(CONTENT_CATALOG.difficulties.map((entry) => entry.id)).toEqual(
      Object.keys(DIFFICULTY_DEFS),
    );
    expect(CONTENT_CATALOG.defaultScenarioId).toBe(DEFAULT_SCENARIO);
    expect(CONTENT_CATALOG.difficultyOrder).toEqual(Object.keys(DIFFICULTY_DEFS));
  });

  it('進化の表示ブランチを除外し、デイリー参照 ID を検証する', () => {
    expect(
      CONTENT_CATALOG.evolution.every(
        (entry) => !Object.prototype.hasOwnProperty.call(entry.execution, 'branch'),
      ),
    ).toBe(true);
    expect(
      validateContentCatalog({
        ...CONTENT_CATALOG,
        daily: { difficulty: CONTENT_CATALOG.daily.difficulty, trials: ['unknown-trial'] },
      }),
    ).toContainEqual({ category: 'daily.trials', message: '未知の参照: unknown-trial' });
    expect(
      validateContentCatalog({
        ...CONTENT_CATALOG,
        daily: { difficulty: 'unknown-difficulty', trials: CONTENT_CATALOG.daily.trials },
      }),
    ).toContainEqual({
      category: 'daily.difficulty',
      message: '未知の参照: unknown-difficulty',
    });
  });

  it('レリック枠の上書きは identity 値でも射影に残す', () => {
    const relic = RELIC_DEFS.find((definition) => definition.id === 'postmortem')!;
    expect(projectRelic({ ...relic, passives: { moraleDamageMul: 1 } })).toEqual(
      projectRelic(relic),
    );
    expect(
      projectRelic({
        ...relic,
        passives: { relicSlots: RUN_BALANCE.shopRelicSlots.value },
      }),
    ).not.toEqual(projectRelic(relic));
  });

  it('生成 Markdown は同じカタログから決定論的に作られる', () => {
    const markdown = renderContentCatalogMarkdown(CONTENT_CATALOG);
    expect(markdown).toContain('# Content Catalog');
    expect(markdown).toContain('| 17 | review-freeze |');
    expect(markdown).toContain('| 0 | product | {"teamCount":4} |');
    expect(markdown).not.toContain('プロダクト事業部');
    expect(markdown).not.toContain('割り込みレビュー');
  });
});
