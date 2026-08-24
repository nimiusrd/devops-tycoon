import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BALANCE_REGISTRY,
  BALANCE_RULESET_FINGERPRINT,
  BALANCE_RULESET_FINGERPRINT_SCHEME,
  BALANCE_RULESET_PAYLOAD,
  BALANCE_RULESET_VERSION,
  BALANCE_RULESET_VERSION_POLICY,
  canonicalizeJson,
  createBalanceRulesetPayload,
  defineBalanceEntry,
  defineProbabilityDistribution,
  fingerprintBalanceRuleset,
  INITIAL_UNLOCKED_DIFFICULTIES,
  META_BALANCE,
  PACING_BALANCE,
  projectBalanceRegistry,
  sha256Hex,
} from '../../../src/data/balance';
import { CONTENT_CATALOG, projectEvent } from '../../../src/data/contentCatalog';
import {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  DIFFICULTY_ORDER,
} from '../../../src/data/difficulties';
import { EVENT_DEFS } from '../../../src/data/events';
import { DEFAULT_SCENARIO } from '../../../src/sim/scenarios';
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
  it('現行ルールセットの版は 4、指紋は 64 桁 hex で再計算と一致する', () => {
    expect(BALANCE_RULESET_VERSION).toBe(4);
    expect(BALANCE_RULESET_FINGERPRINT_SCHEME).toBe(1);
    expect(BALANCE_RULESET_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintBalanceRuleset(BALANCE_RULESET_PAYLOAD)).toBe(BALANCE_RULESET_FINGERPRINT);
    expect(BALANCE_RULESET_PAYLOAD.catalog).toBe(CONTENT_CATALOG);
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

  it('メタ進行の実行値は指紋へ含め、デイリー条件はカタログ経路のままにする', () => {
    const ids = new Set(projectBalanceRegistry(BALANCE_REGISTRY).values.map((entry) => entry.id));
    expect(ids.has(META_BALANCE.preferredMaxCards.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardWinBase.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardLossBase.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardScoreMulFloor.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardLearningBase.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardLearningPerReview.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardLearningCap.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardReviewExceeded.id)).toBe(true);
    expect(ids.has(META_BALANCE.rewardReviewMet.id)).toBe(true);
    expect(ids.has(META_BALANCE.achievementComboMasterMinCombo.id)).toBe(true);
    expect(ids.has('meta.daily.difficulty')).toBe(false);
    expect(ids.has('meta.daily.trials')).toBe(false);
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

  it('RI-115 カタログを指紋入力にし、イベント既定値と開始条件を正規化する', () => {
    expect(CONTENT_CATALOG.defaultScenarioId).toBe(DEFAULT_SCENARIO);
    expect(CONTENT_CATALOG.difficultyOrder).toEqual([...DIFFICULTY_ORDER]);
    expect(CONTENT_CATALOG.daily).toEqual({
      difficulty: DAILY_RUN_DIFFICULTY,
      trials: [...DAILY_RUN_TRIALS],
    });
    expect(CONTENT_CATALOG.initialUnlockedDifficulties).toEqual([...INITIAL_UNLOCKED_DIFFICULTIES]);

    const unspecified = EVENT_DEFS.find((event) => event.weight === undefined);
    expect(unspecified).toBeDefined();
    expect(projectEvent(unspecified!)).toEqual(projectEvent({ ...unspecified!, weight: 1 }));

    const omittedLeadsTo = EVENT_DEFS.find((event) =>
      event.choices.some((choice) => choice.leadsTo === undefined),
    );
    expect(omittedLeadsTo).toBeDefined();
    expect(projectEvent(omittedLeadsTo!)).toEqual(
      projectEvent({
        ...omittedLeadsTo!,
        choices: omittedLeadsTo!.choices.map((choice) => ({
          ...choice,
          leadsTo: choice.leadsTo ?? 'sprint',
        })),
      }),
    );

    const original = fingerprintBalanceRuleset(createBalanceRulesetPayload([], CONTENT_CATALOG));
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...CONTENT_CATALOG,
          daily: { difficulty: 'hard', trials: ['flammable'] },
        }),
      ),
    ).not.toBe(original);
    expect(
      fingerprintBalanceRuleset(
        createBalanceRulesetPayload([], {
          ...CONTENT_CATALOG,
          initialUnlockedDifficulties: ['easy'],
        }),
      ),
    ).not.toBe(original);
  });
});
