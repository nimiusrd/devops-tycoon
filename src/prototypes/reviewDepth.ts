import { createCiPrototype, tickCiPrototype, summarizeCi, type CiState } from './ciCapacity';
export type ReviewDepth = 'normal' | 'focused';
export type ReviewImpact = 'low' | 'high';
export type DepthInput = ReviewDepth | 'continue' | 'abort';
/** 初回の資源の上で、一つだけ動かす規則。無い状態は初回と同じ。 */
export interface DepthRules {
  /** 予告が当たった重点が残す期待損失の割合。0は全軽減、1は軽減なし。 */
  residual: number;
  normalTicks: number;
  focusedTicks: number;
  horizon: number;
  /** 受け付けたtickで、消費の前に足す体力。上限は初期体力30。 */
  recovery: number;
  /** 進行中のレビューを、時間を進めずに未選択の末尾へ戻せる。 */
  abort: boolean;
  /** 1tickにレビューを進める件数。CI枠は変えない。 */
  reviewers: number;
}
export const baselineDepthRules: DepthRules = {
  residual: 0,
  normalTicks: 1,
  focusedTicks: 3,
  horizon: 6,
  recovery: 0,
  abort: false,
  reviewers: 1,
};
/** 要因比較で固定する初回の資源。ここを変えると比較は一要因ではなくなる。 */
export const depthFactorResources = {
  stamina: 30,
  budget: 20,
  capacity: 2,
  jobs: 3,
  value: 8,
  ciTicks: 2,
  normalStamina: 1,
  focusedStamina: 2,
  lowLoss: 1,
  highLoss: 8,
} as const;
const STAMINA_MAX = depthFactorResources.stamina;
export interface DepthState {
  version: 1;
  board: CiState;
  stamina: number;
  impacts: Record<string, ReviewImpact>;
  /** 要因比較だけが持つ予告。無いときは実際の影響と同じ。 */
  announced?: Record<string, ReviewImpact>;
  /** 無いときは初回の規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: DepthRules;
  choices: Record<string, ReviewDepth>;
  inputs: DepthInput[];
}
/** 判断前に見える所要時間・体力・公開後の期待損失。予告が実際と違う重点は軽減しない。 */
export function describeDepth(
  impact: ReviewImpact,
  depth: ReviewDepth,
  rules?: DepthRules,
  announced?: ReviewImpact,
) {
  const base = impact === 'low' ? depthFactorResources.lowLoss : depthFactorResources.highLoss;
  const seen = announced ?? impact;
  const residual = rules?.residual ?? 0;
  return {
    ticks:
      depth === 'normal'
        ? (rules?.normalTicks ?? 1)
        : (rules?.focusedTicks ?? baselineDepthRules.focusedTicks),
    staminaPerTick:
      depth === 'normal' ? depthFactorResources.normalStamina : depthFactorResources.focusedStamina,
    riskLoss: depth === 'normal' ? base : seen === impact ? base * residual : base,
  };
}
export function createDepthPrototype(
  seed: string | number,
  impact: ReviewImpact | 'mixed',
): DepthState {
  const board = createCiPrototype(seed, 'review', depthFactorResources.capacity);
  board.jobs = board.jobs.map((job) => ({ ...job, reviewLeft: -1, failFirst: false }));
  return {
    version: 1,
    board,
    stamina: STAMINA_MAX,
    impacts: Object.fromEntries(
      board.jobs.map((job) => [
        job.id,
        impact === 'mixed' ? (job.id === 'b' ? 'high' : 'low') : impact,
      ]),
    ),
    choices: {},
    inputs: [],
  };
}
export function createDepthFactorState(
  seed: string | number,
  impacts: readonly [ReviewImpact, ReviewImpact, ReviewImpact],
  rules: DepthRules,
  announced: readonly [ReviewImpact, ReviewImpact, ReviewImpact],
): DepthState {
  const state = createDepthPrototype(seed, 'low');
  const [first, second, third] = state.board.jobs;
  state.board.horizon = rules.horizon;
  state.impacts = { [first.id]: impacts[0], [second.id]: impacts[1], [third.id]: impacts[2] };
  state.announced = {
    [first.id]: announced[0],
    [second.id]: announced[1],
    [third.id]: announced[2],
  };
  state.rules = rules;
  return state;
}
function depthTargets(state: DepthState) {
  return state.board.jobs
    .filter((job) => job.stage === 'review' && job.reviewLeft !== 0)
    .slice(0, state.rules?.reviewers ?? 1);
}
/** 中止は時間も予算も進めない。消費済みの体力は戻さない。 */
function abortDepthReview(state: DepthState): DepthState {
  if (!state.rules?.abort) return state;
  const index = state.board.jobs.findIndex(
    (job) => job.stage === 'review' && job.reviewLeft > 0 && state.choices[job.id],
  );
  if (index < 0) return state;
  const next = structuredClone(state);
  const [job] = next.board.jobs.splice(index, 1);
  job.reviewLeft = -1;
  delete next.choices[job.id];
  next.board.jobs.push(job);
  next.inputs.push('abort');
  return next;
}
/** 開始時だけ深度を選択する。処理中の変更は拒否。レビュー体力は毎工数払う。 */
export function tickDepthPrototype(state: DepthState, input: DepthInput): DepthState {
  if (state.board.tick >= state.board.horizon || state.board.budget < state.board.capacity)
    return state;
  if (input === 'abort') return abortDepthReview(state);
  const active = depthTargets(state);
  const needsChoice = active.some((job) => !state.choices[job.id]);
  if ((needsChoice && input === 'continue') || (!needsChoice && input !== 'continue')) return state;
  const depth = input === 'continue' ? undefined : input;
  const cost = active.reduce((sum, job) => {
    const chosen = state.choices[job.id] ?? depth;
    return (
      sum + (chosen ? describeDepth(state.impacts[job.id], chosen, state.rules).staminaPerTick : 0)
    );
  }, 0);
  const recovery = state.rules?.recovery ?? 0;
  const recovered = recovery > 0 ? Math.min(STAMINA_MAX, state.stamina + recovery) : state.stamina;
  if (recovered < cost) return state;
  const next = structuredClone(state);
  next.stamina = recovered - cost;
  for (const job of active) {
    const target = next.board.jobs.find((candidate) => candidate.id === job.id)!;
    if (!next.choices[target.id] && depth) {
      next.choices[target.id] = depth;
      target.reviewLeft = describeDepth(next.impacts[target.id], depth, next.rules).ticks;
    }
  }
  // CI試作はレビューを1件しか進めない。2件目以降はここだけ進め、CI枠と料金は変えない。
  for (const job of active.slice(1)) {
    const target = next.board.jobs.find((candidate) => candidate.id === job.id)!;
    if (target.reviewLeft > 0) target.reviewLeft -= 1;
  }
  next.board = tickCiPrototype(next.board, 'all');
  next.inputs.push(input);
  return next;
}
export function summarizeDepth(state: DepthState) {
  const ci = summarizeCi(state.board);
  const expectedLoss = state.board.jobs
    .filter((job) => job.stage === 'done')
    .reduce(
      (sum, job) =>
        sum +
        describeDepth(
          state.impacts[job.id],
          state.choices[job.id],
          state.rules,
          state.announced?.[job.id],
        ).riskLoss,
      0,
    );
  return {
    ...ci,
    expectedLoss,
    netValue: ci.netValue - expectedLoss,
    stamina: state.stamina,
    choices: state.choices,
  };
}
export function compareDepthStrategies(seed: string | number) {
  return (['low', 'high', 'mixed'] as const).flatMap((impact) =>
    (impact === 'mixed'
      ? (['normal', 'focused', 'selective'] as const)
      : (['normal', 'focused'] as const)
    ).map((depth) => {
      const initial = createDepthPrototype(seed, impact);
      let state = initial;
      while (state.board.tick < state.board.horizon) {
        const reviewer = state.board.jobs.find(
          (job) => job.stage === 'review' && job.reviewLeft !== 0,
        );
        state = tickDepthPrototype(
          state,
          reviewer && !state.choices[reviewer.id]
            ? depth === 'selective'
              ? state.impacts[reviewer.id] === 'high'
                ? 'focused'
                : 'normal'
              : depth
            : 'continue',
        );
      }
      return { impact, depth, initial, inputs: state.inputs, result: summarizeDepth(state) };
    }),
  );
}
type ForecastMismatch = 'none' | 'a' | 'b' | 'c' | 'all';
function boardImpacts(board: string): [ReviewImpact, ReviewImpact, ReviewImpact] {
  const pattern = board === 'low' ? 'LLL' : board === 'high' ? 'HHH' : board;
  return pattern.split('').map((mark) => (mark === 'H' ? 'high' : 'low')) as [
    ReviewImpact,
    ReviewImpact,
    ReviewImpact,
  ];
}
function announce(
  impacts: readonly [ReviewImpact, ReviewImpact, ReviewImpact],
  mismatch: ForecastMismatch,
): [ReviewImpact, ReviewImpact, ReviewImpact] {
  return impacts.map((impact, index) => {
    const id = ['a', 'b', 'c'][index];
    const wrong = mismatch === 'all' || mismatch === id;
    return wrong ? (impact === 'low' ? 'high' : 'low') : impact;
  }) as [ReviewImpact, ReviewImpact, ReviewImpact];
}
function factorCases() {
  const boards = ['low', 'high'] as const;
  const rows: {
    factor: string;
    level: string;
    board: string;
    rules: DepthRules;
    impacts: [ReviewImpact, ReviewImpact, ReviewImpact];
    announced: [ReviewImpact, ReviewImpact, ReviewImpact];
  }[] = [];
  const add = (
    factor: string,
    level: string,
    board: string,
    rules: DepthRules,
    mismatch: ForecastMismatch = 'none',
  ) => {
    const impacts = boardImpacts(board);
    rows.push({ factor, level, board, rules, impacts, announced: announce(impacts, mismatch) });
  };
  for (const residual of [0, 0.25, 0.5, 0.75, 1]) {
    for (const board of boards)
      add('residual', String(residual), board, { ...baselineDepthRules, residual });
  }
  for (const mismatch of ['none', 'a', 'b', 'c', 'all'] as const) {
    for (const board of boards)
      add('forecast', mismatch, board, { ...baselineDepthRules }, mismatch);
  }
  for (const board of ['LLL', 'HLL', 'LHL', 'LLH', 'HHL', 'HLH', 'LHH', 'HHH']) {
    add('composition', board, board, { ...baselineDepthRules });
  }
  for (const focusedTicks of [1, 2, 3, 4]) {
    for (const board of boards)
      add('focusedTicks', String(focusedTicks), board, { ...baselineDepthRules, focusedTicks });
  }
  for (const normalTicks of [1, 2, 3]) {
    for (const board of boards)
      add('normalTicks', String(normalTicks), board, { ...baselineDepthRules, normalTicks });
  }
  for (const horizon of [2, 4, 6, 7, 9, 10]) {
    for (const board of boards)
      add('horizon', String(horizon), board, { ...baselineDepthRules, horizon });
  }
  for (const recovery of [0, 1]) {
    for (const board of boards)
      add('recovery', String(recovery), board, { ...baselineDepthRules, recovery });
  }
  for (const abort of [false, true]) {
    for (const board of boards)
      add('abort', String(abort), board, { ...baselineDepthRules, abort });
  }
  for (const reviewers of [1, 2, 3]) {
    for (const board of boards)
      add('reviewers', String(reviewers), board, { ...baselineDepthRules, reviewers });
  }
  return rows;
}
/** 中止を一度だけ使う固定入力。一律重点でも一律通常でもない。 */
export function compareDepthAbortExamples(seed: string | number) {
  const inputs: DepthInput[] = [
    'focused',
    'abort',
    'normal',
    'normal',
    'normal',
    'continue',
    'continue',
  ];
  return (['low', 'high'] as const).map((board) => {
    const impacts = boardImpacts(board);
    const initial = createDepthFactorState(
      seed,
      impacts,
      { ...baselineDepthRules, abort: true },
      impacts,
    );
    let state = initial;
    for (const input of inputs) state = tickDepthPrototype(state, input);
    return { board, inputs: [...inputs], initial, result: summarizeDepth(state) };
  });
}
/** 初回と同じ資源で要因を一つずつ動かし、一律通常と一律重点だけを再計算する。 */
export function compareDepthFactorReversals(seed: string | number) {
  return factorCases().flatMap((item) =>
    (['normal', 'focused'] as const).map((strategy) => {
      const initial = createDepthFactorState(seed, item.impacts, item.rules, item.announced);
      let state = initial;
      for (let guard = 0; guard < 30 && state.board.tick < state.board.horizon; guard++) {
        const needsChoice = depthTargets(state).some((job) => !state.choices[job.id]);
        const next = tickDepthPrototype(state, needsChoice ? strategy : 'continue');
        if (next === state) break;
        state = next;
      }
      return {
        factor: item.factor,
        level: item.level,
        board: item.board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeDepth(state),
      };
    }),
  );
}
