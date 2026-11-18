/** RI-263: 指定時刻の顧客デモだけを評価する独立試作。通常ランには接続しない。 */
export type DemoTaskId = 'api' | 'screen' | 'data' | 'urgent' | 'bulk';
export interface DemoTask {
  id: DemoTaskId;
  required: boolean;
  work: number;
  progress: number;
  shipment: number;
  completedTick: number | null;
}
export interface DemoRules {
  deadline: number;
  horizon: number;
  workBudget: number;
  dataWork: number;
  bulkShipment: number;
  trustLossPerMissing: number;
}
export const baselineDemoRules: Readonly<DemoRules> = {
  deadline: 7,
  horizon: 10,
  workBudget: 10,
  dataWork: 3,
  bulkShipment: 8,
  trustLossPerMissing: 2,
};
export interface DemoAssessment {
  tick: number;
  established: boolean;
  completedRequired: DemoTaskId[];
  missingRequired: { id: DemoTaskId; progress: number; remaining: number }[];
  /** 完成した必須1件につき2。総出荷には加算しない。 */
  partialCredit: number;
  totalShipment: number;
  optionalShipment: number;
  trustLoss: number;
}
export type DemoInput =
  { seq: number; type: 'priority'; taskId: DemoTaskId } | { seq: number; type: 'step' };
export interface DemoState {
  version: 1;
  seed: string | number;
  rules: DemoRules;
  tick: number;
  nextSequence: number;
  priority: DemoTaskId | null;
  workRemaining: number;
  trust: number;
  tasks: DemoTask[];
  demo: DemoAssessment | null;
  inputs: DemoInput[];
}
const START_TRUST = 6;
const PARTIAL_CREDIT = 2;
const AUTO_ORDER: readonly DemoTaskId[] = ['bulk', 'api', 'screen', 'urgent', 'data'];

export function createCustomerDemoBoss(
  seed: string | number,
  rules: DemoRules = baselineDemoRules,
): DemoState {
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`不正な係数: ${key}`);
  }
  if (rules.deadline < 1 || rules.horizon < rules.deadline || rules.dataWork < 1)
    throw new Error('デモ期限・期間・必須工数が不正');
  const definitions: [DemoTaskId, boolean, number, number][] = [
    ['api', true, 2, 4],
    ['screen', true, 2, 4],
    ['data', true, rules.dataWork, 4],
    ['urgent', false, 2, 4],
    ['bulk', false, 2, rules.bulkShipment],
  ];
  return {
    version: 1,
    seed,
    rules: { ...rules },
    tick: 0,
    nextSequence: 0,
    priority: null,
    workRemaining: rules.workBudget,
    trust: START_TRUST,
    tasks: definitions.map(([id, required, work, shipment]) => ({
      id,
      required,
      work,
      progress: 0,
      shipment,
      completedTick: null,
    })),
    demo: null,
    inputs: [],
  };
}

function shipmentOf(tasks: DemoTask[]) {
  return tasks.reduce((sum, task) => sum + (task.completedTick === null ? 0 : task.shipment), 0);
}

function assess(state: DemoState): DemoAssessment {
  const required = state.tasks.filter((task) => task.required);
  const completed = required.filter((task) => task.completedTick !== null);
  const missing = required.filter((task) => task.completedTick === null);
  return {
    tick: state.tick,
    established: missing.length === 0,
    completedRequired: completed.map((task) => task.id),
    missingRequired: missing.map((task) => ({
      id: task.id,
      progress: task.progress,
      remaining: task.work - task.progress,
    })),
    partialCredit: completed.length * PARTIAL_CREDIT,
    totalShipment: shipmentOf(state.tasks),
    optionalShipment: shipmentOf(state.tasks.filter((task) => !task.required)),
    trustLoss: Math.min(state.trust, missing.length * state.rules.trustLossPerMissing),
  };
}

/** 閲覧と優先指定は時間を進めない。step は無操作でも既定順で作業する。 */
export function applyCustomerDemoInput(state: DemoState, input: DemoInput): DemoState {
  if (state.tick >= state.rules.horizon || input.seq !== state.nextSequence) return state;
  if (input.type === 'priority') {
    const target = state.tasks.find((task) => task.id === input.taskId);
    if (!target || target.completedTick !== null || state.priority === input.taskId) return state;
  }
  const next = structuredClone(state);
  next.inputs.push({ ...input });
  next.nextSequence += 1;
  if (input.type === 'priority') {
    next.priority = input.taskId;
    return next;
  }
  next.tick += 1;
  const order = next.priority === null ? AUTO_ORDER : [next.priority, ...AUTO_ORDER];
  const target = order
    .map((id) => next.tasks.find((task) => task.id === id)!)
    .find((task) => task.completedTick === null);
  if (target && next.workRemaining > 0) {
    target.progress += 1;
    next.workRemaining -= 1;
    if (target.progress === target.work) target.completedTick = next.tick;
  }
  // 期限tickの作業を含めた一度きりの評価。遅れて完成しても書き換えない。
  if (next.tick === next.rules.deadline && next.demo === null) {
    next.demo = assess(next);
    next.trust -= next.demo.trustLoss;
  }
  return next;
}

