import {
  createDependencyPrototype,
  tickDependencyPrototype,
  type DependencyState,
} from './taskDependencies';

export interface DeadlineState {
  version: 1;
  board: DependencyState;
  deadlineTick: number;
  onTimeValue: number;
  lateValue: number;
  focus: number;
  stamina: number;
  boosts: number[];
}

export function createDeadlinePrototype(
  seed: string | number,
  pressure: 'recoverable' | 'missed',
): DeadlineState {
  const board = createDependencyPrototype(seed);
  board.tasks = [
    {
      id: 'campaign',
      requires: [],
      workLeft: pressure === 'recoverable' ? 4 : 6,
      value: 12,
      done: false,
    },
  ];
  board.horizon = 8;
  return {
    version: 1,
    board,
    deadlineTick: 3,
    onTimeValue: 12,
    lateValue: 5,
    focus: 2,
    stamina: 10,
    boosts: [],
  };
}

export function deadlineValue(state: DeadlineState, completionTick: number): number {
  return completionTick <= state.deadlineTick ? state.onTimeValue : state.lateValue;
}

/** tick終端に出荷してから価値を確定する。期限tickの出荷は期限内。 */
export function tickDeadlinePrototype(
  state: DeadlineState,
  action: 'work' | 'boost' | 'wait',
): DeadlineState {
  if (state.board.tick >= state.board.horizon || state.board.tasks[0].done) return state;
  if (action === 'boost' && (state.focus < 1 || state.stamina < 3)) return state;
  let board = state.board;
  const usefulBoost = action === 'boost' && board.tasks[0].workLeft > 1;
  // 追加工数を先に確保し、共通エンジンで通常工数とDoneを一度だけ確定する。
  if (usefulBoost)
    board = {
      ...board,
      tasks: board.tasks.map((task) => ({ ...task, workLeft: task.workLeft - 1 })),
    };
  board = tickDependencyPrototype(
    board,
    action === 'wait' ? { kind: 'wait' } : { kind: 'assign', id: 'campaign' },
  );
  board = {
    ...board,
    shipped: board.shipped.map((shipment) => ({
      ...shipment,
      value: deadlineValue(state, shipment.tick),
    })),
  };
  return {
    ...state,
    board,
    focus: state.focus - (action === 'boost' ? 1 : 0),
    stamina: state.stamina - (action === 'boost' ? 3 : 0),
    boosts: action === 'boost' ? [...state.boosts, board.tick] : [...state.boosts],
  };
}

export function compareDeadlineStrategies(seed: string | number) {
  return (['recoverable', 'missed'] as const).flatMap((pressure) =>
    (['conserve', 'rush'] as const).map((strategy) => {
      let state = createDeadlinePrototype(seed, pressure);
      while (!state.board.tasks[0].done && state.board.tick < state.board.horizon) {
        state = tickDeadlinePrototype(
          state,
          strategy === 'rush' && state.board.tick === 0 ? 'boost' : 'work',
        );
      }
      return {
        pressure,
        strategy,
        shipped: state.board.shipped,
        workLeft: state.board.tasks[0].workLeft,
        focus: state.focus,
        stamina: state.stamina,
        boosts: state.boosts,
      };
    }),
  );
}

/**
 * 要因比較は初回と同じ資源に別案件を1件足す。
 * 通常ラン、UI、保存、rulesetへは接続しない。予告は試作内の文だけで、画面には出さない。
 */
export const deadlineChoiceResources = {
  seed: 'RI-155',
  horizon: 8,
  focus: 2,
  stamina: 10,
  deadlineTick: 3,
  onTimeValue: 12,
  lateValue: 5,
  boostFocus: 1,
  boostStamina: 3,
  otherWork: 4,
  campaignWork: { recoverable: 4, missed: 6 },
} as const;

export type DeadlinePressure = 'recoverable' | 'missed';
export type DeadlineChoiceId = 'campaign' | 'steady';
export type DeadlineChoiceStrategy = 'deadline' | 'other';
export type DeadlinePreviewKind = 'none' | 'accurate' | 'swapped' | 'falseMeet';
export type DeadlinePreference = DeadlineChoiceStrategy | 'tie';
export type DeadlineChoiceInput =
  { type: 'wait' } | { type: 'boost' } | { type: 'work'; id: DeadlineChoiceId };

export interface DeadlineFactorRules {
  otherValue: number;
  nextPeriodStaminaCost: number;
  preview: DeadlinePreviewKind;
}

export const baselineDeadlineFactorRules: DeadlineFactorRules = {
  otherValue: deadlineChoiceResources.lateValue,
  nextPeriodStaminaCost: 0,
  preview: 'accurate',
};

interface DeadlineChoiceTask {
  id: DeadlineChoiceId;
  workLeft: number;
  done: boolean;
}

