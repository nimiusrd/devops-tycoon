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
}
export function createStandbyPrototype(seed: string, incidents = false): StandbyState {
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
    incidents: incidents
      ? [2, 6].map((arrivesAt, index) => ({
          id: `incident-${index + 1}`,
          arrivesAt,
          workLeft: 6,
          doneTick: null,
          mobilizationLeft: 2,
          mobilized: false,
        }))
      : [],
    inputs: [],
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
      // 待機なし/疲労枯渇は全体を止め、2tickの招集後に通常担当が復旧する。
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
