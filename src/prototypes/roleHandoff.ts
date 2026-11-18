/** RI-274: 通常保存・UIから隔離した、一端末一所有者の交代制API。 */
import { ACTION_IDS } from '../data/actionIds';
import { getEvent } from '../data/events';
import { getLever } from '../data/levers';
import { canRecruit, RECRUIT_COST } from '../sim/member';
import type { LaneAssignment } from '../sim/member/types';
import { RunEngine } from '../sim/run/engine';
import { canUnlock } from '../sim/run/evolution';
import { RUN_PHASES } from '../sim/run/phases';
import type { RunPhase, RunState } from '../sim/run/types';
import type { ActionId } from '../sim/types';

export const ROLE_HANDOFF_LIMITS = {
  operations: 2048,
  seedCharacters: 80,
  idCharacters: 64,
  stepMs: 5000,
  jsonCharacters: 2_000_000,
  depth: 48,
  nodes: 250_000,
  arrayItems: 5000,
  stringCharacters: 16_000,
} as const;

/** 拡張チームや士気の即時敗北を伴わない、固定ケース用の3施策だけを公開する。 */
export const HANDOFF_LEVERS = ['standardize', 'prSizeLimit', 'teamAiThrottle'] as const;
export type HandoffLever = (typeof HANDOFF_LEVERS)[number];
export type HandoffRole = 'investment' | 'field';
export type HandoffAction =
  | { kind: 'handoff' }
  | { kind: 'assign'; memberId: string; lane: LaneAssignment }
  | { kind: 'ai'; memberId: string; on: boolean }
  | { kind: 'reserve' | 'lever'; leverId: HandoffLever }
  | { kind: 'cancelReservation' }
  | { kind: 'play' | 'exchange'; deckIndex: number }
  | { kind: 'intervene'; id: ActionId }
  | { kind: 'step'; ms: number }
  | { kind: 'ackResult' }
  | { kind: 'draft'; cardId: string | null }
  | { kind: 'evolve'; nodeId: string }
  | { kind: 'finishEvolution' }
  | { kind: 'beat'; choice: number }
  | { kind: 'leaveShop' }
  | { kind: 'rest'; option: 'heal' | 'repay' }
  | { kind: 'recruit'; option: 'hire' | 'skip' }
  | { kind: 'quarterReview'; adjustment: string | null };

export interface HandoffRequest {
  requestId: string;
  revision: number;
  role: HandoffRole;
  phase: RunPhase;
  action: HandoffAction;
}

export interface HandoffResources {
  budget: number;
  reservedBudget: number;
  availableBudget: number;
  focus: number | null;
  seniorHp: number;
  morale: number;
  techDebt: number;
  aiDependency: number;
}

export interface HandoffReceipt {
  request: HandoffRequest;
  before: { role: HandoffRole; phase: RunPhase; resources: HandoffResources };
  after: { role: HandoffRole; phase: RunPhase; resources: HandoffResources };
  /** setup引渡しで実際に支払い・適用した予約。インフラ料金とは区別する。 */
  activatedReservation: HandoffLever | null;
}

export interface HandoffView {
  revision: number;
  role: HandoffRole;
  state: RunState;
  allowed: HandoffAction['kind'][];
  resources: HandoffResources;
  reservation: { leverId: HandoffLever; cost: number; activatesAt: 'setup-handoff' } | null;
  /** 既存ルール: 休息/イベントの予約係数は次の開始時、獲得カードは現場での発動時。 */
  nextSprintModifiers: RunState['pendingSprintModifiers'];
}

