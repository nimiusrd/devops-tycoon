/**
 * 「レビュー地獄リプレイ」専用演出の純ビュー（RI-34‴ / §23）。
 *
 * RI-61 のキーフレームリプレイ上で `outcome.diagnosis === 'reviewHell'` のときだけ
 * 一覧強調・推奨キーフレーム・サマリ文言を組み立てる。描画・永続化は知らない。
 * 純入力ログ再生・共有 URL は非スコープ。
 */
import { diagnosisView, FAILURE_ENCYCLOPEDIA_DEFS } from '../sim/diagnosis';
import type { DiagnosisType } from '../sim/run/types';
import type { RunReplayFrame } from '../sim/run/persist';
import type { SprintResult } from '../sim/types';
import type { ReplayBlob, ReplayKeyframe } from '../state/replay';
import { planBurnCauseLog } from './sprintBurnCauseView';

const REVIEW_HELL_LESSON =
  FAILURE_ENCYCLOPEDIA_DEFS.find((d) => d.type === 'reviewHell')?.lesson ??
  'レビュー枠を先に確保し、割り込みレビューやレビュアー増強で渋滞を解消する。';

export interface ReviewHellReplayView {
  /** reviewHell 以外は false（専用パネル非表示）。 */
  show: boolean;
  title: string;
  lead: string;
  /** ラン通算または result キーフレーム由来の Review ピーク。 */
  reviewQueuePeak: number;
  lesson: string;
  /** 一覧 CTA が開くキーフレーム添字。 */
  preferredKeyframeIndex: number;
  /** 推奨キーフレームの短い説明。 */
  preferredLabel: string;
  /** ピーク result の burn-cause headline（無ければ省略）。 */
  burnHeadline?: string;
}

/** リプレイが Review Hell 診断か。 */
export function isReviewHellReplay(blob: Pick<ReplayBlob, 'outcome'>): boolean {
  return blob.outcome.diagnosis === 'reviewHell';
}

function resultPeak(frame: RunReplayFrame): number | null {
  const max = frame.lastResult?.reviewQueueMax;
  return typeof max === 'number' && Number.isFinite(max) ? max : null;
}

