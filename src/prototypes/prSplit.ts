/** RI-166 固定盤面。通常のTask/介入とは接続しない。 */
export interface SplitTask {
  id: string;
  parentId: string | null;
  kind: 'parent' | 'child' | 'integration';
  workLeft: number;
  value: number;
  doneTick: number | null;
  children: string[];
  retired: boolean;
}
export type SplitInput =
  | { type: 'split'; id: string }
  | { type: 'work'; id: string }
  | { type: 'wait' }
  | { type: 'round'; ids: string[] };
export interface SplitState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  nextId: number;
  focus: number;
  focusSpent: number;
  workSpent: number;
  discardedWork: number;
  integrationFails: boolean;
  failures: number;
  /** 統合の初回失敗で、出荷済みの子に足す再作業。未指定は0。出荷価値は消さない。 */
  childImpairment?: number;
  tasks: SplitTask[];
  inputs: SplitInput[];
}
export function createSplitPrototype(
  seed: string,
  horizon = 10,
  integrationFails = false,
): SplitState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    nextId: 1,
    focus: 6,
    focusSpent: 0,
    workSpent: 2,
    discardedWork: 0,
    integrationFails,
    failures: 0,
    tasks: [
      {
        id: 'parent',
        parentId: null,
        kind: 'parent',
        workLeft: 4,
        value: 12,
        doneTick: null,
        children: [],
        retired: false,
      },
    ],
    inputs: [],
  };
}
function canAcceptWork(state: SplitState, task: SplitTask | undefined): task is SplitTask {
  if (!task || task.retired || task.workLeft <= 0) return false;
  if (task.kind === 'integration') {
    return (
      task.doneTick === null &&
      task.children.every((id) => {
        const child = state.tasks.find((item) => item.id === id);
        return !!child && child.doneTick !== null && child.workLeft === 0;
      })
    );
  }
  if (task.doneTick !== null) return task.kind === 'child';
  return true;
}
function spendWork(state: SplitState, task: SplitTask) {
  task.workLeft--;
  state.workSpent++;
  if (task.workLeft > 0) return;
  if (task.kind === 'integration' && state.integrationFails && state.failures === 0) {
    task.workLeft = 2;
    state.failures++;
    const extra = state.childImpairment ?? 0;
    // 出荷済みの子の価値は残し、再作業だけを残工数へ足す。再作業中は統合を再開しない。
    if (extra > 0) {
      for (const child of state.tasks) {
        if (child.kind === 'child' && child.doneTick !== null) child.workLeft += extra;
      }
    }
    return;
  }
  if (task.doneTick === null) task.doneTick = state.tick;
}
function splitParent(state: SplitState, selected: SplitTask) {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    let id: string;
    do {
      id = `split-${state.nextId++}`;
    } while (state.tasks.some((task) => task.id === id));
    ids.push(id);
    state.tasks.push({
      id,
      parentId: selected.id,
      kind: i === 2 ? 'integration' : 'child',
      workLeft: i === 2 ? 2 : 3,
      value: 4,
      doneTick: null,
      children: [],
      retired: false,
    });
  }
  state.tasks.find((task) => task.id === ids[2])!.children = ids.slice(0, 2);
  selected.children = ids;
  selected.retired = true;
  // 初期投入2工数とその後の進捗を廃棄。子の総仕事6＋統合2を新規に払う。
  state.discardedWork += 6 - selected.workLeft;
  state.focus -= 2;
  state.focusSpent += 2;
}
function applyRound(state: SplitState, ids: string[]): SplitState {
  if (state.tick >= state.horizon || ids.length === 0) return state;
  const next = structuredClone(state);
  next.tick++;
  for (const id of ids) {
    const task = next.tasks.find((item) => item.id === id);
    if (!canAcceptWork(next, task)) return state;
    spendWork(next, task);
  }
  next.inputs.push({ type: 'round', ids: [...ids] });
  return next;
}
export function applySplitInput(state: SplitState, input: SplitInput): SplitState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'round') return applyRound(state, input.ids);
  const task = input.type === 'wait' ? undefined : state.tasks.find((item) => item.id === input.id);
  if (input.type !== 'wait') {
    if (!task || task.retired) return state;
    if (input.type === 'split') {
      if (
        task.kind !== 'parent' ||
        task.children.length > 0 ||
        task.doneTick !== null ||
        state.focus < 2
      )
        return state;
    } else if (!canAcceptWork(state, task)) return state;
  }
  const next = structuredClone(state);
  const selected = task ? next.tasks.find((item) => item.id === task.id)! : undefined;
  if (input.type === 'split') splitParent(next, selected!);
  else {
    next.tick++;
    if (selected) spendWork(next, selected);
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSplit(state: SplitState) {
  const shipped = state.tasks.filter((task) => task.doneTick !== null);
  const value = shipped.reduce((sum, task) => sum + task.value, 0);
  return {
    value,
    netValue: value - state.focusSpent,
    workSpent: state.workSpent,
    discardedWork: state.discardedWork,
    focusSpent: state.focusSpent,
    failures: state.failures,
    shipped: shipped.map((task) => ({ id: task.id, tick: task.doneTick, value: task.value })),
    // 出荷後の再作業も期末の残工数に含める。再作業前の盤面では Done の残工数が0なので残件は変わらない。
    remaining: state.tasks
      .filter((task) => !task.retired && (task.doneTick === null || task.workLeft > 0))
      .map((task) => ({ id: task.id, workLeft: task.workLeft })),
  };
}
/** 子の出荷時に計上する独立点。残りは統合完了時に加算し、計上済みは消さない。 */
export function realizeSplitValue(state: SplitState, independentValue: number) {
  const parent = state.tasks.find(
    (task) => task.kind === 'parent' && !task.retired && task.doneTick !== null,
  );
  if (parent) return parent.value;
  const integration = state.tasks.find(
    (task) => task.kind === 'integration' && task.doneTick !== null,
  );
  return state.tasks
    .filter((task) => task.kind === 'child' && task.doneTick !== null)
    .reduce(
      (sum, child) => {
        const usable = Math.min(Math.max(independentValue, 0), child.value);
        return sum + usable + (integration ? child.value - usable : 0);
      },
      integration ? integration.value : 0,
    );
}
export function compareSplitStrategies(seed: string) {
  return [3, 10].flatMap((horizon) =>
    [false, true].flatMap((integrationFails) =>
      (['whole', 'split'] as const).map((strategy) => {
        const initial = createSplitPrototype(seed, horizon, integrationFails);
        let state =
          strategy === 'split'
            ? applySplitInput(initial, { type: 'split', id: 'parent' })
            : initial;
        while (state.tick < state.horizon) {
          const task = state.tasks.find((item) => !item.retired && item.doneTick === null);
          if (!task) break;
          state = applySplitInput(state, { type: 'work', id: task.id });
        }
        return {
          horizon,
          integrationFails,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeSplit(state),
        };
      }),
    ),
  );
}

export type SplitStrategyName = 'whole' | 'split';
export type SplitFactorId =
  'independence' | 'childImpairment' | 'workers' | 'carryover' | 'splitTiming' | 'focusOpportunity';
export interface SplitScenarioParams {
  factor: SplitFactorId;
  level: number;
  horizon: number;
  strategy: SplitStrategyName;
  periods: number;
  workers: number;
  independentValue: number;
  childImpairment: number;
  splitDelay: number;
  focusValue: number;
  integrationFails: boolean;
}
export interface SplitCheckpoint {
  tick: number;
  nominalValue: number;
  realizedValue: number;
  remaining: { id: string; workLeft: number }[];
}
export interface SplitScenarioResult {
  nominalValue: number;
  realizedValue: number;
  netValue: number;
  workSpent: number;
  discardedWork: number;
  focusSpent: number;
  failures: number;
  splitApplied: boolean;
  endTick: number;
  shipped: { id: string; tick: number | null; value: number }[];
  remaining: { id: string; workLeft: number }[];
  checkpoints: SplitCheckpoint[];
}
export interface SplitScenarioRow extends SplitScenarioParams {
  inputs: SplitInput[];
  result: SplitScenarioResult;
}
export interface SplitFactorPair {
  factor: SplitFactorId;
  level: number;
  horizon: number;
  wholeNet: number;
  splitNet: number;
  wholeNominal: number;
  splitNominal: number;
  winner: 'whole' | 'split' | 'tie';
  anchor: 'whole' | 'split';
  reversed: boolean;
  advantageChanged: boolean;
}
interface FactorSpec {
  id: SplitFactorId;
  varies:
    'independentValue' | 'childImpairment' | 'workers' | 'periods' | 'splitDelay' | 'focusValue';
  levels: number[];
  theme: string;
  question: string;
  integrationFails: boolean;
}
const FACTORS: FactorSpec[] = [
  {
    id: 'independence',
    varies: 'independentValue',
    levels: [0, 1, 2, 3, 4],
    theme: 'partial-independence',
    question:
      '子1件の出荷時点で、価値4のうち何点を統合前に利用できるか。残りは統合完了時に加算し、計上済みは消さない。',
    integrationFails: false,
  },
  {
    id: 'childImpairment',
    varies: 'childImpairment',
    levels: [0, 1, 2],
    theme: 'integration-failure',
    question:
      '統合の初回失敗で、出荷済みの各子に再作業を何工数足すか。台帳の出荷価値は残し、再作業が終わるまで統合を再開しない。',
    integrationFails: true,
  },
  {
    id: 'workers',
    varies: 'workers',
    levels: [1, 2, 3],
    theme: 'multiple-assignees',
    question:
      '同じ集中力と仕事量のまま、1tickに何人分の工数を進めるか。開いたタスクへ先に1人ずつ配り、余りは並びの早いタスクへ積む。',
    integrationFails: false,
  },
  {
    id: 'carryover',
    varies: 'periods',
    levels: [1, 2],
    theme: 'carryover',
    question:
      '期末で止めるか、同じ長さの次期間へ残工数を繰り越すか。未完成はどちらの期末でも残工数として残す。',
    integrationFails: false,
  },
  {
    id: 'splitTiming',
    varies: 'splitDelay',
    levels: [0, 1, 2, 3],
    theme: 'timing-and-focus',
    question:
      '分割の前に親を何tick作業するか。期末に達した分割は無消費で拒否し、その前に親が完成したら分割しない。',
    integrationFails: false,
  },
  {
    id: 'focusOpportunity',
    varies: 'focusValue',
    levels: [0, 1, 2, 3],
    theme: 'timing-and-focus',
    question:
      '消費した集中力1を差引で何点の価値として引くか。未消費の集中力は価値に換えない。基準は1。',
    integrationFails: false,
  },
];
function scenarioParams(
  factor: FactorSpec,
  level: number,
  horizon: number,
  strategy: SplitStrategyName,
): SplitScenarioParams {
  const params: SplitScenarioParams = {
    factor: factor.id,
    level,
    horizon,
    strategy,
    periods: factor.varies === 'periods' ? level : 1,
    workers: factor.varies === 'workers' ? level : 1,
    independentValue: factor.varies === 'independentValue' ? level : 4,
    childImpairment: factor.varies === 'childImpairment' ? level : 0,
    splitDelay: factor.varies === 'splitDelay' ? level : 0,
    focusValue: factor.varies === 'focusValue' ? level : 1,
    integrationFails: factor.integrationFails,
  };
  return params;
}
function heldFor(factor: FactorSpec) {
  const held: Record<string, number | boolean> = {};
  if (factor.varies !== 'workers') held.workers = 1;
  if (factor.varies !== 'periods') held.periods = 1;
  if (factor.varies !== 'independentValue') held.independentValue = 4;
  if (factor.varies !== 'childImpairment') held.childImpairment = 0;
  if (factor.varies !== 'splitDelay') held.splitDelay = 0;
  if (factor.varies !== 'focusValue') held.focusValue = 1;
  held.integrationFails = factor.integrationFails;
  return held;
}
function assignRound(state: SplitState, workers: number): string[] {
  if (workers < 1) return [];
  const scratch = structuredClone(state);
  const ids: string[] = [];
  for (let slot = 0; slot < workers; slot++) {
    const open = scratch.tasks.filter((task) => canAcceptWork(scratch, task));
    if (open.length === 0) break;
    let chosen = open[0];
    let chosenCount = ids.filter((id) => id === chosen.id).length;
    for (const task of open.slice(1)) {
      const count = ids.filter((id) => id === task.id).length;
      if (count < chosenCount) {
        chosen = task;
        chosenCount = count;
      }
    }
    ids.push(chosen.id);
    spendWork(scratch, chosen);
  }
  return ids;
}
function checkpointOf(state: SplitState, params: SplitScenarioParams): SplitCheckpoint {
  const summary = summarizeSplit(state);
  return {
    tick: state.tick,
    nominalValue: summary.value,
    realizedValue: realizeSplitValue(state, params.independentValue),
    remaining: summary.remaining,
  };
}
function scoreScenario(
  state: SplitState,
  params: SplitScenarioParams,
  checkpoints: SplitCheckpoint[],
): SplitScenarioResult {
  const summary = summarizeSplit(state);
  const realizedValue = realizeSplitValue(state, params.independentValue);
  return {
    nominalValue: summary.value,
    realizedValue,
    netValue: realizedValue - state.focusSpent * params.focusValue,
    workSpent: summary.workSpent,
    discardedWork: summary.discardedWork,
    focusSpent: summary.focusSpent,
    failures: summary.failures,
    splitApplied: state.inputs.some((input) => input.type === 'split'),
    endTick: state.tick,
    shipped: summary.shipped,
    remaining: summary.remaining,
    checkpoints,
  };
}
/** 固定戦略。残りtickを見て分割時期を早める適応は含まない。 */
export function runSplitScenario(seed: string, params: SplitScenarioParams) {
  const period = params.horizon;
  let state = createSplitPrototype(seed, period * params.periods, params.integrationFails);
  if (params.childImpairment > 0) state.childImpairment = params.childImpairment;
  const initial = structuredClone(state);
  const checkpoints: SplitCheckpoint[] = [];
  const apply = (input: SplitInput) => {
    const before = state.tick;
    const next = applySplitInput(state, input);
    if (next === state) return false;
    state = next;
    if (state.tick !== before && state.tick > 0 && state.tick % period === 0)
      checkpoints.push(checkpointOf(state, params));
    return true;
  };
  if (params.strategy === 'split') {
    for (let delay = 0; delay < params.splitDelay; delay++) {
      const ids = assignRound(state, params.workers);
      if (ids.length === 0 || !apply({ type: 'round', ids })) break;
    }
    apply({ type: 'split', id: 'parent' });
  }
  while (state.tick < state.horizon) {
    const ids = assignRound(state, params.workers);
    if (ids.length === 0 || !apply({ type: 'round', ids })) break;
  }
  const lastCheckpoint = checkpoints[checkpoints.length - 1];
  if (lastCheckpoint?.tick !== state.tick) checkpoints.push(checkpointOf(state, params));
  return { initial, inputs: state.inputs, result: scoreScenario(state, params, checkpoints) };
}
function pairsFrom(rows: SplitScenarioRow[]): SplitFactorPair[] {
  const pairs: SplitFactorPair[] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const whole = rows[index];
    const split = rows[index + 1];
    if (
      !whole ||
      !split ||
      whole.strategy !== 'whole' ||
      split.strategy !== 'split' ||
      whole.factor !== split.factor ||
      whole.level !== split.level ||
      whole.horizon !== split.horizon
    ) {
      throw new Error('感度比較の並びが単一・分割の対になっていません');
    }
    const winner =
      split.result.netValue > whole.result.netValue
        ? 'split'
        : split.result.netValue < whole.result.netValue
          ? 'whole'
          : 'tie';
    const anchor = whole.horizon === 3 ? 'split' : 'whole';
    pairs.push({
      factor: whole.factor,
      level: whole.level,
      horizon: whole.horizon,
      wholeNet: whole.result.netValue,
      splitNet: split.result.netValue,
      wholeNominal: whole.result.nominalValue,
      splitNominal: split.result.nominalValue,
      winner,
      anchor,
      reversed: winner !== 'tie' && winner !== anchor,
      advantageChanged: winner !== anchor,
    });
  }
  return pairs;
}
/**
 * 初回と同じ初期資源で因子を一つずつ動かす。
 * 固定戦略の計算であり、人間のプレイ評価でも本番評価式でもない。
 * 基準水準は初回の優劣（期末3は分割、期末10は単一）を含み、失敗有無×期末の総当たり自体は再掲しない。
 */
