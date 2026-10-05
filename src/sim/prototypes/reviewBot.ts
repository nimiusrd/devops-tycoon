import { getCard } from '../../data/cards';
import { createRng } from '../rng';

export type ReviewMode = 'human' | 'coefficient' | 'dedicated';
export type ReviewStage = 'bot' | 'human' | 'verification' | 'done';

export interface ReviewJob {
  id: number;
  kind: 'routine' | 'complex';
  value: number;
  stage: ReviewStage;
  humanLeft: number;
  botLeft: number;
  falsePositive: boolean;
  route: 'human' | 'bot' | 'fallback';
}

export interface ReviewBotState {
  version: 1;
  tick: number;
  deadline: number;
  mode: ReviewMode;
  coefficient: number;
  jobs: ReviewJob[];
  humanSpent: number;
  botSpent: number;
  triageSpent: number;
  falsePositives: number;
}

/** 実装済みPRだけの固定盤面。3枠のうち専用経路では1枠をBot運用へ移す。 */
export function createReviewBotPrototype(
  seed: string | number,
  kinds: ReviewJob['kind'][],
  mode: ReviewMode,
): ReviewBotState {
  const rng = createRng(seed);
  return {
    version: 1,
    tick: 0,
    deadline: 12,
    mode,
    coefficient: getCard('review-bot')!.base.reviewEfficiencyMul!,
    jobs: kinds.map((kind, id) => ({
      id,
      kind,
      value: kind === 'routine' ? 2 : 5,
      stage: mode === 'dedicated' && kind === 'routine' ? 'bot' : 'human',
      humanLeft: kind === 'routine' ? 3 : 6,
      botLeft: 1,
      falsePositive: rng() < 0.25,
      route: mode === 'dedicated' && kind === 'routine' ? 'bot' : 'human',
    })),
    humanSpent: 0,
    botSpent: 0,
    triageSpent: 0,
    falsePositives: 0,
  };
}

/** Bot結果・人間レビューから最終検証へは次tickに移る。 */
export function tickReviewBotPrototype(state: ReviewBotState): ReviewBotState {
  if (state.tick >= state.deadline) return state;
  const next = { ...state, tick: state.tick + 1, jobs: state.jobs.map((job) => ({ ...job })) };
  let human = state.mode === 'dedicated' ? 2 : 3;
  if (state.mode === 'coefficient') human *= state.coefficient;
  let bot = state.mode === 'dedicated' ? 2 : 0;
  let verification = 2;
  // 専用経路を準備する初期費用。最初のtickは人間レビュー2工数を譲る。
  if (state.mode === 'dedicated' && state.tick === 0) {
    next.humanSpent += human;
    human = 0;
  }
  for (let i = 0; i < next.jobs.length; i += 1) {
    const before = state.jobs[i];
    const job = next.jobs[i];
    if (before.stage === 'bot') {
      const work = Math.min(bot, before.botLeft);
      job.botLeft -= work;
      bot -= work;
      next.botSpent += work;
      if (job.botLeft === 0) {
        if (job.falsePositive) {
          job.stage = 'human';
          job.route = 'fallback';
          job.humanLeft += 1;
          next.falsePositives += 1;
        } else {
          job.stage = 'verification';
        }
      }
    } else if (before.stage === 'human') {
      const work = Math.min(human, before.humanLeft);
      // 誤検知の仕分けは追加1工数から先に消費。通常レビューと分けて記録する。
      if (before.route === 'fallback' && before.humanLeft > 3) {
        next.triageSpent += Math.min(work, before.humanLeft - 3);
      }
      job.humanLeft = Math.max(0, before.humanLeft - work);
      if (job.humanLeft < 1e-9) job.humanLeft = 0;
      human -= work;
      next.humanSpent += work;
      if (job.humanLeft === 0) job.stage = 'verification';
    } else if (before.stage === 'verification' && verification > 0) {
      job.stage = 'done';
      verification -= 1;
    }
  }
  return next;
}

export function summarizeReviewBot(state: ReviewBotState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  return {
    delivered: done.reduce((total, job) => total + job.value, 0),
    completed: done.length,
    botCompleted: done.filter((job) => job.route === 'bot').length,
    humanCompleted: done.filter((job) => job.route === 'human').length,
    fallbackCompleted: done.filter((job) => job.route === 'fallback').length,
    pending: state.jobs.length - done.length,
    humanSpent: Math.round(state.humanSpent * 100) / 100,
    botSpent: state.botSpent,
    falsePositives: state.falsePositives,
    triageSpent: state.triageSpent,
  };
}

export function compareReviewBotStrategies(seed: string | number, kinds: ReviewJob['kind'][]) {
  return (['human', 'coefficient', 'dedicated'] as const).map((mode) => {
    let state = createReviewBotPrototype(seed, kinds, mode);
    while (state.tick < state.deadline) state = tickReviewBotPrototype(state);
    return { mode, ...summarizeReviewBot(state) };
  });
}
