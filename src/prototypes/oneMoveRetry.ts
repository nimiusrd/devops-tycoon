/**
 * RI-290: 記録した setup と入力列から、一手だけ差し替えた分岐ランを再計算する。
 * 通常ランのリプレイ（read-only キーフレーム）と保存には接続しない。
 */
import { createRng, createRngFromState, getRngState } from '../sim/rng';

export type RetryMove = 'code' | 'review' | 'rest';
export type FollowUp = 'fixed' | 'free';
export type RetryScenario = 'jam' | 'fatigue';
export const RETRY_RULESET = 'retry-proto-1';

export interface RetryState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  stamina: number;
  queue: number;
  shipped: number;
  value: number;
  jamPenalty: number;
  incidentPenalty: number;
  incidents: number;
  invalidMoves: number;
  rngState: number;
  moves: RetryMove[];
}

/** 完了ランの記録。`moves: null` は入力ログを持たない旧キーフレーム形式。 */
export interface RetryRecord {
  id: string;
  rulesetId: string;
  setup: RetryState;
  moves: RetryMove[] | null;
}

export interface RetryBranch {
  parentId: string;
  rulesetId: string;
  changed: { index: number; from: RetryMove; to: RetryMove } | null;
  followUp: FollowUp;
  rewardEligible: false;
  state: RetryState;
}

export type BranchCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'ruleset-mismatch' | 'no-input-log' | 'out-of-range' | 'same-move';
    };

const MAX_STAMINA = 6;
const REST_GAIN = 2;
const REVIEW_BATCH = 2;
const SHIP_VALUE = 3;
const JAM_LIMIT = 3;
const JAM_PENALTY = 2;
const INCIDENT_CHANCE = 0.3;
const TIRED_STAMINA = 1;
const TIRED_INCIDENT_PENALTY = 4;

export function createRetryPrototype(seed: number, horizon = 12): RetryState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    stamina: MAX_STAMINA,
    queue: 0,
    shipped: 0,
    value: 0,
    jamPenalty: 0,
    incidentPenalty: 0,
    incidents: 0,
    invalidMoves: 0,
    rngState: getRngState(createRng(seed)),
    moves: [],
  };
}

