import { deleteDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { createRunEngine } from '../../../src/sim/run/engine';
import type { GoalKpiProgress, QuarterGoal } from '../../../src/sim/run/types';
import {
  CURRENT_RUN_RULESET,
  getRunSaveCompatibilityIssue,
  IndexedDbRunStorage,
  parseRunSave,
  toRunSave,
  type RunSave,
} from '../../../src/state/runPersistence';

import 'fake-indexeddb/auto';

function makeSave(seed = 'run-persistence-coverage'): RunSave {
  const engine = createRunEngine({ seed });
  engine.startRun('normal', [], seed);
  const state = engine.exportPersistState();
  if (!state) throw new Error('編成画面の保存状態を取得できませんでした');
  return toRunSave(state, 1234);
}

/** v5 normal の Delivery 目標 1800 は現行スキーマで 2250 に移行する。 */
function makeLegacyReview(includeAi = false) {
  const save = makeSave();
  const goal: QuarterGoal = {
    deliveryTarget: 1800,
    qualityTarget: 50,
    techDebtLimit: 60,
    moraleTarget: 50,
    incidentLimit: 5,
    ...(includeAi ? { aiAdoptionTarget: 50 } : {}),
  };
  const progress: GoalKpiProgress[] = [
    { id: 'delivery', label: 'Delivery', target: 1800, actual: 2250, status: 'exceeded' },
    { id: 'quality', label: 'Quality', target: 50, actual: 50, status: 'met' },
    { id: 'techDebt', label: 'Tech Debt', target: 60, actual: 60, status: 'met' },
    { id: 'morale', label: 'Morale', target: 50, actual: 50, status: 'met' },
    { id: 'incident', label: 'Incident', target: 5, actual: 5, status: 'met' },
  ];
  if (includeAi) {
    progress.push({
      id: 'aiAdoption',
      label: 'AI Adoption',
      target: 50,
      actual: 50,
      status: 'met',
    });
  }
  save.summary.phase = 'quarterReview';
  save.summary.quarterNumber = 2;
  save.state.phase = 'quarterReview';
  save.state.quarterNumber = 2;
  save.state.quarterGoal = goal;
  save.state.quarterTotals = {
    ...save.state.quarterTotals,
    delivered: 2250,
    completed: 10,
    aiAssisted: includeAi ? 5 : 0,
    incidents: 5,
  };
  save.state.budget = 100;
  save.state.stakeholderTrust = { management: 80, customers: 80, team: 80 };
  // 古い単一チームセーブを想定し、報酬後の組織値は保存済み KPI 実績と分ける。
  save.state.extras.teams = undefined;
  save.state.extras.winEvalOrg = null;
  save.state.org = { ...save.state.org, quality: 99, techDebt: 0, morale: 99, seniorHp: 99 };
  save.state.reviewHistory = ['exceeded', 'exceeded'];
  save.state.quarterReview = {
    goal,
    outcome: 'exceeded',
    trust: { ...save.state.stakeholderTrust },
    progress,
    missedReasons: ['旧レビューの診断'],
    availableAdjustments: ['cut_scope'],
    bossCleared: true,
  };
  return { ...save, schemaVersion: 5 };
}

describe('旧ランセーブの四半期レビュー移行', () => {
  it('保存済みの AI KPI を含む実績で達成を再判定し、履歴の末尾だけを更新する', () => {
    const legacy = makeLegacyReview(true);
    const before = structuredClone(legacy);

    const parsed = parseRunSave(legacy);

    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(2250);
    expect(parsed?.state.quarterReview).toEqual({
      goal: { ...legacy.state.quarterGoal, deliveryTarget: 2250 },
      outcome: 'met',
      trust: { management: 80, customers: 80, team: 80 },
      progress: legacy.state.quarterReview!.progress.map((item) =>
        item.id === 'delivery' ? { ...item, target: 2250, status: 'met' } : item,
      ),
      missedReasons: [],
      availableAdjustments: [],
      bossCleared: true,
    });
    expect(parsed?.state.reviewHistory).toEqual(['exceeded', 'met']);
    expect(legacy).toEqual(before);
    expect(getRunSaveCompatibilityIssue(parsed!)).toMatchObject({ kind: 'ruleset-unknown' });
  });

  it('全 KPI が超過達成なら exceeded を保存し、欠落した履歴に結果を追加する', () => {
    const legacy = makeLegacyReview();
    legacy.state.reviewHistory = [];
    const actuals: Record<string, number> = {
      delivery: 2700,
      quality: 70,
      techDebt: 30,
      morale: 70,
      incident: 0,
    };
    legacy.state.quarterReview!.progress = legacy.state.quarterReview!.progress.map((item) => ({
      ...item,
      actual: actuals[item.id]!,
    }));
    legacy.state.quarterTotals.delivered = 2700;
    legacy.state.quarterTotals.incidents = 0;

    const parsed = parseRunSave(legacy);

    expect(parsed?.state.quarterReview?.outcome).toBe('exceeded');
    expect(parsed?.state.quarterReview?.progress.map((item) => item.status)).toEqual([
      'exceeded',
      'exceeded',
      'exceeded',
      'exceeded',
      'exceeded',
    ]);
    expect(parsed?.state.quarterReview?.missedReasons).toEqual([]);
    expect(parsed?.state.reviewHistory).toEqual(['exceeded']);
  });

  it('未達でも信頼と予算に調整の余地がなければ危機状態へ移行する', () => {
    const legacy = makeLegacyReview();
    legacy.state.stakeholderTrust = { management: 16, customers: 16, team: 16 };
    legacy.state.budget = 1;
    legacy.state.quarterReview!.progress[0]!.actual = 1800;
    legacy.state.quarterTotals.delivered = 1800;

    const parsed = parseRunSave(legacy);

    expect(parsed?.state.quarterReview).toMatchObject({
      outcome: 'missed_crisis',
      trust: { management: 16, customers: 16, team: 16 },
      availableAdjustments: [],
      missedReasons: ['スコープ過多: 出荷目標に対して Delivery が不足している。'],
    });
    expect(parsed?.state.reviewHistory).toEqual(['exceeded', 'missed_crisis']);
  });

  it('報酬前の seniorHp が残っていれば、報酬後の回復値で shutdown を回避しない', () => {
    const legacy = makeLegacyReview();
    legacy.state.extras.winEvalOrg = { ...legacy.state.org, seniorHp: 5 };
    legacy.state.quarterReview!.progress[0]!.actual = 1800;
    legacy.state.quarterReview!.progress[1]!.actual = 40;
    legacy.state.quarterTotals.delivered = 1800;

    const parsed = parseRunSave(legacy);

    expect(parsed?.state.quarterReview?.outcome).toBe('shutdown');
    expect(parsed?.state.quarterReview?.availableAdjustments).toEqual([]);
    expect(parsed?.state.org.seniorHp).toBe(99);
    expect(parsed?.state.reviewHistory).toEqual(['exceeded', 'shutdown']);
  });

  it.each([
    ['重複した KPI', (progress: GoalKpiProgress[]) => [...progress, progress[0]]],
    ['必須 KPI の欠落', (progress: GoalKpiProgress[]) => progress.slice(1)],
    [
      '未知の KPI',
      (progress: GoalKpiProgress[]) => [...progress, { ...progress[0], id: 'unknown' }],
    ],
    [
      '目標にない AI KPI',
      (progress: GoalKpiProgress[]) => [...progress, { ...progress[0], id: 'aiAdoption' }],
    ],
    ['配列以外の進捗', () => null],
    ['壊れた KPI 要素', (progress: GoalKpiProgress[]) => [...progress, null]],
    [
      '非有限の実績',
      (progress: GoalKpiProgress[]) => [{ ...progress[0], actual: Infinity }, ...progress.slice(1)],
    ],
    [
      '不明な達成状態',
      (progress: GoalKpiProgress[]) => [
        { ...progress[0], status: 'pending' },
        ...progress.slice(1),
      ],
    ],
  ])('%s を含むレビューは推測で補完せず拒否する', (_label, changeProgress) => {
    const legacy = makeLegacyReview();
    const raw = {
      ...legacy,
      state: {
        ...legacy.state,
        quarterReview: {
          ...legacy.state.quarterReview,
          progress: changeProgress(legacy.state.quarterReview!.progress),
        },
      },
    };

    expect(parseRunSave(raw)).toBeNull();
  });

  it('AI 目標があるのに対応する実績が欠落したレビューを拒否する', () => {
    const legacy = makeLegacyReview();
    legacy.state.quarterGoal.aiAdoptionTarget = 50;

    expect(parseRunSave(legacy)).toBeNull();
  });

  it.each([null, { bossCleared: 'true' }])(
    'レビュー本体が壊れている場合は拒否する: %j',
    (review) => {
      const legacy = makeLegacyReview();

      expect(
        parseRunSave({ ...legacy, state: { ...legacy.state, quarterReview: review } }),
      ).toBeNull();
    },
  );

  it.each([null, { deliveryTarget: '1800' }, { deliveryTarget: Infinity }])(
    '移行できる数値目標を持たない旧セーブは拒否する: %j',
    (quarterGoal) => {
      const legacy = makeLegacyReview();

      expect(parseRunSave({ ...legacy, state: { ...legacy.state, quarterGoal } })).toBeNull();
    },
  );
});

describe('ランセーブのルールセット検証', () => {
  it.each(['easy', 'unknown'])(
    '状態の難易度 %s が要約と一致しないセーブを拒否する',
    (difficulty) => {
      const save = makeSave();

      expect(parseRunSave({ ...save, state: { ...save.state, difficulty } })).toBeNull();
    },
  );

  it.each([
    'invalid',
    [],
    {},
    { ...CURRENT_RUN_RULESET, version: 0 },
    { ...CURRENT_RUN_RULESET, version: 1.5 },
    { ...CURRENT_RUN_RULESET, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...CURRENT_RUN_RULESET, fingerprint: '' },
    { ...CURRENT_RUN_RULESET, fingerprint: 123 },
  ])('壊れた現行ルールセットは構造破損として拒否する: %j', (ruleset) => {
    expect(parseRunSave({ ...makeSave(), ruleset })).toBeNull();
  });

  it('バージョンだけが異なるセーブも非互換とし、診断情報は元の値から独立させる', () => {
    const save = makeSave();
    const ruleset = { ...CURRENT_RUN_RULESET, version: CURRENT_RUN_RULESET.version + 1 };
    save.ruleset = ruleset;
    const originalRuleset = { ...save.ruleset };
    const originalSummary = structuredClone(save.summary);

    const issue = getRunSaveCompatibilityIssue(save);
    save.summary.trials.push('changed-after-check');
    save.summary.seed = 'changed-after-check';
    ruleset.fingerprint = 'changed-after-check';

    expect(issue).toEqual({
      kind: 'ruleset-mismatch',
      summary: originalSummary,
      savedRuleset: originalRuleset,
      currentRuleset: CURRENT_RUN_RULESET,
    });
    expect(issue?.currentRuleset).not.toBe(CURRENT_RUN_RULESET);
  });
});

describe('ランセーブ書き込み障害からの復旧', () => {
  it('容量不足で保存に失敗しても前のセーブを維持し、次の保存を継続する', async () => {
    const dbName = 'run-persistence-coverage-save-recovery';
    const storage = new IndexedDbRunStorage(dbName);
    const original = makeSave('before-storage-error');
    try {
      await storage.save(original);
      const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
        throw new DOMException('保存容量が不足しています', 'QuotaExceededError');
      });
      try {
        await expect(storage.save(makeSave('failed-write'))).rejects.toMatchObject({
          name: 'QuotaExceededError',
        });
      } finally {
        putSpy.mockRestore();
      }

      expect(await storage.load()).toEqual(original);
      const recovered = makeSave('after-storage-error');
      await storage.save(recovered);
      expect(await storage.load()).toEqual(recovered);
    } finally {
      await deleteDB(dbName);
    }
  });
});
