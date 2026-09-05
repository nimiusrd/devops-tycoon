import { describe, expect, it } from 'vitest';
import {
  findPeakResultKeyframeIndex,
  isReviewHellReplay,
  labelForReplayKeyframe,
  planReviewHellReplay,
  planReviewHellResultSummary,
} from '../../../src/render/reviewHellReplayView';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunReplayFrame } from '../../../src/sim/run/persist';
import type { SprintResult } from '../../../src/sim/types';
import {
  REPLAY_SCHEMA_VERSION,
  type ReplayBlob,
  type ReplayKeyframe,
} from '../../../src/state/replay';

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 40,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 1,
    contained: 0,
    spread: 0,
    seniorHpDelta: -10,
    actionCounts: {},
    grade: 'C',
    title: 'PRを増やす者',
    diagnosis: 'レビュー渋滞',
    timeline: [],
    events: [],
    fireEvents: [
      { tick: 10, kind: 'ignite', taskId: 1, source: 'review' },
      { tick: 20, kind: 'spread', taskId: 1, spreadToTaskId: 2 },
    ],
    focusRemaining: 3,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

function baseFrame(seed: string): RunReplayFrame {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun('easy', [], seed);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return frame;
}

function withResult(frame: RunReplayFrame, result: SprintResult): RunReplayFrame {
  return {
    ...structuredClone(frame),
    phase: 'result',
    lastResult: result,
    totals: {
      ...frame.totals,
      reviewQueuePeak: Math.max(frame.totals.reviewQueuePeak, result.reviewQueueMax),
    },
  };
}

function makeHellBlob(keyframes: ReplayKeyframe[]): ReplayBlob {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'hell-1',
    seed: 'hell-seed',
    difficulty: 'easy',
    trials: [],
    finishedAt: 2000,
    outcome: {
      status: 'lost',
      loseReason: 'reviewFreeze',
      diagnosis: 'reviewHell',
      score: 12,
    },
    keyframes,
    ruleset: { version: 1, fingerprint: 'review-hell-ruleset' },
    contentSnapshot: { cards: [], relics: [] },
  };
}

