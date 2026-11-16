import { createRng } from '../sim/rng';

export interface FeatureTask {
  id: number;
  featureId: 'reports' | 'alerts';
  role: 'api' | 'screen' | 'migration';
  workLeft: number;
  value: number;
  done: boolean;
  reworkPending: boolean;
}

export interface FeatureSetState {
  version: 1;
  tick: number;
  deadline: number;
  tasks: FeatureTask[];
  individualValue: number;
  completions: { featureId: FeatureTask['featureId']; tick: number; integrationValue: number }[];
  history: { tick: number; taskId: number; result: 'progress' | 'rework' | 'done' }[];
}

/** 個別仕事と、三つの成果が組み合わさって使える価値を別々に定義する。 */
export const FEATURE_SETS = [
  { id: 'reports' as const, required: [0, 1, 2], integrationValue: 8 },
  { id: 'alerts' as const, required: [3, 4, 5], integrationValue: 5 },
];

export function createFeatureSetPrototype(seed: string | number): FeatureSetState {
  const rng = createRng(seed);
  const definitions: { work: number; value: number }[] = [
    { work: 2, value: 4 },
    { work: 2, value: 4 },
    { work: 5, value: 4 },
    { work: 1, value: 2 },
    { work: 1, value: 2 },
    { work: 4, value: 3 },
  ];
  return {
    version: 1,
    tick: 0,
    deadline: 8,
    tasks: definitions.map(({ work, value }, id) => ({
      id,
      featureId: id < 3 ? 'reports' : 'alerts',
      role: (['api', 'screen', 'migration'] as const)[id % 3],
      workLeft: work,
      value,
      done: false,
      reworkPending: id % 3 === 2 && rng() < 0.25,
    })),
    individualValue: 0,
    completions: [],
    history: [],
  };
}

/** 一工数/tick。手戻りはDoneの前に追加一工数、既出荷の取消や再計上はしない。 */
export function tickFeatureSetPrototype(state: FeatureSetState, taskId?: number): FeatureSetState {
  if (state.tick >= state.deadline) return state;
  const selected =
    taskId === undefined ? undefined : state.tasks.find((task) => task.id === taskId);
  if (taskId !== undefined && selected === undefined) throw new Error('未知のタスク');
  // 完了済みへの重複入力は時間・評価を変えない。
  if (selected?.done) return state;
  const next: FeatureSetState = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map((task) => ({ ...task })),
    completions: state.completions.map((completion) => ({ ...completion })),
    history: [...state.history],
  };
  if (selected === undefined) return next;
  const task = next.tasks.find((candidate) => candidate.id === taskId)!;
  task.workLeft -= 1;
  let result: FeatureSetState['history'][number]['result'] = 'progress';
  if (task.workLeft === 0) {
    if (task.reworkPending) {
      task.reworkPending = false;
      task.workLeft = 1;
      result = 'rework';
    } else {
      task.done = true;
      next.individualValue += task.value;
      result = 'done';
      for (const feature of FEATURE_SETS) {
        if (next.completions.some((completion) => completion.featureId === feature.id)) continue;
        if (
          feature.required.every((id) =>
            next.tasks.some((candidate) => candidate.id === id && candidate.done),
          )
        ) {
          next.completions.push({
            featureId: feature.id,
            tick: next.tick,
            integrationValue: feature.integrationValue,
          });
        }
      }
    }
  }
  next.history.push({ tick: next.tick, taskId: task.id, result });
  return next;
}

export function summarizeFeatureSets(state: FeatureSetState) {
  return {
    individualValue: state.individualValue,
    integrationValue: state.completions.reduce((sum, feature) => sum + feature.integrationValue, 0),
    completedFeatures: state.completions,
    completedTasks: state.tasks.filter((task) => task.done).map((task) => task.id),
    pendingTasks: state.tasks
      .filter((task) => !task.done)
      .map((task) => ({
        id: task.id,
        workLeft: task.workLeft,
        reworkPending: task.reworkPending,
      })),
    rework: state.history.filter((entry) => entry.result === 'rework').length,
    tick: state.tick,
  };
}

export const FEATURE_SET_ORDERS = {
  immediate: [0, 1, 3, 4, 5, 2],
  'complete-feature': [3, 4, 5, 0, 1, 2],
} as const;

const FEATURE_SET_STRATEGIES = ['immediate', 'complete-feature'] as const;

export type FeatureSetStrategy = (typeof FEATURE_SET_STRATEGIES)[number];

