import { createCiPrototype, tickCiPrototype, summarizeCi, type CiState } from './ciCapacity';
export type ReviewDepth = 'normal' | 'focused';
export type ReviewImpact = 'low' | 'high';
export interface DepthState {
  version: 1;
  board: CiState;
  stamina: number;
  impacts: Record<string, ReviewImpact>;
  choices: Record<string, ReviewDepth>;
  inputs: (ReviewDepth | 'continue')[];
}
/** 判断前に見える所要時間・体力・公開後の期待損失。 */
export function describeDepth(impact: ReviewImpact, depth: ReviewDepth) {
  return {
    ticks: depth === 'normal' ? 1 : 3,
    staminaPerTick: depth === 'normal' ? 1 : 2,
    riskLoss: depth === 'focused' ? 0 : impact === 'low' ? 1 : 8,
  };
}
export function createDepthPrototype(
  seed: string | number,
  impact: ReviewImpact | 'mixed',
): DepthState {
  const board = createCiPrototype(seed, 'review', 2);
  board.jobs = board.jobs.map((job) => ({ ...job, reviewLeft: -1, failFirst: false }));
  return {
    version: 1,
    board,
    stamina: 30,
    impacts: Object.fromEntries(
      board.jobs.map((j) => [j.id, impact === 'mixed' ? (j.id === 'b' ? 'high' : 'low') : impact]),
    ),
    choices: {},
    inputs: [],
  };
}
/** 開始時だけ深度を選択する。処理中の変更は拒否。レビュー体力は毎工数払う。 */
export function tickDepthPrototype(state: DepthState, input: ReviewDepth | 'continue'): DepthState {
  if (state.board.tick >= state.board.horizon || state.board.budget < state.board.capacity)
    return state;
  const reviewer = state.board.jobs.find((j) => j.stage === 'review' && j.reviewLeft !== 0);
  const selected = reviewer ? state.choices[reviewer.id] : undefined;
  if (
    (reviewer && !selected && input === 'continue') ||
    ((selected || !reviewer) && input !== 'continue')
  )
    return state;
  const depth = selected ?? (input === 'continue' ? undefined : input);
  const cost = depth ? describeDepth(state.impacts[reviewer!.id], depth).staminaPerTick : 0;
  if (state.stamina < cost) return state;
  const next = structuredClone(state);
  if (reviewer && !selected && depth) {
    next.choices[reviewer.id] = depth;
    next.board.jobs.find((j) => j.id === reviewer.id)!.reviewLeft = describeDepth(
      next.impacts[reviewer.id],
      depth,
    ).ticks;
  }
  next.stamina -= cost;
  next.board = tickCiPrototype(next.board, 'all');
  next.inputs.push(input);
  return next;
}
export function summarizeDepth(state: DepthState) {
  const ci = summarizeCi(state.board);
  const expectedLoss = state.board.jobs
    .filter((j) => j.stage === 'done')
    .reduce((sum, j) => sum + describeDepth(state.impacts[j.id], state.choices[j.id]).riskLoss, 0);
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
        const reviewer = state.board.jobs.find((j) => j.stage === 'review' && j.reviewLeft !== 0);
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