/** 一手で1tick進む。乱数は手に関わらず1tick1回だけ引き、差し替えで乱数列をずらさない。 */
export function applyRetryMove(state: RetryState, move: RetryMove): RetryState {
  if (state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  const working = move !== 'rest' && next.stamina >= 1;
  if (move === 'code' && working) {
    next.stamina -= 1;
    next.queue += 1;
  } else if (move === 'review' && working && next.queue >= 1) {
    const shipped = Math.min(REVIEW_BATCH, next.queue);
    next.stamina -= 1;
    next.queue -= shipped;
    next.shipped += shipped;
    next.value += shipped * SHIP_VALUE;
  } else if (move === 'rest') {
    next.stamina = Math.min(MAX_STAMINA, next.stamina + REST_GAIN);
  } else {
    next.invalidMoves += 1;
  }
  if (next.queue > JAM_LIMIT) next.jamPenalty += JAM_PENALTY;
  const rng = createRngFromState(next.rngState);
  if (rng() < INCIDENT_CHANCE) {
    next.incidents += 1;
    if (next.stamina <= TIRED_STAMINA) next.incidentPenalty += TIRED_INCIDENT_PENALTY;
    else next.stamina -= 1;
  }
  next.rngState = getRngState(rng);
  next.tick += 1;
  next.moves.push(move);
  return next;
}

export function runRetryMoves(setup: RetryState, moves: readonly RetryMove[]): RetryState {
  return moves.reduce(applyRetryMove, setup);
}

/** 分岐後を自由にするときの代表方針。プレイヤーの続きの判断を置き換える比較用。 */
export function policyMove(state: RetryState): RetryMove {
  if (state.stamina <= TIRED_STAMINA) return 'rest';
  if (state.queue >= REVIEW_BATCH) return 'review';
  return 'code';
}

export function summarizeRetry(state: RetryState) {
  return {
    tick: state.tick,
    shipped: state.shipped,
    value: state.value,
    queue: state.queue,
    stamina: state.stamina,
    jamPenalty: state.jamPenalty,
    incidents: state.incidents,
    incidentPenalty: state.incidentPenalty,
    invalidMoves: state.invalidMoves,
    netValue: state.value - state.jamPenalty - state.incidentPenalty,
  };
}

/** 入力ログがあれば各手の直前まで再計算できる。旧形式は setup だけを復元できる。 */
export function restorableTicks(record: RetryRecord): number[] {
  if (!record.moves) return [0];
  return record.moves.map((_, index) => index);
}

export function checkBranch(
  record: RetryRecord,
  index: number,
  to: RetryMove,
  currentRuleset: string = RETRY_RULESET,
): BranchCheck {
  if (record.rulesetId !== currentRuleset) return { ok: false, reason: 'ruleset-mismatch' };
  if (!record.moves) return { ok: false, reason: 'no-input-log' };
  if (!Number.isInteger(index) || index < 0 || index >= record.moves.length)
    return { ok: false, reason: 'out-of-range' };
  if (record.moves[index] === to) return { ok: false, reason: 'same-move' };
  return { ok: true };
}

/** 選んだ手の直前の状態。元記録の setup と入力列は変更しない。 */
export function restoreBefore(record: RetryRecord, index: number): RetryState | null {
  if (!record.moves || index < 0 || index >= record.moves.length) return null;
  return runRetryMoves(record.setup, record.moves.slice(0, index));
}

export function branchAtMove(
  record: RetryRecord,
  index: number,
  to: RetryMove,
  followUp: FollowUp,
  currentRuleset: string = RETRY_RULESET,
): RetryBranch | null {
  if (!checkBranch(record, index, to, currentRuleset).ok || !record.moves) return null;
  let state = applyRetryMove(restoreBefore(record, index)!, to);
  if (followUp === 'fixed') state = runRetryMoves(state, record.moves.slice(index + 1));
  else while (state.tick < state.horizon) state = applyRetryMove(state, policyMove(state));
  return {
    parentId: record.id,
    rulesetId: record.rulesetId,
    changed: { index, from: record.moves[index], to },
    followUp,
    rewardEligible: false,
    state,
  };
}

/** 旧形式の記録で許す唯一の分岐。setup の複製から方針で進め、変えた手は持たない。 */
export function branchFromSetup(
  record: RetryRecord,
  currentRuleset: string = RETRY_RULESET,
): RetryBranch | null {
  if (record.rulesetId !== currentRuleset) return null;
  let state = structuredClone(record.setup);
  while (state.tick < state.horizon) state = applyRetryMove(state, policyMove(state));
  return {
    parentId: record.id,
    rulesetId: record.rulesetId,
    changed: null,
    followUp: 'free',
    rewardEligible: false,
    state,
  };
}

/** 分岐の精算。通常ラン・デイリーの報酬や実績には数えない。 */
export function settleBranch(branch: RetryBranch) {
  return {
    parentId: branch.parentId,
    rewardEligible: branch.rewardEligible,
    metaReward: 0,
    dailyReward: 0,
    result: summarizeRetry(branch.state),
  };
}

/** 最初に渋滞または疲労が起きた手。リザルトで示す「転機」の候補。 */
export function findTurningPoint(record: RetryRecord) {
  if (!record.moves) return null;
  let state = record.setup;
  for (const [index, move] of record.moves.entries()) {
    state = applyRetryMove(state, move);
    if (state.queue > JAM_LIMIT) return { index, kind: 'jam' as const };
    if (state.stamina <= TIRED_STAMINA) return { index, kind: 'fatigue' as const };
  }
  return null;
}

const SCENARIO_MOVES: Record<RetryScenario, RetryMove[]> = {
  jam: [
    'code',
    'code',
    'code',
    'code',
    'code',
    'rest',
    'code',
    'review',
    'review',
    'review',
    'rest',
    'review',
  ],
  fatigue: [
    'code',
    'code',
    'review',
    'code',
    'code',
    'review',
    'code',
    'review',
    'code',
    'review',
    'code',
    'review',
  ],
};

export function createRetryRecord(scenario: RetryScenario, seed = 1): RetryRecord {
  return {
    id: `${scenario}-${seed}`,
    rulesetId: RETRY_RULESET,
    setup: createRetryPrototype(seed),
    moves: [...SCENARIO_MOVES[scenario]],
  };
}

export const RETRY_SEEDS = [1, 2, 3, 4, 5] as const;

const BRANCH_CANDIDATES = ['review', 'rest'] as const;

export function compareRetryBranches(seeds: readonly number[] = RETRY_SEEDS) {
  return seeds.flatMap((seed) =>
    (['jam', 'fatigue'] as const).map((scenario) => {
      const record = createRetryRecord(scenario, seed);
      const turning = findTurningPoint(record)!;
      const original = summarizeRetry(runRetryMoves(record.setup, record.moves!));
      const from = record.moves![turning.index];
      // 転機の元の手は same-move で拒否される。候補に残すと branch が null になり比較が落ちる。
      const branches = BRANCH_CANDIDATES.filter((to) => to !== from).flatMap((to) =>
        (['fixed', 'free'] as const).flatMap((followUp) => {
          const branch = branchAtMove(record, turning.index, to, followUp);
          if (!branch) return [];
          return [{ to, followUp, moves: branch.state.moves, result: settleBranch(branch).result }];
        }),
      );
      return { scenario, seed, record, turning, original, branches };
    }),
  );
}
