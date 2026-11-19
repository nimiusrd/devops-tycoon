/** RI-276: 固定課題で既存の AI 加速とレビュー整備を比較する。 */
import { playCardFromHand } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { CardInstance, Lane, OrgState, SprintState } from '../sim/types';

export const AI_REVIEW_PRACTICE = {
  seed: 'RI-276',
  taskCount: 24,
  focusMax: 5,
  preparationTicks: 4,
  endTick: 60,
} as const;

export const AI_REVIEW_CHOICES = {
  accelerate: 'claude-code',
  reinforceReview: 'review-bot',
} as const;

export type AiReviewChoice = keyof typeof AI_REVIEW_CHOICES;

function observe(sprint: SprintState, org: OrgState, tick: number) {
  const lanes: Record<Lane, number> = { backlog: 0, coding: 0, review: 0, rework: 0, done: 0 };
  for (const task of sprint.tasks) lanes[task.lane] += 1;
  return {
    tick,
    lanes,
    // この課題には差配や分割がないため、Review 以降のタスクは実装を一度通過している。
    codingPassed: lanes.review + lanes.rework + lanes.done,
    delivered: sprint.metrics.delivered,
    reworkCount: sprint.metrics.reworkCount,
    incidentCount: sprint.metrics.incidentCount,
    seniorHp: org.seniorHp,
    focus: sprint.focus,
    focusSpent: sprint.metrics.focusSpent,
  };
}

interface PracticeRun {
  org: OrgState;
  sprint: SprintState;
  rng: ReturnType<typeof createRng>;
  deck: CardInstance[];
  before: ReturnType<typeof observe>;
  tick: number;
  choice: AiReviewChoice | null;
  reviewTaskTicks: number;
}

function prepare(seed: string): PracticeRun {
  const { taskCount, focusMax, preparationTicks, endTick } = AI_REVIEW_PRACTICE;
  const org = createOrgState('default', true);
  const rng = createRng(seed);
  const sprint = createSprint(
    resolveSprintConfig('default', { taskCount, focusMax, minCompleteTick: 0, maxTicks: endTick }),
    org,
    rng,
  );
  const deck: CardInstance[] = ['copilot', ...Object.values(AI_REVIEW_CHOICES)].map((defId) => ({
    defId,
    level: 1,
  }));
  sprint.cardPiles.hand = [0, 1, 2];
  const copilot = playCardFromHand(sprint, org, deck, 0);
  if (!copilot.ok) throw new Error('練習の共通施策を発動できません');
  for (let tick = 1; tick <= preparationTicks; tick += 1) stepSprint(sprint, org, rng, tick);
  const before = observe(sprint, org, preparationTicks);
  return {
    org,
    sprint,
    rng,
    deck,
    before,
    tick: preparationTicks,
    choice: null,
    reviewTaskTicks: 0,
  };
}

export class AiReviewPractice {
  #run: PracticeRun | null;

  constructor(seed: string = AI_REVIEW_PRACTICE.seed) {
    this.#run = prepare(seed);
  }

  choose(choice: AiReviewChoice): boolean {
    const run = this.#run;
    if (!run || run.choice || run.sprint.complete) return false;
    const deckIndex = run.deck.findIndex(({ defId }) => defId === AI_REVIEW_CHOICES[choice]);
    const outcome = playCardFromHand(run.sprint, run.org, run.deck, deckIndex);
    if (!outcome.ok) return false;
    run.choice = choice;
    return true;
  }

  step(): boolean {
    const run = this.#run;
    if (!run?.choice || run.sprint.complete) return false;
    run.tick += 1;
    stepSprint(run.sprint, run.org, run.rng, run.tick);
    // tick 終了後のレーン件数を合計する。タスクの厳密な待ち時間ではない。
    run.reviewTaskTicks += run.sprint.tasks.filter(({ lane }) => lane === 'review').length;
    return true;
  }

  view() {
    const run = this.#run;
    if (!run) return { phase: 'closed' } as const;
    return {
      phase: run.sprint.complete ? 'complete' : run.choice ? 'running' : 'ready',
      choice: run.choice,
      before: structuredClone(run.before),
      current: observe(run.sprint, run.org, run.tick),
      reviewTaskTicks: run.reviewTaskTicks,
      timedOut: run.sprint.metrics.timedOut ?? false,
    } as const;
  }

  /** 選択前のスキップと、練習中・完了後の退出は同じ破棄操作。 */
  close(): void {
    this.#run = null;
  }
}
