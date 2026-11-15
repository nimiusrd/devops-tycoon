import { createCiPrototype, tickCiPrototype, type CiJob, type CiState } from './ciCapacity';
export type PriorityInput =
  | { type: 'promote'; id: string }
  | { type: 'reserve'; id: string }
  | { type: 'apply'; id: string }
  | { type: 'rotate' }
  | { type: 'rush' }
  | { type: 'tick' };
export interface PriorityState {
  version: 1;
  board: CiState;
  focus: number;
  focusSpent: number;
  reviewWait: Record<string, number>;
  deadlines: Record<string, number>;
  values: Record<string, number>;
  inputs: PriorityInput[];
  /** 無いときは初回と同じ規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: PriorityRules;
  /** 進行中の選択予約。適用まで先頭は動かさない。 */
  pending?: string;
}
/** 比較で一つずつ動かす規則。未指定の状態は baselinePriorityRules。 */
export interface PriorityRules {
  assignees: number;
  /** 予約してから先頭へ移すまでのtick。0は即時のpromote。 */
  reserveAfter: number;
  /** 重要PR bのレビュー工数。aとcは2、CIは全員2。 */
  effortB: number;
  /** 重要PR bの期限。aとcは6。 */
  deadlineB: number;
  /** 差引で集中力1を価値何点と数えるか。 */
  focusValue: number;
  /** 移した直後に先頭レビューを末尾へ回す回数。移さない側には起こらない。 */
  reactRotations: number;
  /** 着手前に過ぎたtick。残工数はそのまま。 */
  elapsed: number;
  /** レビュー待ち1点を差引から引く。 */
  waitPenalty: number;
  /** 開始前に固定する初回CI失敗。実行中には抽選しない。 */
  failure: 'none' | 'a' | 'b' | 'c';
}
export const baselinePriorityRules: PriorityRules = Object.freeze({
  assignees: 1,
  reserveAfter: 0,
  effortB: 2,
  deadlineB: 3,
  focusValue: 1,
  reactRotations: 0,
  elapsed: 0,
  waitPenalty: 0,
  failure: 'none',
});
export function createPriorityPrototype(seed: string | number, urgent: 'a' | 'b'): PriorityState {
  const board = createCiPrototype(seed, 'review', 1);
  board.jobs = board.jobs.map((job) => ({ ...job, reviewLeft: 2, failFirst: false }));
  return {
    version: 1,
    board,
    focus: 6,
    focusSpent: 0,
    reviewWait: { a: 0, b: 0, c: 0 },
    deadlines: { a: urgent === 'a' ? 3 : 6, b: urgent === 'b' ? 3 : 6, c: 6 },
    values: { a: urgent === 'a' ? 12 : 8, b: urgent === 'b' ? 12 : 8, c: 8 },
    inputs: [],
  };
}
function rulesOf(state: PriorityState): PriorityRules {
  return state.rules ?? baselinePriorityRules;
}
function reviewsIn(jobs: CiJob[]) {
  return jobs.filter((job) => job.stage === 'review');
}
function reviewFull(state: PriorityState, id: string) {
  return id === 'b' ? rulesOf(state).effortB : 2;
}
/** 着手済みで未完了のレビューが先頭なら、予約の適用は割り込まない。 */
function frontReviewInProgress(state: PriorityState) {
  const front = reviewsIn(state.board.jobs).find((job) => job.reviewLeft > 0);
  return !!front && front.reviewLeft < reviewFull(state, front.id);
}
function reorderReviews(state: PriorityState, nextFrontId: string) {
  const reviews = reviewsIn(state.board.jobs);
  const selected = reviews.find((job) => job.id === nextFrontId);
  if (!selected || reviews[0]?.id === nextFrontId) return false;
  const order = [selected, ...reviews.filter((job) => job.id !== nextFrontId)];
  let index = 0;
  state.board.jobs = state.board.jobs.map((job) =>
    job.stage === 'review' ? structuredClone(order[index++]) : job,
  );
  return true;
}
function assignmentPlan(jobs: { id: string; reviewLeft: number }[], assignees: number) {
  const plan = new Map<string, number>();
  let left = assignees;
  while (left > 0) {
    let progressed = false;
    for (const job of jobs) {
      if (left === 0) break;
      const used = plan.get(job.id) ?? 0;
      if (used >= job.reviewLeft) continue;
      plan.set(job.id, used + 1);
      left--;
      progressed = true;
    }
    if (!progressed) break;
  }
  return plan;
}
/** tickCiPrototype が先頭を1進めるので、残りだけ先に配る。 */
function applyExtraReview(board: CiState, plan: Map<string, number>) {
  const targets = board.jobs.filter((job) => job.stage === 'review' && job.reviewLeft > 0);
  const front = targets[0];
  if (!front) return;
  front.reviewLeft -= Math.max(0, (plan.get(front.id) ?? 0) - 1);
  for (const job of targets.slice(1)) job.reviewLeft -= plan.get(job.id) ?? 0;
}
function rejectPriority(state: PriorityState, input: PriorityInput): boolean {
  if (state.board.tick >= state.board.horizon) return true;
  const reviews = reviewsIn(state.board.jobs);
  if (
    input.type === 'promote' &&
    (state.focus < 2 ||
      reviews[0]?.reviewLeft !== 2 ||
      !reviews.some((job) => job.id === input.id) ||
      reviews[0].id === input.id)
  )
    return true;
  if (input.type === 'reserve') {
    const target = reviews.find((job) => job.id === input.id);
    if (state.focus < 2 || !target || reviews[0]?.id === input.id || state.pending) return true;
  }
  if (
    input.type === 'apply' &&
    (state.pending !== input.id ||
      !reviews.some((job) => job.id === input.id) ||
      frontReviewInProgress(state))
  )
    return true;
  if (input.type === 'rotate' && reviews.length < 2) return true;
  if (input.type === 'rush' && (state.focus < 6 || reviews.length === 0)) return true;
  if (input.type === 'tick' && state.board.budget < state.board.capacity) return true;
  return false;
}
/** 順序変更は集中力2。進行中のレビューは中断せず、先頭連打は無消費。 */
export function applyPriorityInput(state: PriorityState, input: PriorityInput): PriorityState {
  if (rejectPriority(state, input)) return state;
  const next = structuredClone(state);
  if (input.type === 'promote' || input.type === 'apply') {
    // すでに先頭なら順序は変えず、予約だけ解消する。集中力は予約時に払ってある。
    const moved = reorderReviews(next, input.id);
    if (input.type === 'promote') {
      if (!moved) return state;
      next.focus -= 2;
      next.focusSpent += 2;
    } else delete next.pending;
  } else if (input.type === 'reserve') {
    next.pending = input.id;
    next.focus -= 2;
    next.focusSpent += 2;
  } else if (input.type === 'rotate') {
    const reviews = reviewsIn(next.board.jobs);
    const order = [...reviews.slice(1), reviews[0]!];
    let index = 0;
    next.board.jobs = next.board.jobs.map((job) =>
      job.stage === 'review' ? structuredClone(order[index++]) : job,
    );
  } else if (input.type === 'rush') {
    // 現行一括即処理の比較モデル。先頭2件のレビューだけ完了し、CIは省略しない。
    for (const job of next.board.jobs.filter((job) => job.stage === 'review').slice(0, 2)) {
      job.reviewLeft = 0;
    }
    next.focus -= 6;
    next.focusSpent += 6;
  } else {
    const assignees = rulesOf(next).assignees;
    const waiting = next.board.jobs.filter((job) => job.stage === 'review' && job.reviewLeft > 0);
    if (assignees <= 1) {
      for (const job of waiting.slice(1)) next.reviewWait[job.id]++;
    } else {
      const plan = assignmentPlan(waiting, assignees);
      for (const job of waiting) {
        if ((plan.get(job.id) ?? 0) === 0) next.reviewWait[job.id]++;
      }
      applyExtraReview(next.board, plan);
    }
    next.board = tickCiPrototype(next.board, 'all');
  }
  next.inputs.push(input);
  return next;
}
export function summarizePriority(state: PriorityState) {
  const done = state.board.jobs.filter((job) => job.stage === 'done');
  const value = done.reduce(
    (sum, job) => sum + (job.completedTick! <= state.deadlines[job.id] ? state.values[job.id] : 2),
    0,
  );
  const rules = rulesOf(state);
  const waitTotal = Object.values(state.reviewWait).reduce((sum, wait) => sum + wait, 0);
  return {
    value,
    netValue: value - state.focusSpent * rules.focusValue - rules.waitPenalty * waitTotal,
    focus: state.focus,
    focusSpent: state.focusSpent,
    reviewWait: state.reviewWait,
    jobs: state.board.jobs.map((job) => ({
      id: job.id,
      stage: job.stage,
      completedTick: job.completedTick,
      reviewLeft: job.reviewLeft,
      ciLeft: job.ciLeft,
    })),
    ciCost: 20 - state.board.budget,
    ciWait: state.board.queueWait,
  };
}
export function comparePriorityStrategies(seed: string | number) {
  return (['a', 'b'] as const).flatMap((urgent) =>
    (['fifo', 'promote-b', 'rush'] as const).map((strategy) => {
      const initial = createPriorityPrototype(seed, urgent);
      let state = initial;
      if (strategy === 'promote-b') state = applyPriorityInput(state, { type: 'promote', id: 'b' });
      if (strategy === 'rush') state = applyPriorityInput(state, { type: 'rush' });
      while (state.board.tick < state.board.horizon)
        state = applyPriorityInput(state, { type: 'tick' });
      return { urgent, strategy, initial, inputs: state.inputs, result: summarizePriority(state) };
    }),
  );
}
export type PriorityFactorName = keyof PriorityRules;
export type PriorityFactorLevel = PriorityRules[PriorityFactorName];
const factorLevels: Record<PriorityFactorName, readonly PriorityFactorLevel[]> = {
  assignees: [1, 2, 3, 4, 5, 6],
  reserveAfter: [0, 1, 2],
  effortB: [1, 2, 3, 4],
  deadlineB: [1, 2, 3, 4, 5, 6],
  focusValue: [1, 2, 3, 4, 5, 6],
  reactRotations: [0, 1, 2, 3],
  elapsed: [0, 1, 2, 3],
  waitPenalty: [0, 1, 2, 4, 8],
  failure: ['none', 'b', 'a', 'c'],
};
export function createPriorityFactorState(
  seed: string | number,
  rules: PriorityRules,
): PriorityState {
  const state = createPriorityPrototype(seed, 'b');
  const job = state.board.jobs.find((candidate) => candidate.id === 'b');
  if (job) job.reviewLeft = rules.effortB;
  state.deadlines.b = rules.deadlineB;
  if (rules.failure !== 'none') {
    const failing = state.board.jobs.find((candidate) => candidate.id === rules.failure);
    if (failing) failing.failFirst = true;
  }
  if (rules.elapsed > 0) {
    state.board.tick = rules.elapsed;
    for (const id of Object.keys(state.reviewWait)) state.reviewWait[id] += rules.elapsed;
  }
  state.rules = { ...rules };
  return state;
}
function rulesFor(factor: PriorityFactorName, level: PriorityFactorLevel): PriorityRules {
  return { ...baselinePriorityRules, [factor]: level };
}
export type PriorityPreference = 'move' | 'keep' | 'tie';
function preferenceOf(keepNet: number, moveNet: number): PriorityPreference {
  if (keepNet === moveNet) return 'tie';
  return moveNet > keepNet ? 'move' : 'keep';
}
function playFixed(seed: string | number, rules: PriorityRules, strategy: 'keep' | 'move') {
  let state = createPriorityFactorState(seed, rules);
  if (strategy === 'move') {
    if (rules.reserveAfter === 0) {
      state = applyPriorityInput(state, { type: 'promote', id: 'b' });
    } else {
      for (let tick = 0; tick < rules.reserveAfter; tick++)
        state = applyPriorityInput(state, { type: 'tick' });
      state = applyPriorityInput(state, { type: 'reserve', id: 'b' });
      // 進行中のレビューが終わるまで適用しない。未着手の仕事より前へは、その後にだけ移す。
      while (state.pending === 'b' && frontReviewInProgress(state)) {
        const next = applyPriorityInput(state, { type: 'tick' });
        if (next === state) break;
        state = next;
      }
      if (state.pending === 'b') state = applyPriorityInput(state, { type: 'apply', id: 'b' });
    }
    for (let turn = 0; turn < rules.reactRotations; turn++)
      state = applyPriorityInput(state, { type: 'rotate' });
  }
  while (state.board.tick < state.board.horizon) {
    const next = applyPriorityInput(state, { type: 'tick' });
    if (next === state) break;
    state = next;
  }
  return state;
}
function reportOf(state: PriorityState) {
  return { inputs: state.inputs, result: summarizePriority(state) };
}
/** 初回で移すが勝った盤面だけを、要因一つずつ動かして再計算する。固定戦略。 */
export function comparePriorityFactorReversals(seed: string | number) {
  const series = (Object.keys(factorLevels) as PriorityFactorName[]).map((factor) => ({
    factor,
    points: factorLevels[factor].map((level) => {
      const rules = rulesFor(factor, level);
      const keep = reportOf(playFixed(seed, rules, 'keep'));
      const move = reportOf(playFixed(seed, rules, 'move'));
      return {
        level,
        rules,
        preference: preferenceOf(keep.result.netValue, move.result.netValue),
        keep,
        move,
      };
    }),
  }));
  const reversals = series.flatMap((entry) => {
    const found = [];
    for (let index = 1; index < entry.points.length; index++) {
      const previous = entry.points[index - 1]!;
      const current = entry.points[index]!;
      if (previous.preference === current.preference) continue;
      found.push({
        factor: entry.factor,
        before: {
          level: previous.level,
          preference: previous.preference,
          keep: previous.keep.result.netValue,
          move: previous.move.result.netValue,
        },
        after: {
          level: current.level,
          preference: current.preference,
          keep: current.keep.result.netValue,
          move: current.move.result.netValue,
        },
      });
    }
    return found;
  });
  return {
    conditions: {
      seed,
      urgent: 'b',
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegrated: false,
      oneAtATime: true,
      incidentLottery: false,
      playerTargetLoad: false,
      preference: '差引が高い方を上とする。差引が同じなら同点。',
      net: '出荷価値 − 集中力消費 × 集中力価値 − レビュー待ち合計 × 待ち罰則。期限超過の出荷は2、未出荷は0。',
      strategies: {
        keep: 'tickのみ',
        move: '重要PR bを先頭へ移す。予約待ち0は即時。1以上は先にそのtick数だけ進め、進行中のレビューが終わってから予約を適用する。続けて、指定回数だけ先頭を末尾へ回す。',
      },
      baseline: baselinePriorityRules,
      unchanged:
        '焦点の要因以外は、6tick、Reviewの初期順a→b→c、aとcのレビュー2、CI工数2、CI1枠、予算20、集中力6、bの価値12、aとcの価値8、期限超過価値2。',
      factorNotes: {
        assignees:
          '1tickにレビューへ配る工数。先頭から1ずつ配り、余りは次の周で先頭へ積む。CI枠は1のまま。',
        reserveAfter:
          '着手前なら0で、初回と同じ即時移動。1以上は先にそのtick数だけ進めてから予約し、進行中のレビューが終わるまで適用しない。',
        effortB: 'bのレビュー工数。aとcは2。CI工数は2のまま。',
        deadlineB: 'bの期限tick。aとcは6。完了tickが期限以下なら価値12、超過して出荷すれば2。',
        focusValue: '集中力1を差引で何点と数えるか。初回は1。',
        reactRotations:
          '移動の直後に、待っていたレビューが先頭を末尾へ戻す回数。時間も集中力も消費しない。移さない側には起こらない。',
        elapsed: '着手前に過ぎたtick。残工数は減らない。各レビュー待ちに同じ数を足す。',
        waitPenalty: 'レビュー待ち1点を差引から引く。初回は0で、待ちは記録のみ。',
        failure:
          '初回CIに失敗する仕事。noneは失敗なし。開始前の公開値で、seedから乱数は引かない。失敗後の手戻りは共用CIモデルのまま。',
      },
    },
    series,
    reversals,
  };
}
