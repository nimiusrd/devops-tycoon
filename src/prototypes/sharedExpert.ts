/** RI-218: 専門家1人の支援枠。配置先のチームは RI-216 の3チームを使う。 */

import { type TeamId } from './teamDependencies';

export type ExpertBoard = 'due' | 'exposure';
export type ExpertStrategy = 'deadline' | 'impact';
export type ExpertKind = 'deadline' | 'risk' | 'design';

export interface ExpertRequest {
  id: string;
  team: TeamId;
  kind: ExpertKind;
  slots: number;
  progress: number;
  value: number;
  deadline: number;
  openRisk: number;
  doneTick: number | null;
}

export type ExpertInput =
  { type: 'assign'; id: string } | { type: 'wait' } | { type: 'view'; id: string };

export interface ExpertState {
  version: 1;
  seed: string;
  board: ExpertBoard;
  tick: number;
  horizon: number;
  slots: 1;
  expert: TeamId | null;
  requests: ExpertRequest[];
  delivered: { id: string; tick: number; value: number }[];
  viewed: string[];
  inputs: ExpertInput[];
}

function request(
  id: string,
  team: TeamId,
  kind: ExpertKind,
  value: number,
  deadline: number,
  openRisk: number,
): ExpertRequest {
  return { id, team, kind, slots: 2, progress: 0, value, deadline, openRisk, doneTick: null };
}

function createRequests(board: ExpertBoard): ExpertRequest[] {
  if (board === 'due') {
    return [
      request('ship', 'product', 'deadline', 9, 2, 2),
      request('risk', 'incident', 'risk', 4, 6, 3),
      request('design', 'platform', 'design', 2, 6, 5),
    ];
  }
  return [
    request('ship', 'product', 'deadline', 8, 1, 1),
    request('risk', 'incident', 'risk', 6, 2, 14),
    request('design', 'platform', 'design', 2, 6, 4),
  ];
}

export function createSharedExpert(seed: string, board: ExpertBoard): ExpertState {
  const requests = createRequests(board);
  const teams = new Set(requests.map((item) => item.team));
  if (teams.size !== requests.length) throw new Error('同じ専門家を複数チームへ同時配置できない');
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 4,
    slots: 1,
    expert: null,
    requests,
    delivered: [],
    viewed: [],
    inputs: [],
  };
}

function pendingRisk(state: ExpertState): number {
  return state.requests
    .filter((item) => item.doneTick === null)
    .reduce((sum, item) => sum + item.openRisk, 0);
}

/** 1期間の枠を超える依頼は受け付けない。専門家の所在は常に1チーム。 */
export function assignMany(state: ExpertState, ids: readonly string[]): ExpertState {
  if (state.tick >= state.horizon || ids.length === 0 || ids.length > state.slots) return state;
  if (new Set(ids).size !== ids.length) return state;
  if (ids.some((id) => !state.requests.some((item) => item.id === id && item.doneTick === null))) {
    return state;
  }
  const next = structuredClone(state);
  for (const id of ids) {
    const item = next.requests.find((candidate) => candidate.id === id);
    if (!item) return state;
    item.progress += 1;
    next.expert = item.team;
    if (item.progress < item.slots) continue;
    item.doneTick = next.tick;
    next.delivered.push({
      id,
      tick: next.tick,
      value: next.tick <= item.deadline ? item.value : 0,
    });
  }
  next.tick += 1;
  ids.forEach((id) => next.inputs.push({ type: 'assign', id }));
  return next;
}

export function applySharedExpert(state: ExpertState, input: ExpertInput): ExpertState {
  if (input.type === 'view') {
    if (state.viewed.includes(input.id)) return state;
    if (!state.requests.some((item) => item.id === input.id)) return state;
    const next = structuredClone(state);
    next.viewed.push(input.id);
    next.inputs.push({ type: 'view', id: input.id });
    return next;
  }
  if (state.tick >= state.horizon) return state;
  if (input.type === 'wait') {
    const next = structuredClone(state);
    next.expert = null;
    next.tick += 1;
    next.inputs.push({ type: 'wait' });
    return next;
  }
  if (input.type !== 'assign') return state;
  return assignMany(state, [input.id]);
}

export function viewSharedExpert(state: ExpertState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    slots: state.slots,
    expert: state.expert,
    requests: state.requests.map((item) => ({
      id: item.id,
      team: item.team,
      kind: item.kind,
      slots: item.slots,
      progress: item.progress,
      deadline: item.deadline,
      status: item.doneTick === null ? 'pending' : 'done',
      openRisk: item.doneTick === null ? item.openRisk : 0,
    })),
  };
}

export function summarizeSharedExpert(state: ExpertState) {
  const value = state.delivered.reduce((sum, item) => sum + item.value, 0);
  const risk = pendingRisk(state);
  return {
    value,
    risk,
    score: value - risk,
    expert: state.expert,
    pending: state.requests.filter((item) => item.doneTick === null).map((item) => item.id),
    delivered: state.delivered.map((item) => ({ ...item })),
    lost: false,
  };
}

export function chooseExpertAction(state: ExpertState, strategy: ExpertStrategy): ExpertInput {
  const open = state.requests.filter((item) => item.doneTick === null);
  if (open.length === 0) return { type: 'wait' };
  const next = [...open].sort((a, b) => {
    if (strategy === 'deadline') {
      return a.deadline - b.deadline || b.value - a.value || a.id.localeCompare(b.id);
    }
    return b.openRisk - a.openRisk || a.deadline - b.deadline || a.id.localeCompare(b.id);
  })[0];
  return { type: 'assign', id: next.id };
}

export function compareSharedExperts(seed = 'RI-218') {
  return (['due', 'exposure'] as const).flatMap((board) =>
    (['deadline', 'impact'] as const).map((strategy) => {
      const initial = createSharedExpert(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const input = chooseExpertAction(state, strategy);
        const next = applySharedExpert(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeSharedExpert(state),
      };
    }),
  );
}
