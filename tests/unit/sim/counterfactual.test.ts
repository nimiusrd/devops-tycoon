import { describe, expect, it } from 'vitest';
import {
  effectiveActionsOf,
  evaluateCounterfactual,
  evaluateLatestEffectiveFrame,
  isDangerLeft,
  isEffectiveChoice,
  judgeF8Recovery,
  judgeF9EffectiveSets,
  restoreCounterfactualEngine,
  type CounterfactualBranchResult,
} from '../../../src/sim/run/counterfactual';
import { activeDangerReasons, listApplicableActions } from '../../../src/sim/run/dangerZone';
import { RunEngine } from '../../../src/sim/run/engine';
import type { ActionId } from '../../../src/sim/types';
import { runOnce } from '../../playtest/harness';

function startedSprint(seed: string, difficulty: 'easy' | 'normal' | 'nightmare' = 'normal') {
  const engine = new RunEngine({ seed, difficulty });
  engine.startRun(difficulty, [], seed);
  engine.beginSetupSprint();
  return engine;
}

function branch(
  overrides: Partial<CounterfactualBranchResult> & Pick<CounterfactualBranchResult, 'actionId'>,
): CounterfactualBranchResult {
  return {
    sprintsToLose: 3,
    leftDanger: false,
    loseReason: 'seniorBurnout',
    status: 'lost',
    truncated: false,
    ...overrides,
  };
}

describe('RI-101 反実仮想フレーム', () => {
  it('同一フレームから復元した2エンジンは同じ step / dispatch 列で一致する', () => {
    const source = startedSprint('ri-101-clone');
    source.step(800);
    source.dispatch('overtime');
    const frame = source.exportCounterfactualFrame();
    expect(frame).not.toBeNull();
    expect(source.exportPersistState()).toBeNull();

    const a = restoreCounterfactualEngine(frame!);
    const b = restoreCounterfactualEngine(frame!);
    expect(a.snapshot()).toEqual(b.snapshot());

    a.step(400);
    b.step(400);
    a.dispatch('andon');
    b.dispatch('andon');
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('復元後の乱数列は元エンジンの続きと一致する', () => {
    const source = startedSprint('ri-101-rng-fork');
    source.step(400);
    const frame = source.exportCounterfactualFrame()!;
    const restored = restoreCounterfactualEngine(frame);
    source.step(1_200);
    restored.step(1_200);
    expect(restored.snapshot()).toEqual(source.snapshot());
  });
});

describe('RI-101 分岐評価と上限', () => {
  it('無介入と適用可能介入を分岐し、上限超過は skipped に残す', () => {
    const engine = startedSprint('ri-101-cap');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const applicable = listApplicableActions(engine);
    const forced = [
      ...applicable,
      'interruptReview',
      'splitPr',
      'firefight',
      'assignTask',
      'aiThrottle',
      'pairReview',
      'overtime',
      'andon',
      'overtime',
    ] as ActionId[];
    const evaluation = evaluateCounterfactual(frame, {
      actions: forced,
      maxActionBranches: 2,
      maxSprints: 1,
    });
    expect(evaluation.baseline.actionId).toBeNull();
    expect(evaluation.branches).toHaveLength(2);
    expect(evaluation.skippedActions).toEqual(forced.slice(2));
    expect(evaluation.applicableActions).toEqual(forced);
  });

  it('maxSprints 到達後も setup まで終端遷移を進めてから打ち切る', () => {
    const engine = startedSprint('ri-101-horizon');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { actions: [], maxSprints: 1 });
    if (evaluation.baseline.truncated) {
      expect(evaluation.baseline.status).toBe('playing');
      expect(evaluation.baseline.sprintsToLose).toBeNull();
    }
    const restored = restoreCounterfactualEngine(frame);
    restored.step(1_000_000);
    if (restored.snapshot().status === 'playing') {
      expect([
        'result',
        'draft',
        'evolution',
        'beat',
        'shop',
        'rest',
        'recruit',
        'setup',
      ]).toContain(restored.snapshot().phase);
    }
  });

  it('敗北までのスプリント数は分岐開始からの相対値である', () => {
    const engine = startedSprint('ri-101-relative-lose', 'nightmare');
    engine.step(200);
    const startPlayed = engine.snapshot().sprintsPlayed;
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { actions: [], maxSprints: 2 });
    if (evaluation.baseline.status === 'lost' && evaluation.baseline.sprintsToLose != null) {
      expect(evaluation.baseline.sprintsToLose).toBeGreaterThanOrEqual(0);
      expect(evaluation.baseline.sprintsToLose).toBeLessThanOrEqual(2);
      expect(evaluation.baseline.sprintsToLose).toBeLessThanOrEqual(
        evaluation.origin.sprintsPlayed + 2 - startPlayed + 2,
      );
    }
  });

  it('危険域と発動可能手をフレーム時点で記録する', () => {
    const engine = startedSprint('ri-101-danger-list', 'nightmare');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { maxSprints: 1, maxActionBranches: 8 });
    expect(evaluation.origin.sprintsPlayed).toBe(engine.snapshot().sprintsPlayed);
    expect(evaluation.originDangers).toEqual(activeDangerReasons(engine));
    expect(evaluation.applicableActions).toEqual(listApplicableActions(engine));
  });
});

