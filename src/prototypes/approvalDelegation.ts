/** RI-225: 低リスクだけを委譲する承認ルール。感度比較だけ成熟線・残存失敗・確認費用を変える。#538 の期間委任へは未接続。 */

export type ChangeRisk = 'low' | 'important';
export type ApprovalBoard = 'mature' | 'junior' | 'heavy';
export type ApprovalPolicy = 'human' | 'delegate' | 'rush';
export type ApprovalInput =
  { type: 'adopt'; policy: ApprovalPolicy } | { type: 'review' } | { type: 'view' };
export type ApprovalPreference = 'delegate' | 'human' | 'tie';
/** 初回と同じ資源。感度では一つの欄だけを変える。急ぎの残存失敗と監査は動かさない。 */
export interface ApprovalFactorRules {
  maturityLine: number;
  residualFailure: number;
  reviewCost: number;
}

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
export const baselineApprovalRules: ApprovalFactorRules = {
  maturityLine: MATURITY_LINE,
  residualFailure: DELEGATE_FAILURE,
  reviewCost: REVIEW_COST,
};
const FACTOR_BOARDS = ['mature', 'junior', 'heavy'] as const;
const FACTOR_SEED = 'RI-225';

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

export function createApprovalDelegation(
  seed: string,
  board: ApprovalBoard,
  rules: ApprovalFactorRules = baselineApprovalRules,
): ApprovalState {
  const preset = ITEMS[board];
  const items = freshItems(board);
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 1 + items.length,
    maturity: preset.maturity,
    maturityLine: rules.maturityLine,
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
export function reviewNext(
  state: ApprovalState,
  rules: ApprovalFactorRules = baselineApprovalRules,
): ApprovalState {
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
    next.failure += policy === 'rush' ? RUSH_FAILURE : rules.residualFailure;
  } else {
    item.reviewed = true;
    next.reviewCost += rules.reviewCost;
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

export function applyApprovalDelegation(
  state: ApprovalState,
  input: ApprovalInput,
  rules: ApprovalFactorRules = baselineApprovalRules,
): ApprovalState {
  if (input.type === 'view') return state;
  if (input.type === 'adopt') return adoptApproval(state, input.policy);
  if (input.type === 'review') return reviewNext(state, rules);
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

export interface ApprovalFactorRun {
  inputs: ApprovalInput[];
  result: ReturnType<typeof summarizeApprovalDelegation>;
}
export interface ApprovalFactorBoard {
  board: ApprovalBoard;
  delegate: ApprovalFactorRun;
  human: ApprovalFactorRun;
  preference: ApprovalPreference;
  margin: number;
}
export interface ApprovalFactorPoint {
  axis: keyof ApprovalFactorRules;
  parameter: string;
  rules: ApprovalFactorRules;
  boards: ApprovalFactorBoard[];
}
export interface ApprovalFactorReversal {
  axis: keyof ApprovalFactorRules;
  board: ApprovalBoard;
  before: { parameter: string; preference: ApprovalPreference; delegate: number; human: number };
  after: { parameter: string; preference: ApprovalPreference; delegate: number; human: number };
}

function cloneRules(rules: ApprovalFactorRules): ApprovalFactorRules {
  return { ...rules };
}
function withRules(patch: Partial<ApprovalFactorRules>): ApprovalFactorRules {
  return { ...baselineApprovalRules, ...patch };
}
function preferenceOf(delegate: number, human: number): ApprovalPreference {
  if (delegate > human) return 'delegate';
  if (human > delegate) return 'human';
  return 'tie';
}
function runApproval(
  board: ApprovalBoard,
  strategy: 'delegate' | 'human',
  rules: ApprovalFactorRules,
): ApprovalFactorRun {
  const initial = createApprovalDelegation(FACTOR_SEED, board, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 12) throw new Error(`${board}:${strategy}:${rules.maturityLine}`);
    const next = applyApprovalDelegation(state, chooseApprovalAction(state, strategy), rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeApprovalDelegation(state) };
}
function factorPoint(
  axis: keyof ApprovalFactorRules,
  parameter: string,
  rules: ApprovalFactorRules,
): ApprovalFactorPoint {
  const boards = FACTOR_BOARDS.map((board) => {
    const delegate = runApproval(board, 'delegate', rules);
    const human = runApproval(board, 'human', rules);
    return {
      board,
      delegate,
      human,
      preference: preferenceOf(delegate.result.score, human.result.score),
      margin: delegate.result.score - human.result.score,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: ApprovalFactorPoint[]): ApprovalFactorReversal[] {
  const found: ApprovalFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = before.boards.find((item) => item.board === board);
      const later = after.boards.find((item) => item.board === board);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        board,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          delegate: earlier.delegate.result.score,
          human: earlier.human.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          delegate: later.delegate.result.score,
          human: later.human.result.score,
        },
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、成熟線・残存失敗・確認費用を一つずつ動かす。固定戦略。 */
export function compareApprovalFactorReversals() {
  const sweeps = {
    maturityLine: [0, 1, 2, 3, 4].map((maturityLine) =>
      factorPoint('maturityLine', String(maturityLine), withRules({ maturityLine })),
    ),
    residualFailure: [0, 1, 2, 3].map((residualFailure) =>
      factorPoint('residualFailure', String(residualFailure), withRules({ residualFailure })),
    ),
    reviewCost: [0, 1, 2, 3].map((reviewCost) =>
      factorPoint('reviewCost', String(reviewCost), withRules({ reviewCost })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      boards: FACTOR_BOARDS.map((board) => ({
        board,
        maturity: ITEMS[board].maturity,
        items: ITEMS[board].items.map((item) => ({
          id: item.id,
          risk: item.risk,
          value: item.value,
        })),
      })),
      audit: AUDIT_COST,
      rushFailure: RUSH_FAILURE,
      breach: BREACH_COST,
      decision: {
        delegate: '低リスクを委譲する',
        human: '人間が確認する',
        score: 'value - reviewCost - failure - audit - breach',
        preference: '委譲の差引が大きいとき委譲、人間確認が大きいとき人間、同じとき同点',
      },
      baseline: cloneRules(baselineApprovalRules),
      held: {
        maturityLine:
          '成熟線だけを0から4まで動かす。残存失敗は1、確認費用は2、監査は1。盤面の成熟と仕事は初回のまま。',
        residualFailure:
          '委譲で自動にした低リスクの残存失敗だけを0から3まで動かす。成熟線は2、確認費用は2、監査は1。急ぎの残存失敗3は動かさない。',
        reviewCost:
          '人間確認1件の確認費用だけを0から3まで動かす。成熟線は2、残存失敗は1、監査は1。',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}