/** キーフレーム群から Review ピーク最大の result 添字を探す。無ければ null。 */
export function findPeakResultKeyframeIndex(keyframes: readonly ReplayKeyframe[]): number | null {
  let bestIndex: number | null = null;
  let bestPeak = -1;
  for (let i = 0; i < keyframes.length; i += 1) {
    const kf = keyframes[i];
    if (!kf || kf.phase !== 'result') continue;
    const peak = resultPeak(kf.frame);
    if (peak === null) continue;
    if (peak > bestPeak) {
      bestPeak = peak;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** 終端（won/lost）キーフレームの末尾添字。無ければ最後のキーフレーム。 */
function fallbackTerminalIndex(keyframes: readonly ReplayKeyframe[]): number {
  for (let i = keyframes.length - 1; i >= 0; i -= 1) {
    const phase = keyframes[i]?.phase;
    if (phase === 'won' || phase === 'lost') return i;
  }
  return Math.max(0, keyframes.length - 1);
}

function resolvePeak(blob: ReplayBlob, preferredIndex: number): number {
  const preferred = blob.keyframes[preferredIndex]?.frame;
  const fromPreferred = preferred ? resultPeak(preferred) : null;
  if (fromPreferred !== null) return fromPreferred;

  let maxFromResults = 0;
  for (const kf of blob.keyframes) {
    const peak = resultPeak(kf.frame);
    if (peak !== null) maxFromResults = Math.max(maxFromResults, peak);
  }
  if (maxFromResults > 0) return maxFromResults;

  const fromTotals = preferred?.totals.reviewQueuePeak;
  if (typeof fromTotals === 'number' && Number.isFinite(fromTotals)) return fromTotals;

  for (let i = blob.keyframes.length - 1; i >= 0; i -= 1) {
    const peak = blob.keyframes[i]?.frame.totals.reviewQueuePeak;
    if (typeof peak === 'number' && Number.isFinite(peak)) return peak;
  }
  return 0;
}

/**
 * reviewHell リプレイの一覧／バナー用ビューを返す。
 * 非 reviewHell では `show: false`。
 */
export function planReviewHellReplay(blob: ReplayBlob): ReviewHellReplayView {
  if (!isReviewHellReplay(blob)) {
    return {
      show: false,
      title: '',
      lead: '',
      reviewQueuePeak: 0,
      lesson: '',
      preferredKeyframeIndex: 0,
      preferredLabel: '',
    };
  }

  const meta = diagnosisView('reviewHell');
  const peakIndex = findPeakResultKeyframeIndex(blob.keyframes);
  const preferredKeyframeIndex = peakIndex ?? fallbackTerminalIndex(blob.keyframes);
  const reviewQueuePeak = resolvePeak(blob, preferredKeyframeIndex);
  const preferred = blob.keyframes[preferredKeyframeIndex];
  const preferredLabel =
    preferred?.label ??
    (preferred ? labelForReplayKeyframe(preferred.frame, blob.outcome.diagnosis) : undefined) ??
    'キーフレーム';

  const bestResult: SprintResult | null | undefined =
    peakIndex !== null ? blob.keyframes[peakIndex]?.frame.lastResult : preferred?.frame.lastResult;
  const burn = bestResult ? planBurnCauseLog(bestResult) : null;

  return {
    show: true,
    title: 'レビュー地獄リプレイ',
    lead: meta.description,
    reviewQueuePeak,
    lesson: REVIEW_HELL_LESSON,
    preferredKeyframeIndex,
    preferredLabel,
    burnHeadline: burn?.showSection ? burn.headline : undefined,
  };
}

/**
 * キーフレーム収集時の表示ラベル（RI-34‴）。
 * result は Review peak、終端は診断ラベル、他はフェーズ名。
 */
export function labelForReplayKeyframe(
  frame: RunReplayFrame,
  diagnosis?: DiagnosisType,
): string | undefined {
  if (frame.phase === 'result') {
    const peak = frame.lastResult?.reviewQueueMax ?? frame.totals.reviewQueuePeak;
    if (typeof peak === 'number' && Number.isFinite(peak)) {
      return `Review peak ${peak}`;
    }
    return 'Sprint result';
  }
  if (frame.phase === 'setup') return '編成';
  if (frame.phase === 'draft') return 'カードドラフト';
  if (frame.phase === 'quarterReview') {
    const peak = frame.totals.reviewQueuePeak;
    return Number.isFinite(peak) && peak > 0 ? `四半期 (peak ${peak})` : '四半期レビュー';
  }
  if (frame.phase === 'won' || frame.phase === 'lost') {
    if (diagnosis === 'reviewHell') return diagnosisView('reviewHell').label;
    if (diagnosis) return diagnosisView(diagnosis).label;
    return frame.phase === 'won' ? '勝利' : '敗北';
  }
  return undefined;
}

/** SprintResult 画面先頭の短い要約（リプレイ閲覧時）。 */
export interface ReviewHellResultSummary {
  show: boolean;
  title: string;
  peakLabel: string;
  lesson: string;
}

export function planReviewHellResultSummary(
  result: Pick<SprintResult, 'reviewQueueMax'>,
  opts: { replayMode: boolean; diagnosis: DiagnosisType },
): ReviewHellResultSummary {
  if (!opts.replayMode || opts.diagnosis !== 'reviewHell') {
    return { show: false, title: '', peakLabel: '', lesson: '' };
  }
  return {
    show: true,
    title: 'レビュー地獄リプレイ',
    peakLabel: `Review Queue Max ${result.reviewQueueMax} PR`,
    lesson: REVIEW_HELL_LESSON,
  };
}