describe('RI-101 集計規則', () => {
  const baseline = branch({ actionId: null, sprintsToLose: 3, loseReason: 'seniorBurnout' });

  it('遅延・回避・危険域離脱・敗因変化だけを有効とする', () => {
    expect(isEffectiveChoice(baseline, branch({ actionId: 'andon' }))).toBe(false);
    expect(isEffectiveChoice(baseline, branch({ actionId: 'overtime', sprintsToLose: 5 }))).toBe(
      true,
    );
    expect(
      isEffectiveChoice(
        baseline,
        branch({ actionId: 'aiThrottle', status: 'won', sprintsToLose: null, loseReason: null }),
      ),
    ).toBe(true);
    expect(isEffectiveChoice(baseline, branch({ actionId: 'firefight', leftDanger: true }))).toBe(
      true,
    );
    expect(
      isEffectiveChoice(
        baseline,
        branch({ actionId: 'interruptReview', loseReason: 'reviewFreeze' }),
      ),
    ).toBe(true);
    expect(
      isEffectiveChoice(
        { ...baseline, leftDanger: true },
        branch({ actionId: 'andon', leftDanger: true }),
      ),
    ).toBe(false);
  });

  it('F-8 は有効手が残る最後の時点だけを見る', () => {
    const judgment = judgeF8Recovery(
      [
        { sprintsPlayed: 1, effectiveActions: ['andon'] },
        { sprintsPlayed: 2, effectiveActions: [] },
        { sprintsPlayed: 4, effectiveActions: ['overtime'] },
        { sprintsPlayed: 5, effectiveActions: [] },
      ],
      8,
    );
    expect(judgment).toEqual({
      lastEffectiveSprints: 4,
      gap: 4,
      hasRecovery: true,
    });
    expect(judgeF8Recovery([{ sprintsPlayed: 2, effectiveActions: [] }], 6)).toEqual({
      lastEffectiveSprints: null,
      gap: null,
      hasRecovery: false,
    });
  });

  it('危険域離脱は focus した敗因だけを見る', () => {
    const origin = new Set(['aiDependency', 'bossFailed'] as const);
    expect(isDangerLeft(origin, ['bossFailed'], 'aiDependency')).toBe(true);
    expect(isDangerLeft(origin, ['aiDependency', 'bossFailed'], 'aiDependency')).toBe(false);
    expect(isDangerLeft(origin, ['bossFailed'])).toBe(true);
    expect(isDangerLeft(origin, ['aiDependency', 'bossFailed'])).toBe(false);
    expect(isDangerLeft(origin, ['bossFailed'], 'reviewFreeze')).toBe(false);
  });

  it('有効手があるフレームまで新しい順に遡る', () => {
    const engine = startedSprint('ri-101-walkback');
    engine.step(200);
    const older = engine.exportCounterfactualFrame()!;
    engine.step(400);
    const newer = engine.exportCounterfactualFrame()!;
    const empty = evaluateLatestEffectiveFrame(
      [
        { sprintsPlayed: 0, quarter: 1, index: 1, frame: older },
        { sprintsPlayed: 0, quarter: 1, index: 1, frame: newer },
      ],
      { actions: [], maxSprints: 1 },
    );
    expect(empty).not.toBeNull();
    if (empty && empty.effective.length === 0) {
      expect(empty.evaluation.origin).toEqual(
        evaluateCounterfactual(newer, { actions: [], maxSprints: 1 }).origin,
      );
    }
  });

  it('F-9 は敗因別の有効手集合を機械的集合と別に数える', () => {
    const judgment = judgeF9EffectiveSets([
      { loseReason: 'seniorBurnout', effectiveActions: ['overtime'] },
      { loseReason: 'seniorBurnout', effectiveActions: ['andon'] },
      { loseReason: 'reviewFreeze', effectiveActions: ['interruptReview'] },
      { loseReason: 'aiDependency', effectiveActions: [] },
    ]);
    expect(judgment.byReason.seniorBurnout).toEqual(['andon', 'overtime']);
    expect(judgment.byReason.reviewFreeze).toEqual(['interruptReview']);
    expect(judgment.byReason.aiDependency).toEqual([]);
    expect(judgment.distinctEffectiveSetCount).toBe(3);
  });
});

