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
  /** 依存が未完了の間は進捗しない。初回の3件には付けない。 */
  requires?: string[];
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

/** 前提の完了と同じ期間には解放しない。次の期間からだけ進む。 */
function dependencyBlocks(state: ExpertState, item: ExpertRequest): boolean {
  return (item.requires ?? []).some((id) => {
    const dependency = state.requests.find((candidate) => candidate.id === id);
    return !dependency || dependency.doneTick === null || dependency.doneTick >= state.tick;
  });
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
    if (!dependencyBlocks(next, item)) item.progress += 1;
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
      blocked: dependencyBlocks(state, item),
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

/** 初回と同じ資源。感度では必要枠・期限・未解決リスクの一つだけを変える。 */
export interface ExpertFactorRules {
  slots: number;
  deadlineShift: number;
  riskScale: number;
  blocked: boolean;
}
export const baselineExpertRules: ExpertFactorRules = {
  slots: 2,
  deadlineShift: 0,
  riskScale: 1,
  blocked: false,
};
/** 依存で止まる依頼。期限と未解決リスクはシフト・倍率の対象外。必要枠だけ他と揃える。 */
export const BLOCKED_REQUEST = { id: 'blocked', deadline: 2, openRisk: 6, value: 1 } as const;
const FACTOR_BOARDS = ['due', 'exposure'] as const;
const ALLOCATE_STRATEGIES = ['deadline', 'impact'] as const;
const SLOT_VALUES = [1, 2, 3, 4, 5] as const;
const DEADLINE_SHIFTS = [-1, 0, 1, 2] as const;
const RISK_SCALES = [0, 1, 2] as const;
type AllocateStrategy = (typeof ALLOCATE_STRATEGIES)[number];
type FactorAxis = 'slots' | 'deadlineShift' | 'riskScale';
export type ExpertPreference = 'allocate' | 'proceed' | 'tie';
interface FactorRun {
  inputs: ExpertInput[];
  result: ReturnType<typeof summarizeSharedExpert>;
}
interface FactorAllocation extends FactorRun {
  strategy: AllocateStrategy;
  preference: ExpertPreference;
  margin: number;
}
interface FactorRow {
  board: ExpertBoard;
  blocked: boolean;
  proceed: FactorRun;
  allocations: FactorAllocation[];
}
interface FactorPoint {
  axis: FactorAxis;
  parameter: string;
  rules: ExpertFactorRules;
  rows: FactorRow[];
}
export interface ExpertFactorReversal {
  axis: FactorAxis;
  board: ExpertBoard;
  blocked: boolean;
  strategy: AllocateStrategy;
  before: { parameter: string; preference: ExpertPreference; allocate: number; proceed: number };
  after: { parameter: string; preference: ExpertPreference; allocate: number; proceed: number };
}
export interface ExpertBlockedOnlyReversal {
  axis: FactorAxis;
  board: ExpertBoard;
  strategy: AllocateStrategy;
  before: {
    parameter: string;
    plain: ExpertPreference;
    blocked: ExpertPreference;
    blockedAllocate: number;
    blockedProceed: number;
  };
  after: {
    parameter: string;
    plain: ExpertPreference;
    blocked: ExpertPreference;
    blockedAllocate: number;
    blockedProceed: number;
  };
}
export interface ExpertBlockedDifference {
  axis: FactorAxis;
  parameter: string;
  board: ExpertBoard;
  strategy: AllocateStrategy;
  plain: ExpertPreference;
  blocked: ExpertPreference;
}
function cloneRules(rules: ExpertFactorRules): ExpertFactorRules {
  return { ...rules };
}
function withRules(patch: Partial<ExpertFactorRules>): ExpertFactorRules {
  return { ...baselineExpertRules, ...patch };
}
export function createSharedExpertCase(board: ExpertBoard, rules: ExpertFactorRules): ExpertState {
  const state = structuredClone(createSharedExpert('RI-218', board));
  for (const item of state.requests) {
    item.slots = rules.slots;
    item.deadline += rules.deadlineShift;
    item.openRisk *= rules.riskScale;
  }
  if (!rules.blocked) return state;
  // 設計相談と同じ platform。1期間に割り当てるのは1件なので、専門家の所在は1チームのまま。
  state.requests.push({
    id: BLOCKED_REQUEST.id,
    team: 'platform',
    kind: 'design',
    slots: rules.slots,
    progress: 0,
    value: BLOCKED_REQUEST.value,
    deadline: BLOCKED_REQUEST.deadline,
    openRisk: BLOCKED_REQUEST.openRisk,
    doneTick: null,
    requires: ['design'],
  });
  return state;
}
function preferenceOf(allocate: number, proceed: number): ExpertPreference {
  if (allocate > proceed) return 'allocate';
  if (proceed > allocate) return 'proceed';
  return 'tie';
}
function runExpert(
  board: ExpertBoard,
  rules: ExpertFactorRules,
  strategy: AllocateStrategy | 'proceed',
): FactorRun {
  let state = createSharedExpertCase(board, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(`${board}:${strategy}`);
    const input =
      strategy === 'proceed' ? { type: 'wait' as const } : chooseExpertAction(state, strategy);
    const next = applySharedExpert(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return {
    inputs: state.inputs.map((input) => ({ ...input })),
    result: summarizeSharedExpert(state),
  };
}
function factorPoint(axis: FactorAxis, parameter: string, rules: ExpertFactorRules): FactorPoint {
  const rows = FACTOR_BOARDS.flatMap((board) =>
    [false, true].map((blocked) => {
      const caseRules = { ...rules, blocked };
      const proceed = runExpert(board, caseRules, 'proceed');
      const allocations = ALLOCATE_STRATEGIES.map((strategy) => {
        const run = runExpert(board, caseRules, strategy);
        return {
          strategy,
          inputs: run.inputs,
          result: run.result,
          preference: preferenceOf(run.result.score, proceed.result.score),
          margin: run.result.score - proceed.result.score,
        };
      });
      return { board, blocked, proceed, allocations };
    }),
  );
  return { axis, parameter, rules: cloneRules(rules), rows };
}
function rowOf(point: FactorPoint, board: ExpertBoard, blocked: boolean): FactorRow {
  const row = point.rows.find((item) => item.board === board && item.blocked === blocked);
  if (!row) throw new Error(`${point.axis}:${board}:${blocked}`);
  return row;
}
function allocationOf(row: FactorRow, strategy: AllocateStrategy): FactorAllocation {
  const found = row.allocations.find((item) => item.strategy === strategy);
  if (!found) throw new Error(strategy);
  return found;
}
function reversalsOf(rows: FactorPoint[]): ExpertFactorReversal[] {
  const found: ExpertFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      for (const blocked of [false, true]) {
        for (const strategy of ALLOCATE_STRATEGIES) {
          const early = allocationOf(rowOf(before, board, blocked), strategy);
          const late = allocationOf(rowOf(after, board, blocked), strategy);
          if (early.preference === late.preference) continue;
          found.push({
            axis: before.axis,
            board,
            blocked,
            strategy,
            before: {
              parameter: before.parameter,
              preference: early.preference,
              allocate: early.result.score,
              proceed: rowOf(before, board, blocked).proceed.result.score,
            },
            after: {
              parameter: after.parameter,
              preference: late.preference,
              allocate: late.result.score,
              proceed: rowOf(after, board, blocked).proceed.result.score,
            },
          });
        }
      }
    }
  }
  return found;
}
function blockedOnlyReversalsOf(rows: FactorPoint[]): ExpertBlockedOnlyReversal[] {
  const found: ExpertBlockedOnlyReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      for (const strategy of ALLOCATE_STRATEGIES) {
        const earlyPlain = allocationOf(rowOf(before, board, false), strategy);
        const latePlain = allocationOf(rowOf(after, board, false), strategy);
        const earlyBlocked = allocationOf(rowOf(before, board, true), strategy);
        const lateBlocked = allocationOf(rowOf(after, board, true), strategy);
        if (earlyBlocked.preference === lateBlocked.preference) continue;
        if (earlyPlain.preference !== latePlain.preference) continue;
        found.push({
          axis: before.axis,
          board,
          strategy,
          before: {
            parameter: before.parameter,
            plain: earlyPlain.preference,
            blocked: earlyBlocked.preference,
            blockedAllocate: earlyBlocked.result.score,
            blockedProceed: rowOf(before, board, true).proceed.result.score,
          },
          after: {
            parameter: after.parameter,
            plain: latePlain.preference,
            blocked: lateBlocked.preference,
            blockedAllocate: lateBlocked.result.score,
            blockedProceed: rowOf(after, board, true).proceed.result.score,
          },
        });
      }
    }
  }
  return found;
}
function differsWithBlocked(rows: FactorPoint[]): ExpertBlockedDifference[] {
  return rows.flatMap((point) =>
    FACTOR_BOARDS.flatMap((board) =>
      ALLOCATE_STRATEGIES.flatMap((strategy) => {
        const plain = allocationOf(rowOf(point, board, false), strategy);
        const blocked = allocationOf(rowOf(point, board, true), strategy);
        if (plain.preference === blocked.preference) return [];
        return [
          {
            axis: point.axis,
            parameter: point.parameter,
            board,
            strategy,
            plain: plain.preference,
            blocked: blocked.preference,
          },
        ];
      }),
    ),
  );
}
function allocateNeverBelowProceed(sweeps: Record<FactorAxis, FactorPoint[]>): boolean {
  return Object.values(sweeps).every((points) =>
    points.every((point) =>
      point.rows.every((row) =>
        row.allocations.every((item) => item.result.score >= row.proceed.result.score),
      ),
    ),
  );
}
/** 初回と同じ資源で、必要枠・期限・未解決リスクを一つずつ動かす。固定戦略。 */
export function compareSharedExpertFactorReversals() {
  const sweeps = {
    slots: SLOT_VALUES.map((slots) => factorPoint('slots', String(slots), withRules({ slots }))),
    deadlineShift: DEADLINE_SHIFTS.map((deadlineShift) =>
      factorPoint('deadlineShift', String(deadlineShift), withRules({ deadlineShift })),
    ),
    riskScale: RISK_SCALES.map((riskScale) =>
      factorPoint('riskScale', String(riskScale), withRules({ riskScale })),
    ),
  };
  return {
    conditions: {
      seed: 'RI-218',
      boards: [...FACTOR_BOARDS],
      horizon: 4,
      periodSlots: 1,
      decision: {
        allocate: [...ALLOCATE_STRATEGIES],
        proceed: 'wait',
        score: 'value - pending openRisk',
        preference: '配る差引が大きいとき配る、配らない差引が大きいとき配らない、同じとき同点',
      },
      baseline: cloneRules(baselineExpertRules),
      blockedRequest: {
        id: BLOCKED_REQUEST.id,
        team: 'platform',
        requires: 'design',
        deadline: BLOCKED_REQUEST.deadline,
        openRisk: BLOCKED_REQUEST.openRisk,
        value: BLOCKED_REQUEST.value,
        fixedAgainst: ['deadlineShift', 'riskScale'],
        follows: 'slots',
      },
      held: {
        slots:
          '全依頼の必要枠だけを動かす。期限シフトは0、未解決リスク倍率は1。ブロック依頼の必要枠も同じ値',
        deadlineShift:
          '初回の3件の期限へ足す値だけを動かす。必要枠は2、未解決リスク倍率は1。ブロック依頼の期限2は動かさない',
        riskScale:
          '初回の3件の未解決リスクへ掛ける倍率だけを動かす。必要枠は2、期限シフトは0。ブロック依頼の未解決リスク6は動かさない',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      avoidsBlocked: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
    blockedOnlyReversals: Object.values(sweeps).flatMap((rows) => blockedOnlyReversalsOf(rows)),
    differsWithBlocked: Object.values(sweeps).flatMap((rows) => differsWithBlocked(rows)),
    allocateNeverBelowProceed: allocateNeverBelowProceed(sweeps),
  };
}