export function compareFeatureSetStrategies(seed: string | number) {
  return FEATURE_SET_STRATEGIES.map((strategy) => {
    const order = FEATURE_SET_ORDERS[strategy];
    let state = createFeatureSetPrototype(seed);
    while (state.tick < state.deadline) {
      state = tickFeatureSetPrototype(
        state,
        order.find((id) => !state.tasks.find((task) => task.id === id)!.done),
      );
    }
    return { strategy, ...summarizeFeatureSets(state), history: state.history };
  });
}

export interface FeatureSetFactorParameter {
  deadline: number;
  /** 通知の移行（タスク5）に手戻り予定を置く。false は seed のまま上書きして消す。 */
  alertsRework: boolean;
  /** 比較で統合価値を数える機能。完成の記録そのものは変えない。 */
  needed: FeatureTask['featureId'][];
}

export interface FeatureSetFactorPlay {
  strategy: FeatureSetStrategy;
  inputs: (number | null)[];
  individualValue: number;
  integrationValue: number;
  countedIntegration: number;
  completedFeatures: FeatureSetState['completions'];
  completedTasks: number[];
  pendingTasks: { id: number; workLeft: number; reworkPending: boolean }[];
  rework: number;
  tick: number;
  history: FeatureSetState['history'];
}

export type FeatureSetRelation = 'immediate' | 'complete-feature' | 'tie' | 'tradeoff';

export interface FeatureSetFactorRow {
  parameter: FeatureSetFactorParameter;
  differsFromAnchor: ('deadline' | 'alertsRework' | 'needed')[];
  sameAsFirstComparison: boolean;
  initial: FeatureSetState;
  plays: FeatureSetFactorPlay[];
  relation: FeatureSetRelation;
  /** 即時出荷の個別 − 機能完成の個別。正なら即時出荷の方が個別を多く確定している。 */
  individualGap: number;
  /** 機能完成の計上統合 − 即時出荷の計上統合。正なら機能完成の方が統合を多く数えている。 */
  integrationGap: number;
}

const ANCHOR: FeatureSetFactorParameter = {
  deadline: 8,
  alertsRework: false,
  needed: ['reports', 'alerts'],
};

const FACTOR_KNOBS = ['deadline', 'alertsRework', 'needed'] as const;

function neededOf(needed: readonly FeatureTask['featureId'][]): FeatureTask['featureId'][] {
  return (['reports', 'alerts'] as const).filter((id) => needed.includes(id));
}

function neededKey(needed: readonly FeatureTask['featureId'][]): string {
  return neededOf(needed).join(',');
}

function parameterOf(patch: Partial<FeatureSetFactorParameter>): FeatureSetFactorParameter {
  return {
    deadline: patch.deadline ?? ANCHOR.deadline,
    alertsRework: patch.alertsRework ?? ANCHOR.alertsRework,
    needed: neededOf(patch.needed ?? ANCHOR.needed),
  };
}

function knobDiffs(
  left: FeatureSetFactorParameter,
  right: FeatureSetFactorParameter,
): FeatureSetFactorRow['differsFromAnchor'] {
  return FACTOR_KNOBS.filter((knob) => {
    if (knob === 'needed') return neededKey(left.needed) !== neededKey(right.needed);
    return left[knob] !== right[knob];
  });
}

function createConditionBoard(
  seed: string | number,
  parameter: FeatureSetFactorParameter,
): FeatureSetState {
  const state = createFeatureSetPrototype(seed);
  state.deadline = parameter.deadline;
  const migration = state.tasks.find((task) => task.id === 5);
  if (migration === undefined) throw new Error('通知の移行がない');
  migration.reworkPending = parameter.alertsRework;
  return state;
}

function relate(
  plays: FeatureSetFactorPlay[],
): Pick<FeatureSetFactorRow, 'relation' | 'individualGap' | 'integrationGap'> {
  const immediate = plays.find((play) => play.strategy === 'immediate');
  const feature = plays.find((play) => play.strategy === 'complete-feature');
  if (immediate === undefined || feature === undefined) throw new Error('戦略が揃っていない');
  const individualGap = immediate.individualValue - feature.individualValue;
  const integrationGap = feature.countedIntegration - immediate.countedIntegration;
  if (individualGap === 0 && integrationGap === 0) {
    return { relation: 'tie', individualGap, integrationGap };
  }
  if (individualGap >= 0 && integrationGap <= 0) {
    return { relation: 'immediate', individualGap, integrationGap };
  }
  if (individualGap <= 0 && integrationGap >= 0) {
    return { relation: 'complete-feature', individualGap, integrationGap };
  }
  return { relation: 'tradeoff', individualGap, integrationGap };
}

