import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTION_CONTENT_DEFS } from '../../../src/data/actions';
import {
  BALANCE_REGISTRY,
  BALANCE_RULESET_FINGERPRINT,
  BALANCE_RULESET_FINGERPRINT_SCHEME,
  BALANCE_RULESET_PAYLOAD,
  BALANCE_RULESET_VERSION,
  BALANCE_RULESET_VERSION_POLICY,
  canonicalizeJson,
  compareCanonicalStrings,
  createBalanceRulesetPayload,
  defineBalanceEntry,
  defineProbabilityDistribution,
  fingerprintBalanceRuleset,
  PACING_BALANCE,
  PROCESS_BALANCE,
  projectBalanceRegistry,
  sha256Hex,
} from '../../../src/data/balance';
import { DEPARTMENT_DEFS } from '../../../src/data/departments';
import { DIFFICULTY_DEFS, TRIAL_DEFS } from '../../../src/data/difficulties';
import { MEMBER_NAMES } from '../../../src/data/members';
import { EVENT_DEFS } from '../../../src/data/events';
import {
  projectActions,
  projectContentCatalog,
  projectDepartments,
  projectDifficulties,
  projectEvents,
  projectMembers,
  projectScenarios,
  projectTrials,
} from '../../../src/data/contentCatalog';
import { DEFAULT_SCENARIO, SCENARIOS, SCENARIO_ORDER } from '../../../src/sim/scenarios';
import { SPRINT_BALANCE } from '../../../src/data/balance/sprint';

const FIXTURE_TAGS = ['test'] as const;

function sampleEntry(
  id: string,
  value: number,
  extras: Partial<Parameters<typeof defineBalanceEntry>[0]> = {},
) {
  return defineBalanceEntry({
    id,
    value,
    unit: 'count',
    allowedRange: { min: 0, max: 10 },
    label: id,
    description: `${id} の説明`,
    tags: FIXTURE_TAGS,
    derived: false,
    ...extras,
  });
}

