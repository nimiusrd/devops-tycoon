import { reviewFreezeWatchPeak } from '../render/reviewFreezeCopy';
import { REVIEW_FREEZE_PEAK } from '../sim/outcome';
import type { RunState } from '../sim/run/types';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';

export const REVIEW_FREEZE_SEQUENCE_MAX_TICKS = 120;
const MAX_TRACE_BYTES = 12 * 1024;
const SEQUENCE_MS = 12_000;

interface InterruptReview {
  reviewedCount: number;
  focusCost: number;
  extraHpCost: number;
}

interface ReviewTick {
  /** 0始まりの処理tick。既存のタイムライン・介入ログと同じ番号。 */
  tick: number;
  queueAfterStep: number;
  sprintPeak: number;
  interruptReview?: InterruptReview;
}

interface ReviewFreezeTrace {
  version: 1;
  seed: string;
  sprintId: string;
  runPeakBeforeSprint: number;
  ruleset: typeof CURRENT_RUN_RULESET;
  lossTick?: number;
  samples: ReviewTick[];
}

type TerminalState = Pick<
  RunState,
  'seed' | 'phase' | 'status' | 'loseReason' | 'totals' | 'currentSprintId' | 'lastResult'
>;

type RecordSource =
  | { kind: 'captured'; trace: ReviewFreezeTrace }
  | { kind: 'legacy-keyframes' | 'missing-recording' | 'save-failed' };

type Moment = { tick: number; offsetMs: number } & (
  | { kind: 'interrupt-review'; effect: InterruptReview }
  | { kind: 'watch' | 'threshold' | 'loss'; peak: number }
);

/** 試作ランのスプリント開始時に作る独立した記録。 */
export function startReviewFreezeTrace(state: RunState): ReviewFreezeTrace | null {
  if (state.phase !== 'sprint' || state.sprintTick !== 0 || !state.currentSprintId) return null;
  return {
    version: 1,
    seed: state.seed,
    sprintId: state.currentSprintId,
    runPeakBeforeSprint: state.totals.reviewQueuePeak,
    ruleset: { ...CURRENT_RUN_RULESET },
    samples: [],
  };
}

/** 固定ステップ直後のコピーから表示に使う観測値だけを抽出する。 */
export function captureReviewFreezeTick(trace: ReviewFreezeTrace, state: RunState): void {
  const sprint = state.sprint;
  if (!sprint || trace.seed !== state.seed || trace.sprintId !== state.currentSprintId) return;
  const sample = sprint.timeline[sprint.timeline.length - 1];
  if (!sample || sample.tick !== state.sprintTick - 1) return;
  const action = sprint.interventionEvents.find(
    (event) => event.tick === sample.tick && event.effect.actionId === 'interruptReview',
  )?.effect;
  trace.samples.push({
    tick: sample.tick,
    queueAfterStep: sample.reviewQueue,
    sprintPeak: sprint.metrics.reviewQueueMax,
    ...(action?.reviewedCount === undefined
      ? {}
      : {
          interruptReview: {
            reviewedCount: action.reviewedCount,
            focusCost: action.focusCost,
            extraHpCost: action.hpCost ?? 0,
          },
        }),
  });
  if (trace.samples.length > REVIEW_FREEZE_SEQUENCE_MAX_TICKS) trace.samples.shift();
  if (state.status === 'lost' && state.loseReason === 'reviewFreeze' && sprint.complete) {
    trace.lossTick = sample.tick;
  }
}

export function reviewFreezeTraceBytes(trace: ReviewFreezeTrace): number {
  return new TextEncoder().encode(JSON.stringify(trace)).byteLength;
}

