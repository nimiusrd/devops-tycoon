/** RI-278: 敗因に対応する固定盤面で、既存の介入とその代償を比較する。 */
import { applyAction } from '../sim/actions';
import { IDENTITY_CARD_EFFECTS } from '../sim/model';
import { createOrgState } from '../sim/org';
import { createSprintFromBaselineInput } from '../sim/run/sprintBaseline';
import type { QuarterOutcome, RunStatus } from '../sim/run/types';
import { resolveSprintConfig, stepSprint } from '../sim/sprint';

export const BURNOUT_PRACTICE = {
  id: 'senior-burnout',
  seed: 'RI-278-senior-burnout',
  options: ['andon', 'interruptReview'],
  endTick: 60,
} as const;

export type BurnoutPracticeAction = (typeof BURNOUT_PRACTICE.options)[number];

interface LossPracticeSource {
  status: RunStatus;
  loseReason?: string | null;
  quarterReview?: { outcome: QuarterOutcome } | null;
}

/** 「次の一手」でシニア燃え尽き固有の助言を出すケースにだけ練習を提案する。 */
export function lossPracticeForResult(state: LossPracticeSource, isReplay: boolean) {
  const outcome = state.quarterReview?.outcome;
  if (
    isReplay ||
    state.status !== 'lost' ||
    state.loseReason !== 'seniorBurnout' ||
    outcome === 'shutdown' ||
    outcome === 'reorg_required'
  ) {
    return null;
  }
  return BURNOUT_PRACTICE.id;
}

function prepare(seed: string) {
  const org = { ...createOrgState('default', true), seniorHp: 24 };
  const { sprint, rng } = createSprintFromBaselineInput(
    {
      seed,
      org,
      config: resolveSprintConfig('default', {
        taskCount: 28,
        focusMax: 5,
        maxTicks: BURNOUT_PRACTICE.endTick,
      }),
      cardEffects: IDENTITY_CARD_EFFECTS,
      aiAdoptionShare: 1,
      reviewLoadAdd: 10,
    },
    org,
  );
  return { rng, org, sprint };
}

type PracticeRun = ReturnType<typeof prepare> & {
  tick: number;
  choice: BurnoutPracticeAction | null;
};

export class BurnoutPractice {
  #run: PracticeRun | null;

  constructor(seed: string = BURNOUT_PRACTICE.seed) {
    this.#run = { ...prepare(seed), tick: 0, choice: null };
  }

  choose(action: BurnoutPracticeAction): boolean {
    const run = this.#run;
    if (!run || run.choice || !BURNOUT_PRACTICE.options.includes(action)) return false;
    const outcome = applyAction(action, run.sprint, run.org, run.rng, run.tick);
    if (!outcome.ok) return false;
    run.choice = action;
    return true;
  }

  step(): boolean {
    const run = this.#run;
    if (!run?.choice || run.sprint.complete || run.tick >= BURNOUT_PRACTICE.endTick) return false;
    // 内部 tick は 0 始まり。期限では通常の打ち切り処理を走らせず、実際の滞留を残す。
    stepSprint(run.sprint, run.org, run.rng, run.tick);
    run.tick += 1;
    return true;
  }

  view() {
    const run = this.#run;
    if (!run) return { phase: 'closed' } as const;
    const { sprint, org, tick, choice } = run;
    const complete = sprint.complete || tick >= BURNOUT_PRACTICE.endTick;
    return {
      phase: complete ? 'complete' : choice ? 'running' : 'ready',
      choice,
      tick,
      delivered: sprint.metrics.delivered,
      reviewQueue: sprint.tasks.filter((task) => task.lane === 'review').length,
      seniorHp: org.seniorHp,
      morale: org.morale,
      focus: sprint.focus,
      incidentCount: sprint.metrics.incidentCount,
    } as const;
  }

  close(): void {
    this.#run = null;
  }
}