describe('reviewHellReplayView（RI-34‴）', () => {
  it('isReviewHellReplay は diagnosis のみで判定する', () => {
    expect(
      isReviewHellReplay({ outcome: { diagnosis: 'reviewHell' } as ReplayBlob['outcome'] }),
    ).toBe(true);
    expect(
      isReviewHellReplay({
        outcome: { diagnosis: 'healthyAcceleration' } as ReplayBlob['outcome'],
      }),
    ).toBe(false);
  });

  it('非 reviewHell では show:false', () => {
    const frame = baseFrame('plain');
    const blob: ReplayBlob = {
      ...makeHellBlob([{ phase: 'setup', frame }]),
      outcome: {
        status: 'won',
        diagnosis: 'healthyAcceleration',
        score: 40,
      },
    };
    expect(planReviewHellReplay(blob).show).toBe(false);
  });

  it('ピーク result を preferred にし、教訓と burn headline を載せる', () => {
    const setup = baseFrame('peak');
    const low = withResult(setup, makeResult({ reviewQueueMax: 8 }));
    const high = withResult(setup, makeResult({ reviewQueueMax: 22 }));
    const lost: RunReplayFrame = {
      ...structuredClone(setup),
      phase: 'lost',
      totals: { ...setup.totals, reviewQueuePeak: 22 },
    };
    const blob = makeHellBlob([
      { phase: 'setup', frame: setup, label: '編成' },
      { phase: 'result', frame: low, label: 'Review peak 8' },
      { phase: 'result', frame: high, label: 'Review peak 22' },
      { phase: 'lost', frame: lost, label: 'Review Hell 型' },
    ]);

    const view = planReviewHellReplay(blob);
    expect(view.show).toBe(true);
    expect(view.title).toBe('レビュー地獄リプレイ');
    expect(view.reviewQueuePeak).toBe(22);
    expect(view.preferredKeyframeIndex).toBe(2);
    expect(view.lesson).toContain('レビュー枠');
    expect(view.burnHeadline).toContain('点火');
  });

  it('result が無いときは終端キーフレームへフォールバック', () => {
    const setup = baseFrame('term');
    const lost: RunReplayFrame = {
      ...structuredClone(setup),
      phase: 'lost',
      totals: { ...setup.totals, reviewQueuePeak: 18 },
    };
    const blob = makeHellBlob([
      { phase: 'setup', frame: setup },
      { phase: 'lost', frame: lost },
    ]);
    const view = planReviewHellReplay(blob);
    expect(view.preferredKeyframeIndex).toBe(1);
    expect(view.reviewQueuePeak).toBe(18);
  });

  it('findPeakResultKeyframeIndex は最大 peak を返す', () => {
    const setup = baseFrame('idx');
    const keyframes: ReplayKeyframe[] = [
      { phase: 'result', frame: withResult(setup, makeResult({ reviewQueueMax: 5 })) },
      { phase: 'result', frame: withResult(setup, makeResult({ reviewQueueMax: 19 })) },
      { phase: 'result', frame: withResult(setup, makeResult({ reviewQueueMax: 12 })) },
    ];
    expect(findPeakResultKeyframeIndex(keyframes)).toBe(1);
  });

  it('findPeakResultKeyframeIndex は欠損フレームと非有限 peak を無視し、同率なら先頭を保つ', () => {
    const setup = baseFrame('idx-edge');
    const invalid = withResult(setup, makeResult({ reviewQueueMax: Number.NaN }));
    const keyframes = new Array<ReplayKeyframe>(5);
    keyframes[1] = { phase: 'setup', frame: setup };
    keyframes[2] = { phase: 'result', frame: invalid };
    keyframes[3] = {
      phase: 'result',
      frame: withResult(setup, makeResult({ reviewQueueMax: 7 })),
    };
    keyframes[4] = {
      phase: 'result',
      frame: withResult(setup, makeResult({ reviewQueueMax: 7 })),
    };

    expect(findPeakResultKeyframeIndex(keyframes)).toBe(3);
    expect(findPeakResultKeyframeIndex([{ phase: 'result', frame: invalid }])).toBeNull();
  });

  it('result も終端も無いときは末尾を選び、空なら既定ラベルと peak 0 を返す', () => {
    const setup = baseFrame('fallback-last');
    const draft: RunReplayFrame = {
      ...structuredClone(setup),
      phase: 'draft',
      draft: ['docs'],
    };

    const lastFrame = planReviewHellReplay(
      makeHellBlob([
        { phase: 'setup', frame: setup },
        { phase: 'draft', frame: draft },
      ]),
    );
    expect(lastFrame.preferredKeyframeIndex).toBe(1);
    expect(lastFrame.preferredLabel).toBe('カードドラフト');

    const empty = planReviewHellReplay(makeHellBlob([]));
    expect(empty.preferredKeyframeIndex).toBe(0);
    expect(empty.preferredLabel).toBe('キーフレーム');
    expect(empty.reviewQueuePeak).toBe(0);
    expect(empty.burnHeadline).toBeUndefined();
  });

  it('preferred に peak が無ければ過去フレームの result 値、次に totals を使う', () => {
    const setup = baseFrame('peak-fallback');
    const previousResult: RunReplayFrame = {
      ...structuredClone(setup),
      lastResult: makeResult({ incidents: 0, reviewQueueMax: 14, fireEvents: [] }),
      totals: { ...setup.totals, reviewQueuePeak: 3 },
    };
    const lostWithoutResult: RunReplayFrame = {
      ...structuredClone(setup),
      phase: 'lost',
      lastResult: null,
      totals: { ...setup.totals, reviewQueuePeak: Number.NaN },
    };
    const fromResult = planReviewHellReplay(
      makeHellBlob([
        { phase: 'setup', frame: previousResult },
        { phase: 'lost', frame: lostWithoutResult },
      ]),
    );
    expect(fromResult.reviewQueuePeak).toBe(14);

    const previousTotals: RunReplayFrame = {
      ...structuredClone(setup),
      lastResult: null,
      totals: { ...setup.totals, reviewQueuePeak: 9 },
    };
    const fromTotals = planReviewHellReplay(
      makeHellBlob([
        { phase: 'setup', frame: previousTotals },
        { phase: 'lost', frame: lostWithoutResult },
      ]),
    );
    expect(fromTotals.reviewQueuePeak).toBe(9);
  });

  it('炎上ログの無いピーク result では burn headline を省略する', () => {
    const setup = baseFrame('no-burn');
    const result = withResult(
      setup,
      makeResult({ incidents: 0, reviewQueueMax: 11, fireEvents: [] }),
    );
    const view = planReviewHellReplay(makeHellBlob([{ phase: 'result', frame: result }]));

    expect(view.reviewQueuePeak).toBe(11);
    expect(view.preferredLabel).toBe('Review peak 11');
    expect(view.burnHeadline).toBeUndefined();
  });

  it('labelForReplayKeyframe は phase ごとにラベルを付ける', () => {
    const setup = baseFrame('lbl');
    expect(labelForReplayKeyframe(setup)).toBe('編成');
    expect(labelForReplayKeyframe(withResult(setup, makeResult({ reviewQueueMax: 16 })))).toBe(
      'Review peak 16',
    );
    const draft: RunReplayFrame = { ...structuredClone(setup), phase: 'draft', draft: ['docs'] };
    expect(labelForReplayKeyframe(draft)).toBe('カードドラフト');
    const lost: RunReplayFrame = { ...structuredClone(setup), phase: 'lost' };
    expect(labelForReplayKeyframe(lost, 'reviewHell')).toBe('Review Hell 型');
  });

  it('labelForReplayKeyframe は result・四半期・終端の省略入力へフォールバックする', () => {
    const setup = baseFrame('lbl-edge');
    const invalidResult = withResult(
      setup,
      makeResult({ reviewQueueMax: Number.POSITIVE_INFINITY }),
    );
    expect(labelForReplayKeyframe(invalidResult)).toBe('Sprint result');

    const quarter: RunReplayFrame = {
      ...structuredClone(setup),
      phase: 'quarterReview',
      totals: { ...setup.totals, reviewQueuePeak: 6 },
    };
    expect(labelForReplayKeyframe(quarter)).toBe('四半期 (peak 6)');
    expect(
      labelForReplayKeyframe({
        ...quarter,
        totals: { ...quarter.totals, reviewQueuePeak: 0 },
      }),
    ).toBe('四半期レビュー');

    const won: RunReplayFrame = { ...structuredClone(setup), phase: 'won' };
    const lost: RunReplayFrame = { ...structuredClone(setup), phase: 'lost' };
    expect(labelForReplayKeyframe(won, 'aiOverproduction')).toBe('AI Overproduction 型');
    expect(labelForReplayKeyframe(won)).toBe('勝利');
    expect(labelForReplayKeyframe(lost)).toBe('敗北');
    expect(labelForReplayKeyframe({ ...structuredClone(setup), phase: 'shop' })).toBeUndefined();
  });

  it('planReviewHellResultSummary はリプレイかつ reviewHell のときだけ表示', () => {
    const result = makeResult({ reviewQueueMax: 20 });
    expect(
      planReviewHellResultSummary(result, {
        replayMode: true,
        diagnosis: 'reviewHell',
      }).show,
    ).toBe(true);
    expect(
      planReviewHellResultSummary(result, {
        replayMode: false,
        diagnosis: 'reviewHell',
      }).show,
    ).toBe(false);
    expect(
      planReviewHellResultSummary(result, {
        replayMode: true,
        diagnosis: 'aiOverproduction',
      }).show,
    ).toBe(false);

    expect(
      planReviewHellResultSummary(result, {
        replayMode: true,
        diagnosis: 'reviewHell',
      }),
    ).toMatchObject({
      title: 'レビュー地獄リプレイ',
      peakLabel: 'Review Queue Max 20 PR',
    });
  });
});
