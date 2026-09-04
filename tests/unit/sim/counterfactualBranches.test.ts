import { describe, expect, it } from 'vitest';
import {
  effectiveActionsOf,
  evaluateCounterfactual,
  evaluateLatestEffectiveFrame,
  isEffectiveChoice,
  listStrategicChoices,
  stableEffectiveActionId,
  type CounterfactualBranchResult,
  type CounterfactualEvaluation,
} from '../../../src/sim/run/counterfactual';
import { RunEngine } from '../../../src/sim/run/engine';
import type { CounterfactualFrame } from '../../../src/sim/run/persist';
import type { QuarterReview } from '../../../src/sim/run/types';

function setupFrame(): CounterfactualFrame {
  const engine = new RunEngine({ seed: 'counterfactual-branches', difficulty: 'normal' });
  engine.startRun();
  return engine.exportCounterfactualFrame()!;
}

function reviewFrame(outcome: QuarterReview['outcome']): CounterfactualFrame {
  const frame = setupFrame();
  frame.persist.phase = 'quarterReview';
  frame.persist.budget = 1;
  frame.persist.org.techDebt = 65;
  frame.persist.extras.teams = frame.persist.extras.teams!.map((team) => ({
    ...team,
    techDebt: 65,
  }));
  frame.persist.quarterReview = {
    goal: frame.persist.quarterGoal,
    outcome,
    trust: frame.persist.stakeholderTrust,
    progress: [],
    missedReasons: [],
    availableAdjustments: outcome === 'missed_adjustable' ? ['quality_pivot', 'cut_scope'] : [],
    bossCleared: outcome === 'met',
  };
  return frame;
}

function lostBranch(
  actionId: string | null,
  overrides: Partial<CounterfactualBranchResult> = {},
): CounterfactualBranchResult {
  return {
    actionId,
    sprintsToLose: 2,
    loseTick: 2_010_000,
    leftDanger: false,
    loseReason: 'techDebt',
    status: 'lost',
    truncated: false,
    ...overrides,
  };
}

function effectiveEvaluation(actionIds: (string | null)[]): CounterfactualEvaluation {
  return {
    origin: { sprintsPlayed: 0, quarter: 1, index: 0 },
    originDangers: ['techDebt'],
    applicableActions: [],
    skippedActions: [],
    skippedStrategic: [],
    baseline: lostBranch(null),
    branches: actionIds.map((id) => lostBranch(id, { sprintsToLose: 3 })),
  };
}

describe('反実仮想の四半期レビュー分岐', () => {
  it('提示された目標修正だけを評価し、品質改善による負債危険域の離脱を区別する', () => {
    const frame = reviewFrame('missed_adjustable');
    const before = structuredClone(frame);
    expect(listStrategicChoices(frame, 0)).toEqual([
      {
        id: 'goal:cut_scope',
        kind: 'goal',
        override: { kind: 'goal', id: 'cut_scope' },
        visit: 0,
      },
      {
        id: 'goal:quality_pivot',
        kind: 'goal',
        override: { kind: 'goal', id: 'quality_pivot' },
        visit: 0,
      },
    ]);

    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 0,
      focusReason: 'techDebt',
    });

    expect(evaluation.baseline).toMatchObject({
      status: 'playing',
      truncated: true,
      leftDanger: false,
      sprintsToLose: null,
      loseTick: null,
    });
    expect(evaluation.idlePinnedIds).toEqual(['goal:cut_scope']);
    expect(evaluation.branches).toEqual([
      { ...evaluation.baseline, actionId: 'goal:cut_scope' },
      { ...evaluation.baseline, actionId: 'goal:quality_pivot', leftDanger: true },
    ]);
    expect(effectiveActionsOf(evaluation)).toEqual(['goal:quality_pivot']);
    expect(evaluation.skippedStrategic).toEqual([]);
    expect(frame).toEqual(before);
  });

  it('目標修正の上限が 0 なら全候補を未評価として残し、無介入選択は記録する', () => {
    const evaluation = evaluateCounterfactual(reviewFrame('missed_adjustable'), {
      actions: [],
      includeStrategic: true,
      maxSprints: 0,
      maxStrategicBranches: 0,
      focusReason: 'techDebt',
    });
    expect(evaluation.branches).toEqual([]);
    expect(evaluation.skippedStrategic).toEqual(['goal:cut_scope', 'goal:quality_pivot']);
    expect(evaluation.idlePinnedIds).toEqual(['goal:cut_scope']);
    expect(evaluation.baseline.truncated).toBe(true);
  });

  it.each([
    ['met', 'won', null],
    ['reorg_required', 'lost', 'reorgRequired'],
  ] as const)('%s のレビューは目標修正を作らず %s まで評価する', (outcome, status, reason) => {
    const frame = reviewFrame(outcome);
    expect(listStrategicChoices(frame, 0)).toEqual([]);
    const evaluation = evaluateCounterfactual(frame, { actions: [], maxSprints: 0 });
    expect(evaluation.baseline).toMatchObject({
      status,
      loseReason: reason,
      sprintsToLose: status === 'lost' ? 0 : null,
      loseTick: status === 'lost' ? 90_000 : null,
      truncated: false,
    });
    expect(evaluation.idlePinnedIds).toEqual([]);
  });
});

