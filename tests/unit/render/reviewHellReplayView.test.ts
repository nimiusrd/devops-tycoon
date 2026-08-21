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

  it('labelForReplayKeyframe は phase ごとにラベルを付ける', () => {
    const setup = baseFrame('lbl');
    expect(labelForReplayKeyframe(setup)).toBe('編成');
    expect(labelForReplayKeyframe(withResult(setup, makeResult({ reviewQueueMax: 16 })))).toBe(
      'Review peak 16',
    );
    const lost: RunReplayFrame = { ...structuredClone(setup), phase: 'lost' };
    expect(labelForReplayKeyframe(lost, 'reviewHell')).toBe('Review Hell 型');
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
  });
});