function isCompleteReviewFreezeTrace(trace: ReviewFreezeTrace, terminal: TerminalState): boolean {
  const { samples } = trace;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const resultTimeline = terminal.lastResult?.timeline;
  if (
    trace.version !== 1 ||
    trace.ruleset.version !== CURRENT_RUN_RULESET.version ||
    trace.ruleset.fingerprint !== CURRENT_RUN_RULESET.fingerprint ||
    trace.seed !== terminal.seed ||
    trace.sprintId !== terminal.currentSprintId ||
    !Number.isSafeInteger(trace.runPeakBeforeSprint) ||
    trace.runPeakBeforeSprint < 0 ||
    trace.runPeakBeforeSprint >= REVIEW_FREEZE_PEAK ||
    !first ||
    !last ||
    samples.length > REVIEW_FREEZE_SEQUENCE_MAX_TICKS ||
    last.tick !== trace.lossTick ||
    last.sprintPeak < REVIEW_FREEZE_PEAK ||
    last.sprintPeak !== terminal.lastResult?.reviewQueueMax ||
    last.sprintPeak !== terminal.totals.reviewQueuePeak ||
    reviewFreezeTraceBytes(trace) > MAX_TRACE_BYTES
  ) {
    return false;
  }
  for (const [index, sample] of samples.entries()) {
    const observed = resultTimeline?.[resultTimeline.length - samples.length + index];
    if (
      !sample ||
      sample.tick !== first.tick + index ||
      sample.tick !== observed?.tick ||
      sample.queueAfterStep !== observed?.reviewQueue ||
      !Number.isSafeInteger(sample.sprintPeak) ||
      sample.sprintPeak < (samples[index - 1]?.sprintPeak ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

/** 連続観測の表示データを作る。元のランを再計算せず、表示時刻だけを割り当てる。 */
export function planReviewFreezeSequence(terminal: TerminalState, source: RecordSource) {
  const summary = {
    kind: 'summary' as const,
    loseReason: terminal.loseReason,
    runReviewPeak: terminal.totals.reviewQueuePeak,
  };
  if (
    terminal.phase !== 'lost' ||
    terminal.status !== 'lost' ||
    terminal.loseReason !== 'reviewFreeze'
  ) {
    return { ...summary, reason: 'unsupported-outcome' as const };
  }
  if (source.kind !== 'captured') return { ...summary, reason: source.kind };
  if (!isCompleteReviewFreezeTrace(source.trace, terminal)) {
    return { ...summary, reason: 'incomplete-recording' as const };
  }
  if (source.trace.samples[0]!.sprintPeak >= REVIEW_FREEZE_PEAK) {
    return { ...summary, reason: 'threshold-not-observed' as const };
  }

  const samples = structuredClone(source.trace.samples);
  const frames = samples.map((sample, index) => ({
    ...sample,
    offsetMs: Math.round((index * SEQUENCE_MS) / samples.length),
  }));
  const moments: Moment[] = [];
  const watchPeak = reviewFreezeWatchPeak();
  for (const [index, sample] of frames.entries()) {
    const time = { tick: sample.tick, offsetMs: sample.offsetMs };
    if (sample.interruptReview) {
      moments.push({ ...time, kind: 'interrupt-review', effect: sample.interruptReview });
    }
    const previous = frames[index - 1];
    if (!previous) continue;
    if (previous.sprintPeak < REVIEW_FREEZE_PEAK && sample.sprintPeak >= REVIEW_FREEZE_PEAK) {
      moments.push({ ...time, kind: 'threshold', peak: sample.sprintPeak });
    } else if (previous.sprintPeak < watchPeak && sample.sprintPeak >= watchPeak) {
      moments.push({ ...time, kind: 'watch', peak: sample.sprintPeak });
    }
  }
  moments.push({
    kind: 'loss',
    tick: samples[samples.length - 1]!.tick,
    offsetMs: SEQUENCE_MS,
    peak: summary.runReviewPeak,
  });
  return {
    kind: 'sequence' as const,
    durationMs: SEQUENCE_MS,
    lossThreshold: REVIEW_FREEZE_PEAK,
    watchThreshold: watchPeak,
    frames,
    moments,
  };
}