export function compareSplitSensitivities(seed: string) {
  const rows: SplitScenarioRow[] = [];
  for (const factor of FACTORS) {
    for (const level of factor.levels) {
      for (const horizon of [3, 10]) {
        for (const strategy of ['whole', 'split'] as const) {
          const params = scenarioParams(factor, level, horizon, strategy);
          const run = runSplitScenario(seed, params);
          rows.push({ ...params, inputs: run.inputs, result: run.result });
        }
      }
    }
  }
  return {
    seed,
    note: '固定戦略同士の計算。人間のプレイ評価はしていない。本番の通常ラン、保存、rulesetには接続していない。初回の期末3/10と統合失敗の総当たりは再掲しない。出荷済みの子の台帳価値は消さず、未完成は残工数として残す。差引は利用可能価値から集中力消費×代替価値を引いた値で、本番評価式ではない。',
    resources: {
      focus: 6,
      parentWorkLeft: 4,
      parentValue: 12,
      sunkWork: 2,
      children: 2,
      childWork: 3,
      childValue: 4,
      integrationWork: 2,
      integrationValue: 4,
      splitFocusCost: 2,
      horizons: [3, 10],
    },
    factors: FACTORS.map((factor) => ({
      id: factor.id,
      varies: factor.varies,
      levels: factor.levels,
      theme: factor.theme,
      question: factor.question,
      held: heldFor(factor),
    })),
    rows,
    pairs: pairsFrom(rows),
  };
}
