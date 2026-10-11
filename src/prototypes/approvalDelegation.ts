/** RI-225: 低リスクだけを委譲する承認ルール。#538 の期間委任へは未接続。 */

export type ChangeRisk = 'low' | 'important';
export type ApprovalBoard = 'mature' | 'junior' | 'heavy';
export type ApprovalPolicy = 'human' | 'delegate' | 'rush';
export type ApprovalInput =
  { type: 'adopt'; policy: ApprovalPolicy } | { type: 'review' } | { type: 'view' };

export interface ChangeItem {
  id: string;
  risk: ChangeRisk;
  value: number;
  done: boolean;
  reviewed: boolean;
  residual: boolean;
  blocked: boolean;
}

export interface ApprovalState {
  version: 1;
  seed: string;
  board: ApprovalBoard;
  tick: number;
  horizon: number;
  maturity: number;
  maturityLine: number;
  policy: ApprovalPolicy | null;
  index: number;
  items: ChangeItem[];
  value: number;
  reviewCost: number;
  failure: number;
  audit: number;
  breach: number;
  blocked: number;
  inputs: ApprovalInput[];
}

const REVIEW_COST = 2;
const AUDIT_COST = 1;
const BREACH_COST = 2;
const DELEGATE_FAILURE = 1;
const RUSH_FAILURE = 3;
export const MATURITY_LINE = 2;

const ITEMS: Record<
  ApprovalBoard,
  { maturity: number; items: readonly { id: string; risk: ChangeRisk; value: number }[] }
> = {
  mature: {
    maturity: 3,
    items: [
      { id: 'l1', risk: 'low', value: 6 },
      { id: 'l2', risk: 'low', value: 6 },
      { id: 'l3', risk: 'low', value: 6 },
      { id: 'i1', risk: 'important', value: 8 },
    ],
  },
  junior: {
    maturity: 1,
    items: [
      { id: 'l1', risk: 'low', value: 6 },
      { id: 'l2', risk: 'low', value: 6 },
      { id: 'l3', risk: 'low', value: 6 },
      { id: 'i1', risk: 'important', value: 8 },
    ],
  },
  heavy: {
    maturity: 3,
    items: [
      { id: 'i1', risk: 'important', value: 5 },
      { id: 'i2', risk: 'important', value: 5 },
      { id: 'i3', risk: 'important', value: 5 },
      { id: 'i4', risk: 'important', value: 5 },
    ],
  },
};

function freshItems(board: ApprovalBoard): ChangeItem[] {
  return ITEMS[board].items.map((item) => ({
    ...item,
    done: false,
    reviewed: false,
    residual: false,
    blocked: false,
  }));
}

export function createApprovalDelegation(seed: string, board: ApprovalBoard): ApprovalState {
  const preset = ITEMS[board];
  const items = freshItems(board);
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 1 + items.length,
    maturity: preset.maturity,
    maturityLine: MATURITY_LINE,
    policy: null,
    index: 0,
    items,
    value: 0,
    reviewCost: 0,
    failure: 0,
    audit: 0,
    breach: 0,
    blocked: 0,
    inputs: [],
  };
}

export function approvalRoute(
  risk: ChangeRisk,
  policy: ApprovalPolicy,
  maturity: number,
  maturityLine: number,
): 'human' | 'auto' | 'blocked' {
  if (risk === 'important') return policy === 'rush' ? 'blocked' : 'human';
  if (policy === 'human') return 'human';
  if (policy === 'delegate' && maturity < maturityLine) return 'human';
  return 'auto';
}

function isPolicy(value: string): value is ApprovalPolicy {
  return value === 'human' || value === 'delegate' || value === 'rush';
}

export function adoptApproval(state: ApprovalState, policy: string): ApprovalState {
  if (state.policy !== null || !isPolicy(policy)) return state;
  const next = structuredClone(state);
  next.policy = policy;
  if (policy !== 'human') next.audit += AUDIT_COST;
  next.tick += 1;
  next.inputs.push({ type: 'adopt', policy });
  return next;
}

/** 重要変更は自動承認にしない。急ぎ承認はブロックしたうえで人間確認へ戻す。 */
export function reviewNext(state: ApprovalState): ApprovalState {
  const policy = state.policy;
  if (policy === null || state.index >= state.items.length) return state;
  const next = structuredClone(state);
  const item = next.items[next.index];
  if (!item) return state;
  const route = approvalRoute(item.risk, policy, next.maturity, next.maturityLine);
  item.done = true;
  next.value += item.value;
  if (route === 'auto') {
    item.residual = true;
    next.failure += policy === 'rush' ? RUSH_FAILURE : DELEGATE_FAILURE;
  } else {
    item.reviewed = true;
    next.reviewCost += REVIEW_COST;
    if (route === 'blocked') {
      item.blocked = true;
      next.blocked += 1;
      next.breach += BREACH_COST;
    }
  }
  next.index += 1;
  next.tick += 1;
  next.inputs.push({ type: 'review' });
  return next;
}

export function applyApprovalDelegation(state: ApprovalState, input: ApprovalInput): ApprovalState {
  if (input.type === 'view') return state;
  if (input.type === 'adopt') return adoptApproval(state, input.policy);
  if (input.type === 'review') return reviewNext(state);
  return state;
}

export function viewApprovalDelegation(state: ApprovalState) {
  const policies = ['human', 'delegate', 'rush'] as const;
  return {
    tick: state.tick,
    maturity: state.maturity,
    maturityLine: state.maturityLine,
    policy: state.policy,
    remaining: state.items.length - state.index,
    items: state.items.map((item) => ({
      id: item.id,
      risk: item.risk,
      value: item.value,
      done: item.done,
      routes: Object.fromEntries(
        policies.map((policy) => [
          policy,
          approvalRoute(item.risk, policy, state.maturity, state.maturityLine),
        ]),
      ),
    })),
  };
}

export function summarizeApprovalDelegation(state: ApprovalState) {
  return {
    value: state.value,
    reviewCost: state.reviewCost,
    failure: state.failure,
    audit: state.audit,
    breach: state.breach,
    blocked: state.blocked,
    score: state.value - state.reviewCost - state.failure - state.audit - state.breach,
    importantResidual: state.items.filter((item) => item.risk === 'important' && item.residual)
      .length,
    lost: false,
  };
}

export function chooseApprovalAction(
  state: ApprovalState,
  strategy: ApprovalPolicy,
): ApprovalInput {
  if (state.policy === null) return { type: 'adopt', policy: strategy };
  return { type: 'review' };
}

export function compareApprovalDelegations(seed = 'RI-225') {
  return (['mature', 'junior', 'heavy'] as const).flatMap((board) =>
    (['human', 'delegate', 'rush'] as const).map((strategy) => {
      const initial = createApprovalDelegation(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 12) throw new Error(`${board}:${strategy}`);
        const input = chooseApprovalAction(state, strategy);
        const next = applyApprovalDelegation(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeApprovalDelegation(state),
      };
    }),
  );
}