export interface RoleHandoff {
  view(): HandoffView;
  dispatch(request: unknown): { ok: true; receipt: HandoffReceipt } | { ok: false; reason: string };
  history(): HandoffReceipt[];
  save(): string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function id(value: unknown, max: number = ROLE_HANDOFF_LIMITS.idCharacters): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validAction(value: unknown): value is HandoffAction {
  if (!object(value)) return false;
  const exact = (...names: string[]) => keys(value, ['kind', ...names]);
  switch (value.kind) {
    case 'handoff':
    case 'cancelReservation':
    case 'ackResult':
    case 'finishEvolution':
    case 'leaveShop':
      return exact();
    case 'assign':
      return (
        exact('memberId', 'lane') &&
        id(value.memberId) &&
        typeof value.lane === 'string' &&
        ['coding', 'review', 'bench'].includes(value.lane)
      );
    case 'ai':
      return exact('memberId', 'on') && id(value.memberId) && typeof value.on === 'boolean';
    case 'reserve':
    case 'lever':
      return exact('leverId') && HANDOFF_LEVERS.some((known) => known === value.leverId);
    case 'play':
    case 'exchange':
      return exact('deckIndex') && integer(value.deckIndex, 0, 5000);
    case 'intervene':
      return exact('id') && ACTION_IDS.some((known) => known === value.id);
    case 'step':
      return exact('ms') && integer(value.ms, 1, ROLE_HANDOFF_LIMITS.stepMs);
    case 'draft':
      return exact('cardId') && (value.cardId === null || id(value.cardId));
    case 'evolve':
      return exact('nodeId') && id(value.nodeId);
    case 'beat':
      return exact('choice') && integer(value.choice, 0, 32);
    case 'rest':
      return exact('option') && (value.option === 'heal' || value.option === 'repay');
    case 'recruit':
      return exact('option') && (value.option === 'hire' || value.option === 'skip');
    case 'quarterReview':
      return exact('adjustment') && (value.adjustment === null || id(value.adjustment));
    default:
      return false;
  }
}

function validRequest(value: unknown): value is HandoffRequest {
  return (
    object(value) &&
    keys(value, ['requestId', 'revision', 'role', 'phase', 'action']) &&
    id(value.requestId) &&
    integer(value.revision) &&
    (value.role === 'investment' || value.role === 'field') &&
    RUN_PHASES.some((phase) => phase === value.phase) &&
    validAction(value.action)
  );
}

function allowed(state: RunState, role: HandoffRole): HandoffAction['kind'][] {
  if (state.status !== 'playing') return [];
  if (role === 'field')
    return state.phase === 'result'
      ? ['handoff']
      : state.phase === 'sprint'
        ? ['play', 'exchange', 'intervene', 'step']
        : [];
  switch (state.phase) {
    case 'setup':
      return ['assign', 'ai', 'lever', 'reserve', 'cancelReservation', 'handoff'];
    case 'result':
      return ['ackResult'];
    case 'draft':
      return ['draft'];
    case 'evolution':
      return ['evolve', 'finishEvolution'];
    case 'beat':
      return ['beat'];
    case 'shop':
      return ['leaveShop'];
    case 'rest':
      return ['rest'];
    case 'recruit':
      return ['recruit'];
    case 'quarterReview':
      return ['quarterReview'];
    default:
      return [];
  }
}

/** engineはクロージャ内の一つだけ。snapshot/履歴も複製し、可変参照は渡さない。 */
export function createRoleHandoff(seed: string): RoleHandoff {
  if (!id(seed, ROLE_HANDOFF_LIMITS.seedCharacters)) throw new Error('invalid seed');
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  let role: HandoffRole = 'investment';
  let reservation: HandoffLever | null = null;
  const receipts: HandoffReceipt[] = [];
  const requestIds = new Set<string>();
  const cost = (lever: HandoffLever | null) => (lever ? getLever(lever)!.cost : 0);
  const resources = (state: RunState): HandoffResources => ({
    budget: state.budget,
    reservedBudget: cost(reservation),
    availableBudget: state.budget - cost(reservation),
    focus: state.sprint?.focus ?? null,
    seniorHp: state.org.seniorHp,
    morale: state.org.morale,
    techDebt: state.org.techDebt,
    aiDependency: state.org.aiDependency,
  });
  const applyLever = (lever: HandoffLever, state: RunState) => {
    const scope = getLever(lever)!.scope;
    return engine.applyOrgLever(
      lever,
      scope === 'department'
        ? state.teams.find((team) => team.id === state.activeTeamId)!.deptId
        : undefined,
      scope === 'team' ? state.activeTeamId : undefined,
    );
  };
  const view = (): HandoffView => {
    const state = engine.snapshot();
    return structuredClone({
      revision: receipts.length,
      role,
      state,
      allowed: allowed(state, role),
      resources: resources(state),
      reservation: reservation
        ? { leverId: reservation, cost: cost(reservation), activatesAt: 'setup-handoff' as const }
        : null,
      nextSprintModifiers: state.pendingSprintModifiers,
    });
  };
  const dispatch: RoleHandoff['dispatch'] = (input) => {
    const fail = (reason: string) => ({ ok: false as const, reason });
    if (!validRequest(input)) return fail('invalid-input');
    const request = structuredClone(input);
    const state = engine.snapshot();
    if (state.status !== 'playing') return fail('complete');
    if (requestIds.has(request.requestId)) return fail('duplicate-request');
    if (request.revision !== receipts.length) return fail('stale-revision');
    if (request.role !== role || request.phase !== state.phase) return fail('wrong-owner-or-phase');
    if (!allowed(state, role).includes(request.action.kind)) return fail('forbidden-action');
    if (receipts.length >= ROLE_HANDOFF_LIMITS.operations) return fail('operation-limit');
    const before = { role, phase: state.phase, resources: resources(state) };
    const action = request.action;
    let activatedReservation: HandoffLever | null = null;
    switch (action.kind) {
      case 'assign':
      case 'ai': {
        const member = state.roster.members.find((member) => member.id === action.memberId);
        if (!member || member.onLeave) return fail('invalid-member');
        if (action.kind === 'assign') {
          if (member.assignment === action.lane) return fail('no-change');
          engine.assignMember(action.memberId, action.lane);
        } else {
          if (action.on && member.assignment !== 'coding') return fail('invalid-ai-assignment');
          if (member.aiAssigned === action.on) return fail('no-change');
          engine.setMemberAi(action.memberId, action.on);
        }
        break;
      }
      case 'reserve':
        if (reservation) return fail('reservation-exists');
        if (state.budget <= cost(action.leverId)) return fail('insufficient-budget');
        reservation = action.leverId;
        break;
      case 'cancelReservation':
        if (!reservation) return fail('no-reservation');
        reservation = null;
        break;
      case 'lever':
        if (state.budget - cost(reservation) <= cost(action.leverId))
          return fail('insufficient-budget');
        if (!applyLever(action.leverId, state)) return fail('lever-rejected');
        break;
      case 'handoff':
        if (role === 'investment') {
          // 予約はsetupだけ。残予算を拘束し、引渡し直前に一度だけ実engineへ適用する。
          if (reservation) {
            if (!applyLever(reservation, state)) return fail('lever-rejected');
            activatedReservation = reservation;
            reservation = null;
          }
          engine.beginSetupSprint();
          role = 'field';
        } else role = 'investment';
        break;
      case 'play':
      case 'exchange': {
        const outcome =
          action.kind === 'play'
            ? engine.playCard(action.deckIndex)
            : engine.exchangeCard(action.deckIndex);
        if (!outcome.ok) return fail(outcome.reason ?? 'engine-rejected');
        break;
      }
      case 'intervene': {
        const outcome = engine.dispatch(action.id);
        if (!outcome.ok) return fail(outcome.reason ?? 'engine-rejected');
        break;
      }
      case 'step':
        engine.step(action.ms);
        break;
      case 'ackResult':
        engine.acknowledgeResult();
        break;
      case 'draft':
        if (action.cardId === null) engine.skipDraft();
        else {
          if (!state.draft?.includes(action.cardId)) return fail('invalid-card');
          engine.chooseCard(action.cardId);
        }
        break;
      case 'evolve':
        if (!canUnlock(state.evolution, action.nodeId)) return fail('invalid-evolution');
        engine.unlockEvolution(action.nodeId);
        break;
      case 'finishEvolution':
        engine.finishEvolution();
        break;
      case 'beat': {
        const choices = state.beat ? getEvent(state.beat.eventId)?.choices : null;
        if (!choices?.[action.choice] || (state.beat?.kind === 'judgment' && action.choice !== 0))
          return fail('invalid-choice');
        engine.resolveBeat(action.choice);
        break;
      }
      case 'leaveShop':
        engine.leaveShop();
        break;
      case 'rest':
        engine.restChoose(action.option);
        break;
      case 'recruit':
        if (action.option === 'hire' && (!canRecruit(state.roster) || state.budget < RECRUIT_COST))
          return fail('recruit-unavailable');
        engine.recruitChoose(action.option);
        break;
      case 'quarterReview': {
        const review = state.quarterReview;
        if (!review) return fail('invalid-review');
        if (review.outcome === 'missed_adjustable') {
          const adjustment = review.availableAdjustments.find(
            (known) => known === action.adjustment,
          );
          if (!adjustment) return fail('invalid-adjustment');
          engine.chooseGoalAdjustment(adjustment);
        } else {
          if (action.adjustment !== null) return fail('invalid-adjustment');
          engine.acknowledgeQuarterReview();
        }
        break;
      }
    }
    const after = engine.snapshot();
    const receipt: HandoffReceipt = {
      request,
      before,
      after: { role, phase: after.phase, resources: resources(after) },
      activatedReservation,
    };
    receipts.push(receipt);
    requestIds.add(request.requestId);
    return { ok: true, receipt: structuredClone(receipt) };
  };
  return {
    view,
    dispatch,
    history: () => structuredClone(receipts),
    save: () =>
      JSON.stringify({
        version: 1,
        seed,
        inputs: receipts.map(({ request }) => request),
        checkpoint: {
          role,
          reservation,
          frame: engine.exportCounterfactualFrame() ?? engine.exportReplayFrame(),
        },
      }),
  };
}

function bounded(
  value: unknown,
  depth = 0,
  budget = { left: ROLE_HANDOFF_LIMITS.nodes as number },
): boolean {
  if (depth > ROLE_HANDOFF_LIMITS.depth || --budget.left < 0) return false;
  if (typeof value === 'string') return value.length <= ROLE_HANDOFF_LIMITS.stringCharacters;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= ROLE_HANDOFF_LIMITS.arrayItems &&
      value.every((item) => bounded(item, depth + 1, budget))
    );
  if (object(value))
    return Object.entries(value).every(
      ([key, item]) => bounded(key, depth + 1, budget) && bounded(item, depth + 1, budget),
    );
  return true;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** 入力列から一つのengineを再構築し、RNG位置を含むcheckpointとの完全一致を検査する。
 * 任意frameをhydrateしない。通常保存・報酬・履歴・複数タブ所有権は一切呼び出さない。
 */
export function resumeRoleHandoff(
  json: unknown,
): { ok: true; session: RoleHandoff } | { ok: false } {
  if (typeof json !== 'string' || json.length > ROLE_HANDOFF_LIMITS.jsonCharacters)
    return { ok: false };
  try {
    const raw: unknown = JSON.parse(json);
    if (
      !bounded(raw) ||
      !object(raw) ||
      !keys(raw, ['version', 'seed', 'inputs', 'checkpoint']) ||
      raw.version !== 1 ||
      !id(raw.seed, ROLE_HANDOFF_LIMITS.seedCharacters) ||
      !Array.isArray(raw.inputs) ||
      raw.inputs.length > ROLE_HANDOFF_LIMITS.operations
    )
      return { ok: false };
    const session = createRoleHandoff(raw.seed);
    for (const request of raw.inputs) if (!session.dispatch(request).ok) return { ok: false };
    if (canonical(JSON.parse(session.save())) !== canonical(raw)) return { ok: false };
    return { ok: true, session };
  } catch {
    return { ok: false };
  }
}