describe('反実仮想フレームの後方走査', () => {
  it('追加フレームは最新から調べ、有効な目標修正が見つかったフレームを返す', () => {
    const frame = reviewFrame('missed_adjustable');
    const newest = setupFrame();
    newest.persist.sprintsPlayed = 3;
    const selected = evaluateLatestEffectiveFrame(
      [{ sprintsPlayed: 0, quarter: 1, index: 0, frame, frames: [frame, newest] }],
      { actions: [], includeStrategic: true, maxSprints: 0, focusReason: 'techDebt' },
    );
    expect(selected).toMatchObject({
      effective: ['goal:quality_pivot'],
      baselineRecovered: false,
      evaluation: { origin: { sprintsPlayed: 0, quarter: 1, index: 0 } },
    });
  });

  it('最新レビューで勝利する場合は過去の有効手へ遡らない', () => {
    const older = reviewFrame('missed_adjustable');
    const newest = reviewFrame('met');
    newest.persist.sprintsPlayed = 3;
    const selected = evaluateLatestEffectiveFrame(
      [{ sprintsPlayed: 0, quarter: 1, index: 0, frame: older, frames: [older, newest] }],
      { actions: [], includeStrategic: true, maxSprints: 0 },
    );
    expect(selected).toMatchObject({
      effective: [],
      baselineRecovered: true,
      evaluation: { origin: { sprintsPlayed: 3 }, baseline: { status: 'won' } },
    });
  });

  it('走査上限に達したら追加フレームの最新結果と未評価印を返す', () => {
    const older = reviewFrame('missed_adjustable');
    const newest = setupFrame();
    newest.persist.sprintsPlayed = 3;
    const selected = evaluateLatestEffectiveFrame(
      [{ sprintsPlayed: 0, quarter: 1, index: 0, frame: older, frames: [older, newest] }],
      { actions: [], maxSprints: 0, maxFrames: 1 },
    );
    expect(selected).toMatchObject({
      effective: [],
      baselineRecovered: false,
      evaluation: { origin: { sprintsPlayed: 3 }, skippedActions: ['frameScan'] },
    });
  });

  it('フレームがない場合と走査予算が 0 の場合は評価しない', () => {
    expect(evaluateLatestEffectiveFrame([])).toBeNull();
    expect(
      evaluateLatestEffectiveFrame(
        [{ sprintsPlayed: 0, quarter: 1, index: 0, frame: setupFrame() }],
        { maxFrames: 0 },
      ),
    ).toBeNull();
  });
});

describe('反実仮想の最小有効手集計', () => {
  it('進化列の順序と訪問位置を保持し、有効な部分列を含む複合手だけ除く', () => {
    const evaluation = effectiveEvaluation([
      null,
      'evo:dev-2@1',
      'evo:dev-1+dev-2@1',
      'evo:dev-1+dev-2',
      'evo:dev-1+dev-3@1',
      'evo:dev-1+dev-2@1+rest:heal@1',
    ]);
    expect(effectiveActionsOf(evaluation)).toEqual([
      'evo:dev-2@1',
      'evo:dev-1+dev-2',
      'evo:dev-1+dev-3@1',
    ]);
  });

  it('ショップ複合手の後続フェーズを別の手として比較する', () => {
    const evaluation = effectiveEvaluation([
      'rest:heal@1',
      'shop:relic:postmortem+card:copilot@1',
      'shop:relic:postmortem+card:copilot@1+rest:heal@1',
      'shop:recruit:review@1+rest:heal@2',
    ]);
    expect(effectiveActionsOf(evaluation)).toEqual([
      'rest:heal@1',
      'shop:relic:postmortem+card:copilot@1',
      'shop:recruit:review@1+rest:heal@2',
    ]);
  });

  it('生存中に危険域から抜けた分岐は、比較元も生存中でも有効手になる', () => {
    const baseline = lostBranch(null, {
      status: 'playing',
      sprintsToLose: null,
      loseTick: null,
      loseReason: null,
      truncated: true,
    });
    expect(isEffectiveChoice(baseline, { ...baseline, actionId: 'andon', leftDanger: true })).toBe(
      true,
    );
  });

  it.each([
    ['setup:ai:member-1:on@2', 'setup:ai:on'],
    ['setup:ai:member-2:off@1', 'setup:ai:off'],
    ['rest:upgrade:4@2', 'rest:upgrade'],
    ['shop:recruit:review@1+setup:ai:m7:on@2', 'shop:recruit:review+setup:ai:on'],
  ])('安定キー %s は担当やオン・オフを残して %s になる', (input, expected) => {
    expect(stableEffectiveActionId(input)).toBe(expected);
  });
});