export interface DeadlineChoiceState {
  version: 1;
  seed: typeof deadlineChoiceResources.seed;
  pressure: DeadlinePressure;
  tick: number;
  horizon: number;
  deadlineTick: number;
  onTimeValue: number;
  lateValue: number;
  focus: number;
  stamina: number;
  boosts: number[];
  tasks: DeadlineChoiceTask[];
  shipped: { id: DeadlineChoiceId; tick: number; value: number }[];
  inputs: DeadlineChoiceInput[];
  previewText: string;
  nextPeriodStaminaCost: number;
  otherValue: number;
}

export interface DeadlineChoiceResult {
  tick: number;
  shippedValue: number;
  staminaSpent: number;
  net: number;
  focus: number;
  stamina: number;
  boosts: number[];
  shipped: DeadlineChoiceState['shipped'];
  remaining: { id: DeadlineChoiceId; workLeft: number }[];
}

/** 期限内の通常工数に、追加1回分を足した量。工数4は届き、工数6は届かない。 */
const ONE_BOOST_CAPACITY = deadlineChoiceResources.deadlineTick + 1;

export function deadlinePreviewSentence(kind: DeadlinePreviewKind, campaignWork: number): string {
  if (kind === 'none') return '予告はない。';
  const { onTimeValue, lateValue } = deadlineChoiceResources;
  const onTime = kind === 'swapped' ? lateValue : onTimeValue;
  const late = kind === 'swapped' ? onTimeValue : lateValue;
  const meets = kind === 'falseMeet' ? true : campaignWork <= ONE_BOOST_CAPACITY;
  const reach = meets ? '追加作業1回で期限内に届く' : '追加作業1回では期限内に届かない';
  return `tick 3までに出荷すると価値${onTime}、過ぎると${late}。${reach}。`;
}

export function readDeadlinePreview(text: string): {
  onTimeValue: number | null;
  lateValue: number | null;
  saysBoostMeets: boolean;
} {
  if (text === '予告はない。') {
    return { onTimeValue: null, lateValue: null, saysBoostMeets: false };
  }
  const matched = text.match(
    /^tick 3までに出荷すると価値(\d+)、過ぎると(\d+)。追加作業1回(では期限内に届かない|で期限内に届く)。$/,
  );
  if (!matched) throw new Error('予告文を読めない');
  return {
    onTimeValue: Number(matched[1]),
    lateValue: Number(matched[2]),
    saysBoostMeets: matched[3] === 'で期限内に届く',
  };
}

export function createDeadlineChoice(
  pressure: DeadlinePressure,
  rules: DeadlineFactorRules = baselineDeadlineFactorRules,
): DeadlineChoiceState {
  const resources = deadlineChoiceResources;
  return {
    version: 1,
    seed: resources.seed,
    pressure,
    tick: 0,
    horizon: resources.horizon,
    deadlineTick: resources.deadlineTick,
    onTimeValue: resources.onTimeValue,
    lateValue: resources.lateValue,
    focus: resources.focus,
    stamina: resources.stamina,
    boosts: [],
    tasks: [
      { id: 'campaign', workLeft: resources.campaignWork[pressure], done: false },
      { id: 'steady', workLeft: resources.otherWork, done: false },
    ],
    shipped: [],
    inputs: [],
    previewText: deadlinePreviewSentence(rules.preview, resources.campaignWork[pressure]),
    nextPeriodStaminaCost: rules.nextPeriodStaminaCost,
    otherValue: rules.otherValue,
  };
}

function findTask(tasks: DeadlineChoiceTask[], id: DeadlineChoiceId): DeadlineChoiceTask {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error('未知のタスク');
  return task;
}

function copyInput(input: DeadlineChoiceInput): DeadlineChoiceInput {
  return input.type === 'work' ? { type: 'work', id: input.id } : { type: input.type };
}

