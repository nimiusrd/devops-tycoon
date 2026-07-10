/**
 * スプリントリザルトの介入効果分析（RI-54）。
 *
 * `SprintResult` を読むだけの純関数。描画・状態は知らない（第22.2）。
 */
import type { SprintResult } from '../sim/types';

export interface InterventionAnalysisRow {
  label: string;
  value: string;
}

export interface InterventionAnalysisView {
  rows: InterventionAnalysisRow[];
  tip: string;
  /** 介入が無いときは集計セクションを省略する。 */
  showSection: boolean;
}

function countFirefightComboSaves(result: SprintResult): number {
  return result.events.filter((e) => e.kind === 'intervention' && e.effect.actionId === 'firefight')
    .length;
}

function totalReviewedPr(result: SprintResult): number {
  let total = 0;
  for (const e of result.events) {
    if (e.kind !== 'intervention') continue;
    if (e.effect.reviewedCount != null && e.effect.reviewedCount > 0) {
      total += e.effect.reviewedCount;
    }
  }
  return total;
}

function hasInterventions(result: SprintResult): boolean {
  return Object.values(result.actionCounts).some((count) => (count ?? 0) > 0);
}

function deriveTip(result: SprintResult, reviewedPr: number, firefightSaves: number): string {
  const { focusRemaining, focusMax, autoContainCount, spread, reviewQueueMax, actionCounts } =
    result;

  if (autoContainCount >= 1) {
    return `自動鎮火 ${autoContainCount} 件 → 緊急対応（⚡1）の方がシニアHP消費が小さい。炎上タイマー内に鎮火を。`;
  }

  if (spread >= 1) {
    return `延焼 ${spread} 件 → 緊急対応で鎮火すればコンボと士気を守れる。集中力があれば早めに打とう。`;
  }

  if (!hasInterventions(result)) {
    return '介入なしで終了。次は Review 渋滞や炎上のタイミングで ⚡ を試してみよう。';
  }

  if (firefightSaves >= 2 && autoContainCount === 0 && spread === 0) {
    return `緊急対応でコンボを ${firefightSaves} 回守った。炎上への即応が安定している。`;
  }

  if (focusRemaining >= Math.max(3, Math.ceil(focusMax * 0.4))) {
    const peakQueue = reviewQueueMax;
    if (peakQueue >= 6) {
      return `集中力を ⚡${focusRemaining} 残して終了 → Review待ちが最大 ${peakQueue} PR のとき、割り込みレビュー（⚡3）の余地があった。`;
    }
    return `集中力を ⚡${focusRemaining} 残して終了 → 渋滞ピーク時に割り込みの余地があった。次はピーク前に ⚡ を使おう。`;
  }

  if (reviewQueueMax >= 8 && (actionCounts.interruptReview ?? 0) === 0) {
    return `Review待ちが最大 ${reviewQueueMax} PR に達した。割り込みレビューで渋滞を先に捌くと出荷が伸びやすい。`;
  }

  if (reviewedPr >= 6) {
    return `割り込みで PR ${reviewedPr} 件を捌いた。渋滞ピークとタイミングを合わせるとさらに効く。`;
  }

  return '介入は発動した。タイムラインのマーカーと重ねて、ピーク時の ⚡ 使いを振り返ろう。';
}

/** リザルト用の介入分析ビューを導出する。 */
export function planInterventionAnalysis(result: SprintResult): InterventionAnalysisView {
  const reviewedPr = totalReviewedPr(result);
  const firefightSaves = countFirefightComboSaves(result);
  const showSection = hasInterventions(result) || result.autoContainCount > 0 || result.spread > 0;

  const rows: InterventionAnalysisRow[] = [
    { label: '捌いた PR', value: `${reviewedPr} 件` },
    { label: 'コンボを守った', value: `${firefightSaves} 回` },
    {
      label: '自動鎮火 / 延焼',
      value: `${result.autoContainCount} / ${result.spread}`,
    },
    {
      label: '集中力余り',
      value: `⚡${result.focusRemaining} / ${result.focusMax}`,
    },
  ];

  return {
    rows,
    tip: deriveTip(result, reviewedPr, firefightSaves),
    showSection,
  };
}
