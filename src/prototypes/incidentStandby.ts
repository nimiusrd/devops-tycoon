/** RI-170: 待機1枠。現行coding/review/benchとは別の固定編成試作。 */
export type StandbyLane = 'coding' | 'review' | 'bench' | 'standby';
export interface StandbyMember {
  id: string;
  lane: StandbyLane;
  home: 'coding' | 'review';
  coding: number;
  review: number;
  response: number;
  stamina: number;
  staminaMax: number;
  responseSpent: number;
}
export interface StandbyIncident {
  id: string;
  arrivesAt: number;
  workLeft: number;
  doneTick: number | null;
  mobilizationLeft: number;
  mobilized: boolean;
}
export type StandbyInput = { type: 'assign'; id: string; lane: StandbyLane } | { type: 'tick' };
/** 比較で一つずつ足す規則。状態に無いときは初回と同じ（通常作業で体力を使わない）。 */
export interface StandbyRules {
  /** 出荷できたtickに、coding/reviewの各人から引く体力。 */
  normalStaminaCost: number;
}
export interface StandbySetup {
  /** 待機がいないときの招集tick。既定2。 */
  mobilizationTicks?: number;
  /** 2件目の到着tick。既定6。1件目は2のまま。 */
  secondArrivesAt?: number;
  normalStaminaCost?: number;
}
/** 完了したtick数が at のとき、次のtickの前に配置する。0は最初のtickの前。 */
export interface StandbyAssignment {
  at: number;
  id: string;
  lane: StandbyLane;
}
export interface StandbyState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  value: number;
  customerLoss: number;
  stoppedTicks: number;
  responseWork: number;
  members: StandbyMember[];
  incidents: StandbyIncident[];
  inputs: StandbyInput[];
  /** 無いときは通常作業で体力を消費しない。初回の比較JSONはこのフィールドを持たない。 */
  rules?: StandbyRules;
}
export function createStandbyPrototype(
  seed: string,
  incidents = false,
  setup?: StandbySetup,
): StandbyState {
  const mobilizationTicks = setup?.mobilizationTicks ?? 2;
  const arrivals = incidents ? [2, setup?.secondArrivesAt ?? 6] : [];
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 10,
    focus: 6,
    focusSpent: 0,
    value: 0,
    customerLoss: 0,
    stoppedTicks: 0,
    responseWork: 0,
    members: [
      {
        id: 'coder',
        lane: 'coding',
        home: 'coding',
        coding: 2,
        review: 1,
        response: 2,
        stamina: 12,
        staminaMax: 12,
        responseSpent: 0,
      },
      {
        id: 'ace',
        lane: 'coding',
        home: 'coding',
        coding: 3,
        review: 3,
        response: 4,
        stamina: 8,
        staminaMax: 8,
        responseSpent: 0,
      },
      {
        id: 'reviewer',
        lane: 'review',
        home: 'review',
        coding: 1,
        review: 5,
        response: 1,
        stamina: 12,
        staminaMax: 12,
        responseSpent: 0,
      },
    ],
    incidents: arrivals.map((arrivesAt, index) => ({
      id: `incident-${index + 1}`,
      arrivesAt,
      workLeft: 6,
      doneTick: null,
      mobilizationLeft: mobilizationTicks,
      mobilized: false,
    })),
    inputs: [],
    ...(setup?.normalStaminaCost ? { rules: { normalStaminaCost: setup.normalStaminaCost } } : {}),
  };
}
export function standbyCapacity(state: StandbyState) {
  const available = state.members.filter((m) => m.stamina > 0);
  return {
    coding: available.filter((m) => m.lane === 'coding').reduce((n, m) => n + m.coding, 0),
    review: available.filter((m) => m.lane === 'review').reduce((n, m) => n + m.review, 0),
    standby: available
      .filter((m) => m.lane === 'standby')
      .reduce((n, m) => n + Math.min(m.response, m.stamina), 0),
  };
}
export function applyStandbyInput(state: StandbyState, input: StandbyInput): StandbyState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'assign') {
    const member = state.members.find((m) => m.id === input.id);
    if (!member || member.lane === input.lane || state.focus < 1) return state;
    const next = structuredClone(state);
    if (input.lane === 'standby') {
      // 交代は1操作。前任を元の工程へ戻し、待機を複数枠に増やさない。
      const previous = next.members.find((m) => m.lane === 'standby');
      if (previous) previous.lane = previous.home;
    }
    next.members.find((m) => m.id === input.id)!.lane = input.lane;
    next.focus--;
    next.focusSpent++;
    next.inputs.push(structuredClone(input));
    return next;
  }
  const next = structuredClone(state);
  next.tick++;
  const active = next.incidents.filter((i) => i.arrivesAt <= next.tick && i.doneTick === null);
  next.customerLoss += active.length; // 完了tickまで顧客損失1/件/tick。
  const incident = active[0];
  const standby = next.members.find((m) => m.lane === 'standby' && m.stamina > 0);
  let stopped = false;
  if (incident) {
    let responders: StandbyMember[] = [];
    if (standby) responders = [standby];
    else {
      // 待機なし/疲労枯渇は全体を止め、招集の残時間が終わってから通常担当が復旧する。
      stopped = true;
      if (!incident.mobilized) {
        incident.mobilized = true;
      }
      if (incident.mobilizationLeft > 0) incident.mobilizationLeft--;
      else responders = next.members.filter((m) => m.lane === 'coding' || m.lane === 'review');
    }
    for (const member of responders) {
      const work = Math.min(member.response, member.stamina, incident.workLeft);
      incident.workLeft -= work;
      member.stamina -= work;
      member.responseSpent += work;
      next.responseWork += work;
    }
    if (incident.workLeft === 0) incident.doneTick = next.tick;
  }
  if (stopped) next.stoppedTicks++;
  else {
    const capacity = standbyCapacity(next);
    // 毎tickの独立した小仕事。工程バッファ・個別タスクは本試作ではモデル化しない。
    next.value += Math.min(capacity.coding, capacity.review);
    // 通常消費は出荷できたtickだけ。停止中と待機・benchは対象外。未指定は0。
    const normalStaminaCost = next.rules?.normalStaminaCost ?? 0;
    if (normalStaminaCost > 0) {
      for (const member of next.members) {
        if (member.lane === 'coding' || member.lane === 'review')
          member.stamina = Math.max(0, member.stamina - normalStaminaCost);
      }
    }
  }
  // benchは応答せず2/tick回復する。待機は通常工程に寄与せず、暇でも疲労を回復しない。
  for (const member of next.members)
    if (member.lane === 'bench') member.stamina = Math.min(member.staminaMax, member.stamina + 2);
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeStandby(state: StandbyState) {
  const unfinished = state.incidents.filter(
    (i) => i.doneTick === null && i.arrivesAt <= state.tick,
  );
  const remainingWork = unfinished.reduce((n, i) => n + i.workLeft, 0);
  return {
    value: state.value,
    customerLoss: state.customerLoss,
    focusSpent: state.focusSpent,
    stoppedTicks: state.stoppedTicks,
    responseWork: state.responseWork,
    remainingWork,
    resolved: state.incidents
      .filter((i) => i.doneTick !== null)
      .map((i) => ({ id: i.id, tick: i.doneTick })),
    members: state.members.map((m) => ({
      id: m.id,
      lane: m.lane,
      stamina: m.stamina,
      responseSpent: m.responseSpent,
    })),
    netValue: state.value - state.customerLoss - state.focusSpent - remainingWork,
  };
}
export function runStandbyPlan(
  initial: StandbyState,
  plan: readonly StandbyAssignment[],
): StandbyState {
  const steps = plan.map((step, order) => ({ ...step, order }));
  steps.sort((a, b) => a.at - b.at || a.order - b.order);
  let state = initial;
  let index = 0;
  const applyDue = () => {
    while (index < steps.length && steps[index]!.at === state.tick) {
      const step = steps[index]!;
      state = applyStandbyInput(state, { type: 'assign', id: step.id, lane: step.lane });
      index++;
    }
  };
  applyDue();
  while (state.tick < state.horizon) {
    state = applyStandbyInput(state, { type: 'tick' });
    applyDue();
  }
  return state;
}
export function compareStandbyStrategies(seed: string) {
  return [false, true].flatMap((incidents) =>
    (['none', 'coder', 'ace', 'rotate'] as const).map((strategy) => {
      const initial = createStandbyPrototype(seed, incidents);
      let state =
        strategy === 'none'
          ? initial
          : applyStandbyInput(initial, {
              type: 'assign',
              id: strategy === 'coder' ? 'coder' : 'ace',
              lane: 'standby',
            });
      while (state.tick < state.horizon) {
        if (strategy === 'rotate' && state.tick === 3)
          state = applyStandbyInput(state, { type: 'assign', id: 'coder', lane: 'standby' });
        state = applyStandbyInput(state, { type: 'tick' });
      }
      return {
        incidents,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeStandby(state),
      };
    }),
  );
}
function coderAt(at: number): StandbyAssignment {
  return { at, id: 'coder', lane: 'standby' };
}
function rotateAt(at: number): StandbyAssignment[] {
  return [{ at: 0, id: 'ace', lane: 'standby' }, coderAt(at)];
}
function aceRest(length: number, withCoder: boolean): StandbyAssignment[] {
  return [
    { at: 0, id: 'ace', lane: 'bench' },
    ...(withCoder ? [coderAt(0)] : []),
    { at: length, id: 'ace', lane: 'coding' },
  ];
}
const factorCases: ReadonlyArray<{
  factor: string;
  strategy: 'none' | 'coder' | 'reviewer' | 'rotate';
  setup?: StandbySetup;
  plan: readonly StandbyAssignment[];
}> = [
  { factor: 'baseline', strategy: 'none', plan: [] },
  { factor: 'baseline', strategy: 'coder', plan: [coderAt(0)] },
  { factor: 'forecast-1', strategy: 'none', plan: [] },
  { factor: 'forecast-1', strategy: 'coder', plan: [coderAt(1)] },
  { factor: 'forecast-0', strategy: 'none', plan: [] },
  { factor: 'forecast-0', strategy: 'coder', plan: [coderAt(2)] },
  { factor: 'mobilization-1', strategy: 'none', setup: { mobilizationTicks: 1 }, plan: [] },
  {
    factor: 'mobilization-1',
    strategy: 'coder',
    setup: { mobilizationTicks: 1 },
    plan: [coderAt(0)],
  },
  { factor: 'mobilization-0', strategy: 'none', setup: { mobilizationTicks: 0 }, plan: [] },
  {
    factor: 'mobilization-0',
    strategy: 'coder',
    setup: { mobilizationTicks: 0 },
    plan: [coderAt(0)],
  },
  { factor: 'normal-stamina-1', strategy: 'none', setup: { normalStaminaCost: 1 }, plan: [] },
  {
    factor: 'normal-stamina-1',
    strategy: 'coder',
    setup: { normalStaminaCost: 1 },
    plan: [coderAt(0)],
  },
  { factor: 'normal-stamina-2', strategy: 'none', setup: { normalStaminaCost: 2 }, plan: [] },
  {
    factor: 'normal-stamina-2',
    strategy: 'coder',
    setup: { normalStaminaCost: 2 },
    plan: [coderAt(0)],
  },
  { factor: 'normal-stamina-3', strategy: 'none', setup: { normalStaminaCost: 3 }, plan: [] },
  {
    factor: 'normal-stamina-3',
    strategy: 'coder',
    setup: { normalStaminaCost: 3 },
    plan: [coderAt(0)],
  },
  { factor: 'normal-stamina-4', strategy: 'none', setup: { normalStaminaCost: 4 }, plan: [] },
  {
    factor: 'normal-stamina-4',
    strategy: 'coder',
    setup: { normalStaminaCost: 4 },
    plan: [coderAt(0)],
  },
  { factor: 'reviewer', strategy: 'none', plan: [] },
  { factor: 'reviewer', strategy: 'reviewer', plan: [{ at: 0, id: 'reviewer', lane: 'standby' }] },
  { factor: 'rotate-4', strategy: 'none', plan: [] },
  { factor: 'rotate-4', strategy: 'rotate', plan: rotateAt(4) },
  { factor: 'rotate-5', strategy: 'none', plan: [] },
  { factor: 'rotate-5', strategy: 'rotate', plan: rotateAt(5) },
  { factor: 'rotate-6', strategy: 'none', plan: [] },
  { factor: 'rotate-6', strategy: 'rotate', plan: rotateAt(6) },
  { factor: 'rest-1', strategy: 'none', plan: aceRest(1, false) },
  { factor: 'rest-1', strategy: 'coder', plan: aceRest(1, true) },
  { factor: 'rest-6', strategy: 'none', plan: aceRest(6, false) },
  { factor: 'rest-6', strategy: 'coder', plan: aceRest(6, true) },
  { factor: 'rest-7', strategy: 'none', plan: aceRest(7, false) },
  { factor: 'rest-7', strategy: 'coder', plan: aceRest(7, true) },
  { factor: 'rest-8', strategy: 'none', plan: aceRest(8, false) },
  { factor: 'rest-8', strategy: 'coder', plan: aceRest(8, true) },
  { factor: 'rest-9', strategy: 'none', plan: aceRest(9, false) },
  { factor: 'rest-9', strategy: 'coder', plan: aceRest(9, true) },
  { factor: 'overlap-5', strategy: 'none', setup: { secondArrivesAt: 5 }, plan: [] },
  { factor: 'overlap-5', strategy: 'coder', setup: { secondArrivesAt: 5 }, plan: [coderAt(0)] },
  { factor: 'overlap-4', strategy: 'none', setup: { secondArrivesAt: 4 }, plan: [] },
  { factor: 'overlap-4', strategy: 'coder', setup: { secondArrivesAt: 4 }, plan: [coderAt(0)] },
  { factor: 'overlap-2', strategy: 'none', setup: { secondArrivesAt: 2 }, plan: [] },
  { factor: 'overlap-2', strategy: 'coder', setup: { secondArrivesAt: 2 }, plan: [coderAt(0)] },
];
/** 初回の反復障害だけ。要因は一つずつ。平穏時は再比較しない。 */
export function compareStandbyFactorReversals(seed: string) {
  return factorCases.map(({ factor, strategy, setup, plan }) => {
    const initial = createStandbyPrototype(seed, true, setup);
    const state = runStandbyPlan(initial, plan);
    return { factor, strategy, initial, inputs: state.inputs, result: summarizeStandby(state) };
  });
}