describe('バランスルールセットの版と指紋', () => {
  it('現行ルールセットの版は 1、指紋は 64 桁 hex で再計算と一致する', () => {
    expect(BALANCE_RULESET_VERSION).toBe(1);
    expect(BALANCE_RULESET_FINGERPRINT_SCHEME).toBe(1);
    expect(BALANCE_RULESET_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintBalanceRuleset(BALANCE_RULESET_PAYLOAD)).toBe(BALANCE_RULESET_FINGERPRINT);
    expect(Object.keys(BALANCE_RULESET_PAYLOAD)).toEqual(
      expect.arrayContaining(['fingerprintScheme', 'registry', 'catalog']),
    );
    expect(BALANCE_RULESET_PAYLOAD).not.toHaveProperty('seed');
    expect(BALANCE_RULESET_PAYLOAD).not.toHaveProperty('version');
    expect(BALANCE_RULESET_VERSION_POLICY.bump.length).toBeGreaterThan(0);
    expect(BALANCE_RULESET_VERSION_POLICY.noBump.length).toBeGreaterThan(0);
  });

  it('純TS SHA-256 は Node crypto と一致し、node:crypto を import しない', () => {
    const samples = ['', 'abc', 'DevOps Tycoon', canonicalizeJson({ z: 1, a: [2, 3] })];
    for (const sample of samples) {
      expect(sha256Hex(sample)).toBe(createHash('sha256').update(sample, 'utf8').digest('hex'));
    }

    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/data/balance/canonical.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/node:crypto/);
    expect(source).not.toMatch(/crypto\.subtle/);
  });

  it('オブジェクトキー順だけでは指紋が変わらず、配列順と値の変更では変わる', () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe(canonicalizeJson({ a: 1, b: 2 }));

    const routine = sampleEntry('kind.routine', 0.3);
    const normal = sampleEntry('kind.normal', 0.7);
    const distribution = defineProbabilityDistribution({
      id: 'kind.distribution',
      unit: 'probability',
      allowedRange: { min: 0, max: 1 },
      label: '分布',
      description: '抽選順の確認',
      tags: FIXTURE_TAGS,
      derived: false,
      entries: [routine, normal],
    });
    const catalog = { items: ['x', 'y'] };
    const original = fingerprintBalanceRuleset(
      createBalanceRulesetPayload([distribution], catalog),
    );

    const metadataOnly = defineProbabilityDistribution({
      ...distribution,
      label: '別ラベル',
      description: '別説明',
      tags: ['docs'],
      derived: true,
      entries: [
        sampleEntry('kind.routine', 0.3, {
          label: '変更',
          description: '変更',
          unit: 'ratio',
          allowedRange: { min: -1, max: 2 },
          tags: ['docs'],
          derived: true,
          integer: true,
        }),
        sampleEntry('kind.normal', 0.7, { label: '変更2' }),
      ],
    });
    expect(fingerprintBalanceRuleset(createBalanceRulesetPayload([metadataOnly], catalog))).toBe(
      original,
    );

    const swapped = defineProbabilityDistribution({
      ...distribution,
      entries: [normal, routine],
    });
    expect(fingerprintBalanceRuleset(createBalanceRulesetPayload([swapped], catalog))).not.toBe(
      original,
    );

    const valueChanged = defineProbabilityDistribution({
      ...distribution,
      entries: [sampleEntry('kind.routine', 0.31), normal],
    });
    expect(
      fingerprintBalanceRuleset(createBalanceRulesetPayload([valueChanged], catalog)),
    ).not.toBe(original);

    expect(
      fingerprintBalanceRuleset(createBalanceRulesetPayload([distribution], { items: ['y', 'x'] })),
    ).not.toBe(original);
  });

  it('ペーシング実行値は指紋へ含め、体験目標帯は除外する', () => {
    const ids = new Set(projectBalanceRegistry(BALANCE_REGISTRY).values.map((entry) => entry.id));
    expect(ids.has(PACING_BALANCE.fixedStepMs.id)).toBe(true);
    expect(ids.has(PACING_BALANCE.msPerTick1x.id)).toBe(true);
    expect(ids.has(PACING_BALANCE.sprintMinCompleteTick.id)).toBe(true);
    expect(ids.has(PACING_BALANCE.betweenSprintRecovery.id)).toBe(true);
    expect(ids.has(PACING_BALANCE.sprintWallMinTypicalMs.id)).toBe(false);
    expect(ids.has(PACING_BALANCE.bossWallMaxMs.id)).toBe(false);
    expect(ids.has(PACING_BALANCE.interventionPerSprintMax.id)).toBe(false);

    const sequences = projectBalanceRegistry(BALANCE_REGISTRY).sequences;
    expect(sequences[SPRINT_BALANCE.taskKindDistribution.id]).toEqual(
      SPRINT_BALANCE.taskKindDistribution.entries.map((entry) => entry.id),
    );
  });

  it('部門の名称・色やアクション文言だけでは指紋が変わらず、teamCount と定義順では変わる', () => {
    const baseCatalog = projectContentCatalog();
    const original = fingerprintBalanceRuleset(createBalanceRulesetPayload([], baseCatalog));

    const renamedDepartments = DEPARTMENT_DEFS.map((department) => ({
      ...department,
      name: `${department.name}改`,
      color: '#000000',
    }));
    expect(projectDepartments(renamedDepartments)).toEqual(projectDepartments());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          departments: projectDepartments(renamedDepartments),
        }),
      ),
    ).toBe(original);

    const counted = DEPARTMENT_DEFS.map((department, index) =>
      index === 0 ? { ...department, teamCount: department.teamCount + 1 } : department,
    );
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          departments: projectDepartments(counted),
        }),
      ),
    ).not.toBe(original);

    const relabeledActions = ACTION_CONTENT_DEFS.map((action) => ({
      ...action,
      label: `${action.label}改`,
      icon: 'x',
      description: '表示専用',
      sideEffect: '表示専用',
    }));
    expect(projectActions(relabeledActions)).toEqual(projectActions());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          actions: projectActions(relabeledActions),
        }),
      ),
    ).toBe(original);

    const reorderedActions = [...ACTION_CONTENT_DEFS].reverse();
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          actions: projectActions(reorderedActions),
        }),
      ),
    ).not.toBe(original);
  });

  it('tags だけでは指紋対象が変わらず、安定ID接頭辞で体験目標帯を除外する', () => {
    const taggedRuntime = sampleEntry(PACING_BALANCE.fixedStepMs.id, 100, {
      tags: ['validation', 'target-band'],
    });
    const untaggedTarget = sampleEntry(PACING_BALANCE.sprintWallMinTypicalMs.id, 60_000, {
      tags: ['execution'],
    });
    const ids = projectBalanceRegistry([taggedRuntime, untaggedTarget]).values.map(
      (entry) => entry.id,
    );
    expect(ids).toEqual([PACING_BALANCE.fixedStepMs.id]);
  });

  it('難易度レコードのキー順やイベント既定重み、既定シナリオを正規化する', () => {
    const baseCatalog = projectContentCatalog();
    const original = fingerprintBalanceRuleset(createBalanceRulesetPayload([], baseCatalog));

    const shuffledDifficultyKeys = Object.fromEntries(
      [...Object.entries(DIFFICULTY_DEFS)].reverse(),
    );
    expect(projectDifficulties(shuffledDifficultyKeys)).toEqual(projectDifficulties());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          difficulties: projectDifficulties(shuffledDifficultyKeys),
        }),
      ),
    ).toBe(original);

    const swappedDifficultyKeys = {
      ...DIFFICULTY_DEFS,
      easy: DIFFICULTY_DEFS.normal,
      normal: DIFFICULTY_DEFS.easy,
    };
    expect(projectDifficulties(swappedDifficultyKeys)).not.toEqual(projectDifficulties());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          difficulties: projectDifficulties(swappedDifficultyKeys),
        }),
      ),
    ).not.toBe(original);

    const unspecified = EVENT_DEFS.find((event) => event.weight === undefined);
    expect(unspecified).toBeDefined();
    expect(projectEvents([unspecified!])).toEqual(projectEvents([{ ...unspecified!, weight: 1 }]));

    const omittedLeadsTo = EVENT_DEFS.find((event) =>
      event.choices.some((choice) => choice.leadsTo === undefined),
    );
    expect(omittedLeadsTo).toBeDefined();
    expect(projectEvents([omittedLeadsTo!])).toEqual(
      projectEvents([
        {
          ...omittedLeadsTo!,
          choices: omittedLeadsTo!.choices.map((choice) => ({
            ...choice,
            leadsTo: choice.leadsTo ?? 'sprint',
          })),
        },
      ]),
    );

    expect(projectScenarios().defaultId).toBe(DEFAULT_SCENARIO);
    expect(projectScenarios().order).toEqual([...SCENARIO_ORDER]);
    expect(projectScenarios().entries.map((entry) => entry.key)).toEqual(
      [...Object.keys(SCENARIOS)].sort(compareCanonicalStrings),
    );
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          scenarios: projectScenarios(SCENARIOS, SCENARIO_ORDER, 'copilot'),
        }),
      ),
    ).not.toBe(original);

    const extraScenarios: Record<string, (typeof SCENARIOS)[keyof typeof SCENARIOS]> = {
      ...SCENARIOS,
      hidden: SCENARIOS.default,
    };
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          scenarios: projectScenarios(extraScenarios, SCENARIO_ORDER, DEFAULT_SCENARIO),
        }),
      ),
    ).not.toBe(original);

    const titleOnlyOrder = [...SCENARIO_ORDER].slice(0, -1);
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          scenarios: projectScenarios(SCENARIOS, titleOnlyOrder, DEFAULT_SCENARIO),
        }),
      ),
    ).not.toBe(original);
  });

  it('難易度・試練の省略値とメンバー名プールを実効値として指紋へ含める', () => {
    const baseCatalog = projectContentCatalog();
    const original = fingerprintBalanceRuleset(createBalanceRulesetPayload([], baseCatalog));
    const defaultAiDependencyPerTask = PROCESS_BALANCE.aiDependencyPerTask.value;

    const easy = DIFFICULTY_DEFS.easy;
    expect(easy.aiDependencyPerTask).toBeUndefined();
    expect(projectDifficulties().find((entry) => entry.key === 'easy')?.aiDependencyPerTask).toBe(
      defaultAiDependencyPerTask,
    );
    const explicitDefaultDifficulty = {
      ...DIFFICULTY_DEFS,
      easy: { ...easy, aiDependencyPerTask: defaultAiDependencyPerTask },
    };
    expect(projectDifficulties(explicitDefaultDifficulty)).toEqual(projectDifficulties());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          difficulties: projectDifficulties(explicitDefaultDifficulty),
        }),
      ),
    ).toBe(original);

    const explicitTrialDefaults = TRIAL_DEFS.map((trial) => ({
      ...trial,
      focusDelta: trial.focusDelta ?? 0,
      budgetMul: trial.budgetMul ?? 1,
      aiDependencyDriftPerSprint: trial.aiDependencyDriftPerSprint ?? 0,
      frontierModelCostPerDependency: trial.frontierModelCostPerDependency ?? 0,
    }));
    expect(projectTrials(explicitTrialDefaults)).toEqual(projectTrials());
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          trials: projectTrials(explicitTrialDefaults),
        }),
      ),
    ).toBe(original);

    expect(projectMembers().names).toEqual([...MEMBER_NAMES]);
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...baseCatalog,
          members: projectMembers(undefined, undefined, [...MEMBER_NAMES, '追加']),
        }),
      ),
    ).not.toBe(original);
  });
});
