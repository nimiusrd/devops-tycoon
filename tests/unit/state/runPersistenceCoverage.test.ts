import { deleteDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { createRunEngine } from '../../../src/sim/run/engine';
import type { GoalKpiProgress, QuarterGoal } from '../../../src/sim/run/types';
import {
  CURRENT_RUN_RULESET,
  getRunSaveCompatibilityIssue,
  IndexedDbRunStorage,
  initializeRunPersistence,
  MemoryRunStorage,
  parseRunSave,
  RUN_SAVE_SCHEMA_VERSION,
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

/** 保存時の目標・実績・報酬前後の値が異なる四半期レビュー。 */
function makeReviewSave(): RunSave {
  const save = makeSave();
  const goal: QuarterGoal = {
    deliveryTarget: 1800,
    qualityTarget: 50,
    techDebtLimit: 60,
    moraleTarget: 50,
    incidentLimit: 5,
    aiAdoptionTarget: 50,
  };
  const progress: GoalKpiProgress[] = [
    { id: 'delivery', label: '保存済み Delivery', target: 1800, actual: 2250, status: 'exceeded' },
    { id: 'quality', label: 'Quality', target: 50, actual: 50, status: 'met' },
    { id: 'techDebt', label: 'Tech Debt', target: 60, actual: 60, status: 'met' },
    { id: 'morale', label: 'Morale', target: 50, actual: 50, status: 'met' },
    { id: 'incident', label: 'Incident', target: 5, actual: 5, status: 'met' },
    { id: 'aiAdoption', label: 'AI Adoption', target: 50, actual: 50, status: 'met' },
  ];
  save.summary.phase = 'quarterReview';
  save.summary.quarterNumber = 2;
  save.state.phase = 'quarterReview';
  save.state.quarterNumber = 2;
  save.state.quarterGoal = goal;
  save.state.quarterTotals = {
    ...save.state.quarterTotals,
    delivered: 2250,
    completed: 10,
    aiAssisted: 5,
    incidents: 5,
  };
  save.state.budget = 100;
  save.state.stakeholderTrust = { management: 80, customers: 80, team: 80 };
  save.state.org = { ...save.state.org, quality: 99, techDebt: 0, morale: 99, seniorHp: 99 };
  save.state.extras.winEvalOrg = { ...save.state.org, seniorHp: 5 };
  save.state.reviewHistory = ['exceeded', 'exceeded'];
  save.state.quarterReview = {
    goal,
    outcome: 'exceeded',
    trust: { management: 70, customers: 70, team: 70 },
    progress,
    missedReasons: ['保存済みレビューの診断'],
    availableAdjustments: ['cut_scope'],
    bossCleared: true,
  };
  return save;
}

describe('ランセーブの互換性境界', () => {
  it.each([4, 5, 6, 7, RUN_SAVE_SCHEMA_VERSION])(
    'ルールセット不明の v%s は目標・レビュー・履歴を再計算せず保持する',
    (schemaVersion) => {
      const save = makeReviewSave();
      const raw = {
        ...save,
        schemaVersion,
        ruleset: schemaVersion === RUN_SAVE_SCHEMA_VERSION ? null : save.ruleset,
      };
      const before = structuredClone(raw);

      const parsed = parseRunSave(raw);

      expect(parsed?.ruleset).toBeNull();
      expect(parsed?.summary).toEqual(raw.summary);
      expect(parsed?.state).toEqual(raw.state);
      expect(parsed?.state.quarterReview).not.toBe(raw.state.quarterReview);
      expect(parsed?.state.quarterGoal).not.toBe(raw.state.quarterGoal);
      expect(getRunSaveCompatibilityIssue(parsed!)).toMatchObject({
        kind: 'ruleset-unknown',
        summary: raw.summary,
        savedRuleset: null,
      });
      expect(parseRunSave(parsed)).toEqual(parsed);
      parsed!.state.quarterReview!.progress[0]!.target = 0;
      parsed!.state.extras.winEvalOrg!.seniorHp = 100;
      expect(raw).toEqual(before);
    },
  );

  it('現行 v8 は保存済みレビューを維持して再開できる', async () => {
    const save = makeReviewSave();
    const storage = new MemoryRunStorage();
    await storage.save(save);

    const boot = await initializeRunPersistence(storage);

    expect(boot.issue).toBeNull();
    expect(boot.save).toEqual(save);
    const restored = createRunEngine({ seed: 'restored-review' });
    restored.hydratePersistState(boot.save!.state);
    expect(restored.snapshot()).toMatchObject({
      phase: 'quarterReview',
      quarterGoal: save.state.quarterGoal,
      quarterReview: save.state.quarterReview,
      reviewHistory: save.state.reviewHistory,
    });
  });

  it.each([4, 5, 6, 7])('v%s でも壊れた要約・状態の基本構造は拒否する', (schemaVersion) => {
    const save = { ...makeSave(), schemaVersion };

    expect(parseRunSave({ ...save, summary: { ...save.summary, phase: 'sprint' } })).toBeNull();
    expect(parseRunSave({ ...save, state: { ...save.state, seed: 'different-seed' } })).toBeNull();
    expect(parseRunSave({ ...save, state: { ...save.state, extras: null } })).toBeNull();
  });
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
