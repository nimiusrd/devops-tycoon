/** RI-254: レビュー記録と再発防止を監査証拠にする。通常ランには接続しない。 */

export type AuditBoard = 'forecast' | 'crunch';
export type AuditStrategy = 'record' | 'ship';
export type EvidenceKind = 'review' | 'prevention';
export type EvidenceSource = 'record' | 'rush';
export type AuditInput =
  | { type: 'view' }
  | { type: 'record' }
  | { type: 'ship' }
  | { type: 'work' }
  | { type: 'audit' }
  | { type: 'submit'; id: string };

export interface AuditEvidenceItem {
  id: string;
  kind: EvidenceKind;
  source: EvidenceSource;
}

export interface AuditPeriod {
  tick: number;
  action: AuditStrategy | 'work' | 'audit';
  shipped: number;
  rushSpent: number;
  review: number;
  prevention: number;
  score: number;
}

export interface AuditState {
  version: 1;
  seed: string;
  board: AuditBoard;
  tick: number;
  horizon: number;
  peaceTicks: number;
  capacity: number;
  shipPerCapacity: number;
  rushCost: number;
  requiredReview: number;
  requiredPrevention: number;
  strategy: AuditStrategy | null;
  shipped: number;
  rushSpent: number;
  evidence: AuditEvidenceItem[];
  submitted: string[];
  acceptedReview: number;
  acceptedPrevention: number;
  nextSerial: number;
  qualityUsed: false;
  debtQualityGate: 'kept';
  periods: AuditPeriod[];
  inputs: AuditInput[];
}

const CAPACITY = 2;
const REQUIRED = 1;
const KINDS = ['review', 'prevention'] as const;

const BOARDS: Record<
  AuditBoard,
  { peaceTicks: number; shipPerCapacity: number; rushCost: number }
> = {
  forecast: { peaceTicks: 3, shipPerCapacity: 4, rushCost: 9 },
  crunch: { peaceTicks: 1, shipPerCapacity: 9, rushCost: 4 },
};

function scoreOf(state: AuditState): number {
  return state.shipped - state.rushSpent;
}

function kindCount(state: AuditState, kind: EvidenceKind): number {
  return state.evidence.filter((item) => item.kind === kind).length;
}

function requiredOf(state: AuditState, kind: EvidenceKind): number {
  return kind === 'review' ? state.requiredReview : state.requiredPrevention;
}

function missingKinds(state: AuditState): EvidenceKind[] {
  return KINDS.filter((kind) => kindCount(state, kind) < requiredOf(state, kind));
}

function pushPeriod(state: AuditState, action: AuditPeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    shipped: state.shipped,
    rushSpent: state.rushSpent,
    review: kindCount(state, 'review'),
    prevention: kindCount(state, 'prevention'),
    score: scoreOf(state),
  });
  state.tick += 1;
}

function createEvidence(state: AuditState, kind: EvidenceKind, source: EvidenceSource) {
  const item = { id: `${kind}-${state.nextSerial}`, kind, source };
  state.nextSerial += 1;
  state.evidence.push(item);
  return item;
}

function acceptEvidence(state: AuditState, item: AuditEvidenceItem) {
  if (state.submitted.includes(item.id)) return false;
  state.submitted.push(item.id);
  if (item.kind === 'review' && state.acceptedReview < state.requiredReview) {
    state.acceptedReview += 1;
  }
  if (item.kind === 'prevention' && state.acceptedPrevention < state.requiredPrevention) {
    state.acceptedPrevention += 1;
  }
  return true;
}

export function createAuditEvidence(seed: string, board: AuditBoard): AuditState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: spec.peaceTicks + 2,
    peaceTicks: spec.peaceTicks,
    capacity: CAPACITY,
    shipPerCapacity: spec.shipPerCapacity,
    rushCost: spec.rushCost,
    requiredReview: REQUIRED,
    requiredPrevention: REQUIRED,
    strategy: null,
    shipped: 0,
    rushSpent: 0,
    evidence: [],
    submitted: [],
    acceptedReview: 0,
    acceptedPrevention: 0,
    nextSerial: 1,
    qualityUsed: false,
    debtQualityGate: 'kept',
    periods: [],
    inputs: [],
  };
}

