/**
 * タイトルの途中セーブ要約に使う表示文言。
 * 再開バナーとデイリー開始確認で同じラベルを共有する。
 */
import type { DifficultyId } from '../sim/run/types';
import type { RunSaveSummary } from '../state/runPersistence';

export const DIFFICULTY_TAG: Record<DifficultyId, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  nightmare: 'Nightmare',
};

export const PHASE_LABEL: Record<RunSaveSummary['phase'], string> = {
  setup: '編成',
  result: 'リザルト',
  draft: 'ドラフト',
  evolution: '進化',
  beat: 'イベント',
  shop: 'ショップ',
  rest: '休息',
  recruit: '採用',
  quarterReview: '四半期レビュー',
};

export function resumableRunHeadline(summary: RunSaveSummary): string {
  return `${DIFFICULTY_TAG[summary.difficulty]} / Q${summary.quarterNumber} ${PHASE_LABEL[summary.phase]}`;
}

export function resumableRunDetail(
  summary: RunSaveSummary,
  options: { includeSeed?: boolean } = {},
): string {
  const seed = options.includeSeed ? `seed: ${summary.seed} · ` : '';
  const daily =
    summary.runKind === 'daily' && summary.dailyDate ? ` · デイリー ${summary.dailyDate}` : '';
  return `${seed}スプリント ${summary.sprintsPlayed} 完了${daily}`;
}

export function startDailyConfirmTitle(canResume: boolean): string {
  return canResume ? '中断中のランがあります' : '再開できないセーブがあります';
}

export function startDailyConfirmRiskText(canResume: boolean): string {
  if (canResume) {
    return 'デイリーを始めると途中セーブが上書きされ、このランは続きから再開できなくなります。先に再開するか、中断ランを捨てるかを選んでください。';
  }
  return 'デイリーを始めると途中セーブが上書きされ、このセーブは残らなくなります。戻るか、中断ランを捨ててデイリーを始めるかを選んでください。';
}