describe('RI-101 プレイテストオプトイン', () => {
  it('PT_COUNTERFACTUAL=1 の短い敗北ランに有効手フィールドを付ける', () => {
    const prev = process.env.PT_COUNTERFACTUAL;
    process.env.PT_COUNTERFACTUAL = '1';
    try {
      const log = runOnce('pt-1', 'nightmare', 'idle');
      expect(log.status).toBe('lost');
      expect(log.loseReason).toBeTruthy();
      if (log.availableActionsInDangerLastNonEmpty) {
        expect(Array.isArray(log.effectiveActionsInDanger)).toBe(true);
        expect(log.counterfactualBaseline).toMatchObject({
          leftDanger: expect.any(Boolean),
          truncated: expect.any(Boolean),
        });
        if ((log.effectiveActionsInDanger?.length ?? 0) > 0) {
          expect(log.lastEffectiveActionsAt?.actions).toEqual(log.effectiveActionsInDanger);
        } else {
          expect(log.lastEffectiveActionsAt).toBeUndefined();
        }
      }
    } finally {
      if (prev === undefined) delete process.env.PT_COUNTERFACTUAL;
      else process.env.PT_COUNTERFACTUAL = prev;
    }
  });

  it('オプトインなしでは反実仮想フィールドを付けない', () => {
    const prev = process.env.PT_COUNTERFACTUAL;
    delete process.env.PT_COUNTERFACTUAL;
    try {
      const log = runOnce('pt-1', 'nightmare', 'idle');
      expect(log.status).toBe('lost');
      expect(log.effectiveActionsInDanger).toBeUndefined();
      expect(log.counterfactualBaseline).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.PT_COUNTERFACTUAL;
      else process.env.PT_COUNTERFACTUAL = prev;
    }
  });
});

describe('RI-101 合成危険状態', () => {
  it('無介入が負け、指定介入だけが遅延する評価を有効手として拾う', () => {
    const engine = startedSprint('ri-101-effective-fixture');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      actions: ['overtime', 'andon'],
      maxSprints: 2,
    });
    const synthetic = {
      ...evaluation,
      baseline: branch({ actionId: null, sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      branches: [
        branch({ actionId: 'overtime', sprintsToLose: 4, loseReason: 'moraleCollapse' }),
        branch({ actionId: 'andon', sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['overtime']);
    expect(
      judgeF8Recovery(
        [{ sprintsPlayed: synthetic.origin.sprintsPlayed, effectiveActions: ['overtime'] }],
        4,
      ).hasRecovery,
    ).toBe(true);
    expect(
      judgeF9EffectiveSets([
        { loseReason: 'moraleCollapse', effectiveActions: effectiveActionsOf(synthetic) },
        { loseReason: 'reviewFreeze', effectiveActions: ['interruptReview'] },
      ]).distinctEffectiveSetCount,
    ).toBe(2);
  });
});