/** 内部の信頼済みversion 1 JSON用。通常の保存・ruleset互換は対象外。 */
export function replayCustomerDemo(initial: DemoState, inputs: readonly DemoInput[]): DemoState {
  return inputs.reduce(applyCustomerDemoInput, initial);
}

/** 開始前にも全必須条件・工数・期限・資源・部分評価・代償を返す。参照を共有しない。 */
export function viewCustomerDemo(state: DemoState) {
  return structuredClone({
    tick: state.tick,
    rules: state.rules,
    workerSlots: 1,
    workPerTick: 1,
    autoOrder: AUTO_ORDER,
    requiredTaskIds: state.tasks.filter((task) => task.required).map((task) => task.id),
    partialCreditPerCompletedRequired: PARTIAL_CREDIT,
    initialTrust: START_TRUST,
    workRemaining: state.workRemaining,
    priority: state.priority,
    trust: state.trust,
    tasks: state.tasks,
    demo: state.demo,
  });
}

export function summarizeCustomerDemo(state: DemoState) {
  return {
    tick: state.tick,
    workRemaining: state.workRemaining,
    trust: state.trust,
    demo: structuredClone(state.demo),
    ended: state.tick >= state.rules.horizon,
    totalShipment: shipmentOf(state.tasks),
    optionalShipment: shipmentOf(state.tasks.filter((task) => !task.required)),
    spentWork: state.rules.workBudget - state.workRemaining,
    completions: state.tasks
      .filter((task) => task.completedTick !== null)
      .map((task) => ({ id: task.id, tick: task.completedTick, shipment: task.shipment })),
    pending: state.tasks
      .filter((task) => task.completedTick === null)
      .map((task) => ({
        id: task.id,
        progress: task.progress,
        remaining: task.work - task.progress,
        unshippedValue: task.shipment,
      })),
  };
}

export const DEMO_ORDERS = {
  demo: ['api', 'screen', 'data', 'bulk', 'urgent'],
  equalShipment: ['api', 'screen', 'urgent', 'data', 'bulk'],
  throughput: ['bulk', 'urgent', 'api', 'screen', 'data'],
} as const;

export function runCustomerDemo(
  seed: string | number,
  strategy: keyof typeof DEMO_ORDERS | 'automatic',
  rules: DemoRules = baselineDemoRules,
) {
  const initial = createCustomerDemoBoss(seed, rules);
  let state = initial;
  while (state.tick < state.rules.horizon) {
    if (strategy !== 'automatic') {
      const id = DEMO_ORDERS[strategy].find(
        (id) => state.tasks.find((task) => task.id === id)!.completedTick === null,
      );
      if (id && id !== state.priority)
        state = applyCustomerDemoInput(state, {
          seq: state.nextSequence,
          type: 'priority',
          taskId: id,
        });
    }
    state = applyCustomerDemoInput(state, { seq: state.nextSequence, type: 'step' });
  }
  return { strategy, initial, inputs: state.inputs, result: summarizeCustomerDemo(state) };
}

/** 乱数を使わない固定仕事。seedは再生の識別子で、隠れた工数変動を持たない。 */
export function compareCustomerDemoBoss() {
  const seed = 'RI-263';
  const strategies = ['demo', 'equalShipment', 'throughput', 'automatic'] as const;
  const conditions: { name: string; patch: Partial<DemoRules> }[] = [
    { name: 'baseline', patch: {} },
    { name: 'deadline-6', patch: { deadline: 6 } },
    { name: 'deadline-8', patch: { deadline: 8 } },
    { name: 'deadline-9', patch: { deadline: 9 } },
    { name: 'data-work-4', patch: { dataWork: 4 } },
    { name: 'budget-6', patch: { workBudget: 6 } },
    { name: 'bulk-value-4', patch: { bulkShipment: 4 } },
    { name: 'missing-loss-0', patch: { trustLossPerMissing: 0 } },
    { name: 'missing-loss-4', patch: { trustLossPerMissing: 4 } },
  ];
  return {
    seed,
    stochastic: false,
    humanEvaluation: false,
    conditions: conditions.map(({ name, patch }) => {
      const rules = { ...baselineDemoRules, ...patch };
      return {
        name,
        initial: createCustomerDemoBoss(seed, rules),
        plays: (name === 'baseline' ? strategies : (['demo', 'throughput'] as const)).map(
          (strategy) => {
            const { inputs, result } = runCustomerDemo(seed, strategy, rules);
            return { strategy, inputs, result };
          },
        ),
      };
    }),
  };
}