/** 追加作業は期限案件だけ。資源不足・完了済み・期末は時間も費用も使わない。 */
export function tickDeadlineChoice(
  state: DeadlineChoiceState,
  input: DeadlineChoiceInput,
): DeadlineChoiceState {
  if (state.tick >= state.horizon || state.tasks.every((task) => task.done)) return state;
  if (input.type === 'work' && findTask(state.tasks, input.id).done) return state;
  const campaign = findTask(state.tasks, 'campaign');
  if (input.type === 'boost') {
    if (
      state.focus < deadlineChoiceResources.boostFocus ||
      state.stamina < deadlineChoiceResources.boostStamina ||
      campaign.done
    ) {
      return state;
    }
  }
  const tasks = state.tasks.map((task) => ({ ...task }));
  let focus = state.focus;
  let stamina = state.stamina;
  let boosts = state.boosts;
  if (input.type === 'boost') {
    focus -= deadlineChoiceResources.boostFocus;
    stamina -= deadlineChoiceResources.boostStamina;
    boosts = [...boosts, state.tick + 1];
    const boosted = findTask(tasks, 'campaign');
    if (boosted.workLeft > 1) boosted.workLeft -= 1;
  }
  const shipped = [...state.shipped];
  if (input.type !== 'wait') {
    const id = input.type === 'boost' ? 'campaign' : input.id;
    const task = findTask(tasks, id);
    task.workLeft -= 1;
    if (task.workLeft === 0) {
      task.done = true;
      shipped.push({
        id,
        tick: state.tick + 1,
        value:
          id === 'campaign'
            ? state.tick + 1 <= state.deadlineTick
              ? state.onTimeValue
              : state.lateValue
            : state.otherValue,
      });
    }
  }
  return {
    ...state,
    tick: state.tick + 1,
    tasks,
    shipped,
    focus,
    stamina,
    boosts,
    inputs: [...state.inputs, copyInput(input)],
  };
}

function previewAsksForBoost(state: DeadlineChoiceState): boolean {
  const campaign = findTask(state.tasks, 'campaign');
  if (state.boosts.length > 0 || campaign.done || campaign.workLeft <= 1) return false;
  if (
    state.focus < deadlineChoiceResources.boostFocus ||
    state.stamina < deadlineChoiceResources.boostStamina
  ) {
    return false;
  }
  const preview = readDeadlinePreview(state.previewText);
  if (!preview.saysBoostMeets || preview.onTimeValue === null || preview.lateValue === null) {
    return false;
  }
  return preview.onTimeValue > preview.lateValue;
}

/** 固定戦略。翌期費用は見ない。期限案件優先だけが予告文を読んで最初の1tickを追加する。 */
export function chooseDeadlineChoice(
  state: DeadlineChoiceState,
  strategy: DeadlineChoiceStrategy,
): DeadlineChoiceInput {
  if (state.tick >= state.horizon || state.tasks.every((task) => task.done))
    return { type: 'wait' };
  const order: DeadlineChoiceId[] =
    strategy === 'deadline' ? ['campaign', 'steady'] : ['steady', 'campaign'];
  const id = order.find((candidate) => !findTask(state.tasks, candidate).done);
  if (!id) return { type: 'wait' };
  if (strategy === 'deadline' && id === 'campaign' && previewAsksForBoost(state)) {
    return { type: 'boost' };
  }
  return { type: 'work', id };
}

export function summarizeDeadlineChoice(state: DeadlineChoiceState): DeadlineChoiceResult {
  const shippedValue = state.shipped.reduce((sum, item) => sum + item.value, 0);
  const staminaSpent = state.boosts.length * deadlineChoiceResources.boostStamina;
  return {
    tick: state.tick,
    shippedValue,
    staminaSpent,
    net: shippedValue - state.nextPeriodStaminaCost * staminaSpent,
    focus: state.focus,
    stamina: state.stamina,
    boosts: [...state.boosts],
    shipped: state.shipped.map((item) => ({ ...item })),
    remaining: state.tasks
      .filter((task) => !task.done)
      .map((task) => ({ id: task.id, workLeft: task.workLeft })),
  };
}

export interface DeadlineFactorRun {
  inputs: DeadlineChoiceInput[];
  result: DeadlineChoiceResult;
}

export interface DeadlineFactorPressure {
  pressure: DeadlinePressure;
  campaignWork: number;
  previewText: string;
  preference: DeadlinePreference;
  margin: number;
  deadline: DeadlineFactorRun;
  other: DeadlineFactorRun;
}

export interface DeadlineFactorPoint {
  axis: string;
  parameter: string;
  rules: DeadlineFactorRules;
  pressures: DeadlineFactorPressure[];
}

export interface DeadlineFactorReversal {
  axis: string;
  pressure: DeadlinePressure;
  before: {
    parameter: string;
    preference: DeadlinePreference;
    deadlineNet: number;
    otherNet: number;
    deadlineStamina: number;
    otherStamina: number;
  };
  after: DeadlineFactorReversal['before'];
}

const FACTOR_PRESSURES: DeadlinePressure[] = ['recoverable', 'missed'];

function cloneFactorRules(rules: DeadlineFactorRules): DeadlineFactorRules {
  return { ...rules };
}

function withFactorRules(patch: Partial<DeadlineFactorRules>): DeadlineFactorRules {
  return { ...baselineDeadlineFactorRules, ...patch };
}