function runCondition(
  seed: string | number,
  parameter: FeatureSetFactorParameter,
): FeatureSetFactorRow {
  const initial = createConditionBoard(seed, parameter);
  const plays = FEATURE_SET_STRATEGIES.map((strategy) => {
    const order = FEATURE_SET_ORDERS[strategy];
    const inputs: (number | null)[] = [];
    let state = structuredClone(initial);
    while (state.tick < state.deadline) {
      const taskId = order.find((id) => !state.tasks.find((task) => task.id === id)!.done);
      inputs.push(taskId ?? null);
      state = tickFeatureSetPrototype(state, taskId);
    }
    const summary = summarizeFeatureSets(state);
    const countedIntegration = state.completions
      .filter((completion) => parameter.needed.includes(completion.featureId))
      .reduce((sum, completion) => sum + completion.integrationValue, 0);
    return { strategy, inputs, ...summary, countedIntegration, history: state.history };
  });
  return {
    parameter,
    differsFromAnchor: knobDiffs(parameter, ANCHOR),
    sameAsFirstComparison: knobDiffs(parameter, ANCHOR).length === 0,
    initial: structuredClone(initial),
    plays,
    ...relate(plays),
  };
}

function adjacentReversals(factor: string, rows: FeatureSetFactorRow[]) {
  const found = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (before === undefined || after === undefined || before.relation === after.relation) continue;
    found.push({
      factor,
      before: {
        parameter: before.parameter,
        relation: before.relation,
        individualGap: before.individualGap,
        integrationGap: before.integrationGap,
      },
      after: {
        parameter: after.parameter,
        relation: after.relation,
        individualGap: after.individualGap,
        integrationGap: after.integrationGap,
      },
    });
  }
  return found;
}

function completionAhead(row: FeatureSetFactorRow): boolean {
  if (row.relation === 'complete-feature') return true;
  return row.relation === 'tradeoff' && row.integrationGap > row.individualGap;
}

/** 初回と同じ資源で、期限・手戻り・顧客必要性を一つずつ動かす。固定戦略であり人間のプレイ評価ではない。 */
export function compareFeatureSetFactorReversals(seed: string | number) {
  const deadline = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tick) =>
    runCondition(seed, parameterOf({ deadline: tick })),
  );
  const reworkOnDeadline = [6, 7, 8].map((tick) =>
    runCondition(seed, parameterOf({ deadline: tick, alertsRework: true })),
  );
  const customerNeed = ([['reports', 'alerts'], ['alerts'], ['reports'], []] as const).map(
    (needed) => runCondition(seed, parameterOf({ needed: [...needed] })),
  );
  const sweeps = { deadline, reworkOnDeadline, customerNeed };
  const reworkVersusSameDeadline = reworkOnDeadline.flatMap((row) => {
    const paired = deadline.find(
      (candidate) => candidate.parameter.deadline === row.parameter.deadline,
    );
    if (paired === undefined || paired.relation === row.relation) return [];
    return [
      {
        factor: 'reworkVersusSameDeadline',
        before: {
          parameter: paired.parameter,
          relation: paired.relation,
          individualGap: paired.individualGap,
          integrationGap: paired.integrationGap,
        },
        after: {
          parameter: row.parameter,
          relation: row.relation,
          individualGap: row.individualGap,
          integrationGap: row.integrationGap,
        },
      },
    ];
  });
  const rows = [...deadline, ...reworkOnDeadline, ...customerNeed];
  return {
    seed,
    conditions: {
      anchor: ANCHOR,
      orders: FEATURE_SET_ORDERS,
      integration: FEATURE_SETS.map((feature) => ({
        id: feature.id,
        integrationValue: feature.integrationValue,
      })),
      integrationAdjusted: false,
      featureCompletionAlwaysAhead: rows.every(completionAhead),
      score: '個別価値と計上した統合価値は別欄のまま。合計点は作らない',
      fixedStrategies: true,
      humanPlaytest: false,
      productionAdoption: false,
      repeatedFirstComparison: false,
    },
    sweeps,
    reversals: [
      ...adjacentReversals('deadline', deadline),
      ...adjacentReversals('reworkOnDeadline', reworkOnDeadline),
      ...adjacentReversals('customerNeed', customerNeed),
      ...reworkVersusSameDeadline,
    ],
  };
}
