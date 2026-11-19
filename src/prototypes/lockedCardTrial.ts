/** RI-281: 未解放カードを固定スプリントの手札に貸し出す。 */
import { playCardFromHand } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { CardInstance, TaskKind } from '../sim/types';
import { unlockedContent, type MetaState } from '../state/meta';

const LOAN_CARD = 'devin';
const BASELINE_CARD = 'auto-test';
const TRIAL_CARDS = [
  { cardId: BASELINE_CARD, access: 'unlocked' },
  { cardId: LOAN_CARD, access: 'loaned' },
] as const;

type TrialCardId = (typeof TRIAL_CARDS)[number]['cardId'];

const JOBS: readonly { kind: TaskKind; highValue?: true }[] = [
  { kind: 'routine' },
  { kind: 'routine' },
  { kind: 'normal' },
  { kind: 'routine' },
  { kind: 'complex', highValue: true },
  { kind: 'normal' },
  { kind: 'complex' },
  { kind: 'routine', highValue: true },
  { kind: 'complex', highValue: true },
  { kind: 'normal' },
  { kind: 'complex' },
  { kind: 'normal' },
];

function prepare(seed: string) {
  const org = createOrgState('default', true);
  const rng = createRng(seed);
  const config = resolveSprintConfig('default', {
    taskCount: JOBS.length,
    codingSlots: 4,
    focusMax: 4,
    maxTicks: 32,
    minCompleteTick: 0,
  });
  // タスクの初期化は進行用の乱数と分け、どの seed でも仕事の並びを固定する。
  const sprint = createSprint(config, org, createRng('RI-281:layout'));
  for (const [index, job] of JOBS.entries()) {
    const task = sprint.tasks[index]!;
    task.kind = job.kind;
    task.highValue = job.highValue ?? false;
  }
  const deck: CardInstance[] = TRIAL_CARDS.map(({ cardId }) => ({ defId: cardId, level: 1 }));
  sprint.cardPiles.hand = [0, 1];
  return { org, rng, sprint, deck, tick: 0, choice: null as TrialCardId | null };
}

export class LockedCardTrial {
  #run: ReturnType<typeof prepare> | null;

  private constructor(seed: string) {
    this.#run = prepare(seed);
  }

  static start(meta: MetaState, seed = 'RI-281'): LockedCardTrial | null {
    const { cards } = unlockedContent(meta);
    if (cards.has(LOAN_CARD) || !cards.has(BASELINE_CARD)) return null;
    return new LockedCardTrial(seed);
  }

  choose(cardId: TrialCardId): boolean {
    const run = this.#run;
    if (!run || run.choice) return false;
    const index = run.deck.findIndex(({ defId }) => defId === cardId);
    if (!playCardFromHand(run.sprint, run.org, run.deck, index).ok) return false;
    run.choice = cardId;
    return true;
  }

  step(): boolean {
    const run = this.#run;
    if (!run?.choice || run.sprint.complete) return false;
    run.tick += 1;
    stepSprint(run.sprint, run.org, run.rng, run.tick);
    return true;
  }

  view() {
    const run = this.#run;
    if (!run) return { phase: 'closed' } as const;
    const { sprint, org } = run;
    return {
      phase: sprint.complete ? 'complete' : run.choice ? 'running' : 'ready',
      cards: TRIAL_CARDS.map((card) => ({ ...card })),
      choice: run.choice,
      tick: run.tick,
      tasks: sprint.tasks.map((task) => ({ ...task })),
      focus: sprint.focus,
      securityLevel: org.securityLevel,
      aiDependency: org.aiDependency,
      delivered: sprint.metrics.delivered,
      reworkCount: sprint.metrics.reworkCount,
      incidentCount: sprint.metrics.incidentCount,
      timedOut: sprint.metrics.timedOut ?? false,
    } as const;
  }

  close() {
    this.#run = null;
    return { screen: 'card-collection', cardId: LOAN_CARD } as const;
  }
}