function preferenceOf(
  deadlineNet: number,
  otherNet: number,
  deadlineStamina: number,
  otherStamina: number,
): DeadlinePreference {
  if (deadlineNet !== otherNet) return deadlineNet > otherNet ? 'deadline' : 'other';
  if (deadlineStamina !== otherStamina)
    return deadlineStamina < otherStamina ? 'deadline' : 'other';
  return 'tie';
}

function runDeadlineChoice(
  pressure: DeadlinePressure,
  strategy: DeadlineChoiceStrategy,
  rules: DeadlineFactorRules,
): DeadlineFactorRun {
  let state = createDeadlineChoice(pressure, rules);
  let guard = 0;
  while (state.tick < state.horizon && state.tasks.some((task) => !task.done)) {
    if (++guard > state.horizon) throw new Error(`${pressure}:${strategy}`);
    const input = chooseDeadlineChoice(state, strategy);
    const next = tickDeadlineChoice(state, input);
    if (next === state) throw new Error(`${pressure}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeDeadlineChoice(state) };
}

function factorPoint(
  axis: string,
  parameter: string,
  rules: DeadlineFactorRules,
): DeadlineFactorPoint {
  const pressures = FACTOR_PRESSURES.map((pressure) => {
    const deadline = runDeadlineChoice(pressure, 'deadline', rules);
    const other = runDeadlineChoice(pressure, 'other', rules);
    return {
      pressure,
      campaignWork: deadlineChoiceResources.campaignWork[pressure],
      previewText: createDeadlineChoice(pressure, rules).previewText,
      preference: preferenceOf(
        deadline.result.net,
        other.result.net,
        deadline.result.staminaSpent,
        other.result.staminaSpent,
      ),
      margin: deadline.result.net - other.result.net,
      deadline,
      other,
    };
  });
  return { axis, parameter, rules: cloneFactorRules(rules), pressures };
}

function reversalsOf(rows: DeadlineFactorPoint[]): DeadlineFactorReversal[] {
  const found: DeadlineFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const pressure of FACTOR_PRESSURES) {
      const earlier = before.pressures.find((item) => item.pressure === pressure);
      const later = after.pressures.find((item) => item.pressure === pressure);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      const side = (point: DeadlineFactorPoint, row: DeadlineFactorPressure) => ({
        parameter: point.parameter,
        preference: row.preference,
        deadlineNet: row.deadline.result.net,
        otherNet: row.other.result.net,
        deadlineStamina: row.deadline.result.staminaSpent,
        otherStamina: row.other.result.staminaSpent,
      });
      found.push({
        axis: before.axis,
        pressure,
        before: side(before, earlier),
        after: side(after, later),
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、期限後の優先・翌期費用・予告文を一つずつ動かす。固定戦略。 */
export function compareDeadlineFactorReversals() {
  const sweeps = {
    overdueVersusOther: [0, 4, 5, 6, 12].map((otherValue) =>
      factorPoint('overdueVersusOther', String(otherValue), withFactorRules({ otherValue })),
    ),
    nextPeriodStaminaCost: [0, 1, 2, 3].map((nextPeriodStaminaCost) =>
      factorPoint(
        'nextPeriodStaminaCost',
        String(nextPeriodStaminaCost),
        withFactorRules({ nextPeriodStaminaCost }),
      ),
    ),
    preview: (['accurate', 'none', 'swapped', 'falseMeet'] as const).map((preview) =>
      factorPoint('preview', preview, withFactorRules({ preview })),
    ),
  };
  return {
    conditions: {
      seed: deadlineChoiceResources.seed,
      pressures: [...FACTOR_PRESSURES],
      resources: deadlineChoiceResources,
      decision: {
        deadline: 'campaign を終えてから steady',
        other: 'steady を終えてから campaign',
        score: 'shippedValue - nextPeriodStaminaCost * staminaSpent',
        tieBreak: 'less staminaSpent',
      },
      baseline: cloneFactorRules(baselineDeadlineFactorRules),
      otherWork: deadlineChoiceResources.otherWork,
      held: {
        overdueVersusOther: '別案件の試作価値だけを動かす。工数4、翌期費用0、予告は正しい文',
        nextPeriodStaminaCost:
          '消費体力1あたりの翌期費用だけを動かす。入力は変えない。別案件価値5、予告は正しい文',
        preview: '予告文だけを動かす。別案件価値5、翌期費用0。画面には出さない',
      },
      boostCostsUnchanged: {
        focus: deadlineChoiceResources.boostFocus,
        stamina: deadlineChoiceResources.boostStamina,
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      productionScreen: false,
      nextUncertainty:
        '4工数では翌期費用が体力1あたり2まで期限案件優先が上で3から別案件優先に反転し、6工数では別案件価値が期限後の5を超えると別案件優先に反転するが、この二つを同時にずらしたときどちらが残るか、予告文を人が読んで選べるかは未検証。',
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}