function applyWork(state: AuditState): AuditState {
  const next = structuredClone(state);
  let room = next.capacity;
  if (next.strategy === 'record') {
    for (const kind of KINDS) {
      if (room > 0 && kindCount(next, kind) < requiredOf(next, kind)) {
        createEvidence(next, kind, 'record');
        room -= 1;
      }
    }
  }
  next.shipped += room * next.shipPerCapacity;
  pushPeriod(next, 'work');
  next.inputs.push({ type: 'work' });
  return next;
}

function applyAudit(state: AuditState): AuditState {
  const next = structuredClone(state);
  for (const item of next.evidence) acceptEvidence(next, item);
  for (const kind of missingKinds(next)) {
    const item = createEvidence(next, kind, 'rush');
    acceptEvidence(next, item);
    next.rushSpent += next.rushCost;
  }
  pushPeriod(next, 'audit');
  next.inputs.push({ type: 'audit' });
  return next;
}

export function applyAuditEvidence(state: AuditState, input: AuditInput): AuditState {
  if (input.type === 'view') return state;
  if (input.type === 'record' || input.type === 'ship') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    pushPeriod(next, input.type);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (input.type === 'submit') {
    const item = state.evidence.find((evidence) => evidence.id === input.id);
    if (!item || state.submitted.includes(input.id)) return state;
    const next = structuredClone(state);
    acceptEvidence(next, item);
    next.inputs.push({ type: 'submit', id: input.id });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  if (input.type === 'work') {
    if (state.tick < 1 || state.tick > state.peaceTicks) return state;
    return applyWork(state);
  }
  if (input.type === 'audit') {
    if (state.tick !== state.peaceTicks + 1) return state;
    return applyAudit(state);
  }
  return state;
}

export function summarizeAuditEvidence(state: AuditState) {
  return {
    score: scoreOf(state),
    shipped: state.shipped,
    rushSpent: state.rushSpent,
    review: kindCount(state, 'review'),
    prevention: kindCount(state, 'prevention'),
    acceptedReview: state.acceptedReview,
    acceptedPrevention: state.acceptedPrevention,
    missing: missingKinds(state),
    qualityUsed: state.qualityUsed,
    debtQualityGate: state.debtQualityGate,
    path: state.periods.map((period) => period.score),
    lost: false,
  };
}

export function chooseAuditAction(state: AuditState, strategy: AuditStrategy): AuditInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  if (state.tick <= state.peaceTicks) return { type: 'work' };
  return { type: 'audit' };
}

function runAudit(seed: string, board: AuditBoard, strategy: AuditStrategy) {
  const initial = createAuditEvidence(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseAuditAction(state, strategy);
    const next = applyAuditEvidence(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeAuditEvidence(state) };
}

export function compareAuditEvidence(seed = 'RI-254') {
  return (['forecast', 'crunch'] as const).flatMap((board) =>
    (['record', 'ship'] as const).map((strategy) => ({
      board,
      strategy,
      ...runAudit(seed, board, strategy),
    })),
  );
}

function preview(state: AuditState, strategy: AuditStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyAuditEvidence(cursor, chooseAuditAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeAuditEvidence(cursor);
  return {
    strategy,
    score: summary.score,
    shipped: summary.shipped,
    rushSpent: summary.rushSpent,
    missing: summary.missing,
  };
}

export function viewAuditEvidence(state: AuditState) {
  return {
    tick: state.tick,
    board: state.board,
    peaceTicks: state.peaceTicks,
    capacity: state.capacity,
    shipPerCapacity: state.shipPerCapacity,
    rushCost: state.rushCost,
    requiredReview: state.requiredReview,
    requiredPrevention: state.requiredPrevention,
    strategy: state.strategy,
    choices: state.strategy === null ? (['record', 'ship'] as const) : [],
    missing: missingKinds(state),
    acceptedReview: state.acceptedReview,
    acceptedPrevention: state.acceptedPrevention,
    qualityUsed: state.qualityUsed,
    debtQualityGate: state.debtQualityGate,
    replacedDebtGate: false,
    forecasts:
      state.strategy === null
        ? (['record', 'ship'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}
