/** RI-219: 小PR憲章。size が上限を超える出荷だけを禁止する。 */

export const SMALL_PR_LIMIT = 2;

export type CharterBoard = 'safe' | 'risky';
export type CharterStrategy = 'free' | 'charter';

export interface CharterJob {
  id: string;
  size: number;
  value: number;
  risk: number;
  done: boolean;
}

export type CharterInput =
  | { type: 'adopt' }
  | { type: 'split'; id: string }
  | { type: 'ship'; id: string }
  | { type: 'wait' };

export interface CharterState {
  version: 1;
  seed: string;
  board: CharterBoard;
  tick: number;
  horizon: number;
  riskWeight: number;
  /** 省略時は1。適用する重みは riskWeight / riskDenominator。 */
  riskDenominator?: number;
  /** 省略時は SMALL_PR_LIMIT。この試作の出荷禁止と分割後の size に使う。 */
  limit?: number;
  /** 省略時は分割元の価値を2で割る。指定したときは両方の断片がこの価値。 */
  splitPieceValue?: number;
  charter: boolean;
  adoptedAt: number | null;
  jobs: CharterJob[];
  value: number;
  inputs: CharterInput[];
}

const RISK_WEIGHT: Record<CharterBoard, number> = { safe: 0, risky: 1 };

export function charterBlocks(charter: boolean, size: number, limit = SMALL_PR_LIMIT): boolean {
  return charter && size > limit;
}

function sizeLimit(state: CharterState): number {
  return state.limit ?? SMALL_PR_LIMIT;
}

function riskPenalty(state: CharterState, risk: number): number {
  const denominator = state.riskDenominator ?? 1;
  const product = risk * state.riskWeight;
  if (denominator <= 0 || product % denominator !== 0) {
    throw new Error(`RI-219 risk penalty ${product}/${denominator}`);
  }
  return product / denominator;
}

/** 既存のサイズ上限がある場合は厳しい方だけを採用し、効果は足さない。 */
export function effectiveSizeLimit(charter: boolean, existing: number | null): number | null {
  if (!charter) return existing;
  if (existing === null) return SMALL_PR_LIMIT;
  return Math.min(existing, SMALL_PR_LIMIT);
}

function createJobs(): CharterJob[] {
  return [
    { id: 'small', size: 2, value: 4, risk: 0, done: false },
    { id: 'large', size: 4, value: 10, risk: 6, done: false },
  ];
}

export function createSmallPrCharter(
  seed: string,
  board: CharterBoard,
  knob?: {
    limit?: number;
    splitPieceValue?: number;
    riskWeight?: number;
    riskDenominator?: number;
  },
): CharterState {
  const state: CharterState = {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    riskWeight: knob?.riskWeight ?? RISK_WEIGHT[board],
    charter: false,
    adoptedAt: null,
    jobs: createJobs(),
    value: 0,
    inputs: [],
  };
  if (knob?.limit !== undefined) state.limit = knob.limit;
  if (knob?.splitPieceValue !== undefined) state.splitPieceValue = knob.splitPieceValue;
  if (knob?.riskDenominator !== undefined && knob.riskDenominator !== 1) {
    state.riskDenominator = knob.riskDenominator;
  }
  return state;
}

function findJob(state: CharterState, id: string): CharterJob | undefined {
  return state.jobs.find((job) => job.id === id);
}

export function applySmallPrCharter(state: CharterState, input: CharterInput): CharterState {
  if (input.type === 'adopt') {
    if (state.charter || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.charter = true;
    next.adoptedAt = state.tick;
    next.inputs.push({ type: 'adopt' });
    return next;
  }
  if (state.tick >= state.horizon) return state;
  if (input.type === 'wait') {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'wait' });
    return next;
  }
  const job = findJob(state, input.type === 'split' || input.type === 'ship' ? input.id : '');
  if (!job || job.done) return state;
  if (input.type === 'split') {
    const limit = sizeLimit(state);
    if (!state.charter || job.size <= limit) return state;
    const next = structuredClone(state);
    const pieceValue = state.splitPieceValue ?? job.value / 2;
    next.jobs = next.jobs.filter((candidate) => candidate.id !== job.id);
    next.jobs.push(
      { id: `${job.id}-a`, size: limit, value: pieceValue, risk: 0, done: false },
      { id: `${job.id}-b`, size: limit, value: pieceValue, risk: 0, done: false },
    );
    next.tick += 1;
    next.inputs.push({ type: 'split', id: job.id });
    return next;
  }
  if (input.type !== 'ship' || charterBlocks(state.charter, job.size, sizeLimit(state))) {
    return state;
  }
  const next = structuredClone(state);
  const target = findJob(next, job.id);
  if (!target) return state;
  target.done = true;
  next.value += target.value - riskPenalty(next, target.risk);
  next.tick += 1;
  next.inputs.push({ type: 'ship', id: job.id });
  return next;
}

export function viewSmallPrCharter(state: CharterState) {
  const limit = sizeLimit(state);
  return {
    tick: state.tick,
    horizon: state.horizon,
    charter: state.charter,
    adoptedAt: state.adoptedAt,
    limit: state.charter ? limit : null,
    forbids: state.charter ? `sizeが${limit}を超える出荷` : null,
    change: '開始時のみ',
    jobs: state.jobs.map((job) => ({
      id: job.id,
      size: job.size,
      done: job.done,
      blocked: charterBlocks(state.charter, job.size, limit) && !job.done,
    })),
  };
}

export function summarizeSmallPrCharter(state: CharterState) {
  return {
    value: state.value,
    score: state.value,
    charter: state.charter,
    pending: state.jobs.filter((job) => !job.done).map((job) => job.id),
    lost: false,
  };
}

function netValue(state: CharterState, job: CharterJob): number {
  return job.value - riskPenalty(state, job.risk);
}

export function chooseCharterAction(state: CharterState, strategy: CharterStrategy): CharterInput {
  if (strategy === 'charter' && !state.charter) return { type: 'adopt' };
  const open = state.jobs.filter((job) => !job.done);
  const blocked = open.find((job) => charterBlocks(state.charter, job.size, sizeLimit(state)));
  if (blocked) return { type: 'split', id: blocked.id };
  const next = [...open].sort(
    (a, b) => netValue(state, b) - netValue(state, a) || a.id.localeCompare(b.id),
  )[0];
  if (!next) return { type: 'wait' };
  return { type: 'ship', id: next.id };
}

function runCharter(initial: CharterState, strategy: CharterStrategy): CharterState {
  let state = initial;
  let guard = 0;
  const label = `${state.seed}:${state.board}:${strategy}`;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(label);
    const input = chooseCharterAction(state, strategy);
    const next = applySmallPrCharter(state, input);
    if (next === state) throw new Error(`${label}@${state.tick}`);
    state = next;
  }
  return state;
}

export function compareSmallPrCharters(seed = 'RI-219') {
  return (['safe', 'risky'] as const).flatMap((board) =>
    (['free', 'charter'] as const).map((strategy) => {
      const initial = createSmallPrCharter(seed, board);
      const state = runCharter(initial, strategy);
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeSmallPrCharter(state),
      };
    }),
  );
}

type CharterPreference = 'free' | 'charter' | 'tie';
type CharterFactor = 'limit' | 'splitPieceValue' | 'riskWeight';
type ReversalKind = 'switch' | 'appear' | 'vanish';

const LIMIT_LEVELS = [1, 2, 3, 4] as const;
const SPLIT_LEVELS = [3, 4, 5, 6, 7, 8] as const;
const RISK_LEVELS = [
  { level: '0', board: 'safe', riskWeight: 0, riskDenominator: 1 },
  { level: '1/2', board: 'safe', riskWeight: 1, riskDenominator: 2 },
  { level: '2/3', board: 'safe', riskWeight: 2, riskDenominator: 3 },
  { level: '1', board: 'risky', riskWeight: 1, riskDenominator: 1 },
  { level: '2', board: 'safe', riskWeight: 2, riskDenominator: 1 },
] as const;

function preferenceOf(free: number, charter: number): CharterPreference {
  if (free === charter) return 'tie';
  return free > charter ? 'free' : 'charter';
}

function reversalKind(before: CharterPreference, after: CharterPreference): ReversalKind | null {
  if (before === after) return null;
  const sided = (value: CharterPreference) => value === 'free' || value === 'charter';
  if (sided(before) && sided(after)) return 'switch';
  if (before === 'tie' && sided(after)) return 'appear';
  if (sided(before) && after === 'tie') return 'vanish';
  return null;
}

function changedKnobs(state: CharterState): CharterFactor[] {
  const changed: CharterFactor[] = [];
  if ((state.limit ?? SMALL_PR_LIMIT) !== SMALL_PR_LIMIT) changed.push('limit');
  if (state.splitPieceValue !== undefined) changed.push('splitPieceValue');
  const denominator = state.riskDenominator ?? 1;
  if (state.riskWeight !== RISK_WEIGHT[state.board] || denominator !== 1)
    changed.push('riskWeight');
  return changed;
}

function assertFactorState(state: CharterState, factor: CharterFactor, seed: string) {
  const baseline = createSmallPrCharter(seed, state.board);
  if (state.seed !== seed || state.horizon !== baseline.horizon || state.version !== 1) {
    throw new Error(`RI-219 factor resource ${factor}`);
  }
  if (JSON.stringify(state.jobs) !== JSON.stringify(baseline.jobs)) {
    throw new Error(`RI-219 factor jobs ${factor}`);
  }
  const changed = changedKnobs(state);
  if (changed.length > 1 || (changed[0] !== undefined && changed[0] !== factor)) {
    throw new Error(`RI-219 factor drift ${factor}:${changed.join(',')}`);
  }
}

function factorPoint(
  seed: string,
  factor: CharterFactor,
  board: CharterBoard | 'jobs',
  level: number | string,
  initial: CharterState,
) {
  assertFactorState(initial, factor, seed);
  const free = runCharter(structuredClone(initial), 'free');
  const charter = runCharter(structuredClone(initial), 'charter');
  const freeResult = summarizeSmallPrCharter(free);
  const charterResult = summarizeSmallPrCharter(charter);
  return {
    factor,
    board,
    level,
    changed: changedKnobs(initial),
    preference: preferenceOf(freeResult.score, charterResult.score),
    initial,
    free: { inputs: free.inputs, result: freeResult },
    charter: { inputs: charter.inputs, result: charterResult },
  };
}

type FactorPoint = ReturnType<typeof factorPoint>;

function reversalsOf(points: FactorPoint[]) {
  const found: {
    factor: CharterFactor;
    board: CharterBoard | 'jobs';
    kind: ReversalKind;
    before: {
      level: number | string;
      preference: CharterPreference;
      free: number;
      charter: number;
    };
    after: { level: number | string; preference: CharterPreference; free: number; charter: number };
  }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after || before.board !== after.board) continue;
    const kind = reversalKind(before.preference, after.preference);
    if (!kind) continue;
    found.push({
      factor: before.factor,
      board: before.board,
      kind,
      before: {
        level: before.level,
        preference: before.preference,
        free: before.free.result.score,
        charter: before.charter.result.score,
      },
      after: {
        level: after.level,
        preference: after.preference,
        free: after.free.result.score,
        charter: after.charter.result.score,
      },
    });
  }
  return found;
}

/**
 * 初回と同じ2件・期末3の上で、上限、分割後の1件の価値、リスク重みを一つずつ動かす。
 * 固定戦略の計算。初回の4行は再比較しない。
 */
export function compareCharterFactorReversals(seed = 'RI-219') {
  const limit = (['safe', 'risky'] as const).map((board) =>
    LIMIT_LEVELS.map((level) =>
      factorPoint(
        seed,
        'limit',
        board,
        level,
        createSmallPrCharter(seed, board, level === SMALL_PR_LIMIT ? undefined : { limit: level }),
      ),
    ),
  );
  const splitPieceValue = (['safe', 'risky'] as const).map((board) =>
    SPLIT_LEVELS.map((level) =>
      factorPoint(
        seed,
        'splitPieceValue',
        board,
        level,
        createSmallPrCharter(seed, board, level === 5 ? undefined : { splitPieceValue: level }),
      ),
    ),
  );
  const riskWeight = RISK_LEVELS.map((level) =>
    factorPoint(
      seed,
      'riskWeight',
      'jobs',
      level.level,
      createSmallPrCharter(
        seed,
        level.board,
        level.riskDenominator === 1 && level.riskWeight === RISK_WEIGHT[level.board]
          ? undefined
          : { riskWeight: level.riskWeight, riskDenominator: level.riskDenominator },
      ),
    ),
  );
  const sweeps = {
    limit: { safe: limit[0] ?? [], risky: limit[1] ?? [] },
    splitPieceValue: { safe: splitPieceValue[0] ?? [], risky: splitPieceValue[1] ?? [] },
    riskWeight,
  };
  return {
    conditions: {
      seed,
      horizon: 3,
      jobs: [
        { id: 'small', size: 2, value: 4, risk: 0 },
        { id: 'large', size: 4, value: 10, risk: 6 },
      ],
      baseline: {
        limit: SMALL_PR_LIMIT,
        splitPieceValue: 5,
        riskWeight: { safe: 0, risky: 1 },
      },
      score: '出荷価値からリスク×重みを引く。分割した断片のリスクは0。敗北は置かない',
      preference: '差引が大きい方を上とする。同じなら同点',
      reversalKind: {
        switch: '禁止する判断と禁止しない判断が入れ替わる',
        appear: '同点から一方が上回る',
        vanish: '一方の優位が同点に戻る',
      },
      strategies: {
        free: '憲章を採らず、差引の高い未完了から出荷する',
        charter:
          '開始時に憲章を採り、上限を超える未完了を配列順に分割してから、差引の高い未完了を出荷する',
      },
      held: {
        limit: '上限以外を動かすときは2。断片のsizeは上限。水準2は初回の状態のまま',
        splitPieceValue:
          '分割価値以外を動かすときは元の価値の半分。大きい仕事は5。水準5は初回の状態のまま',
        riskWeight:
          '重み以外を動かすときは盤面どおり。0は安全、1は危険の初回状態。適用値は riskWeight / (riskDenominator ?? 1)',
      },
      levels: {
        limit: [...LIMIT_LEVELS],
        splitPieceValue: [...SPLIT_LEVELS],
        riskWeight: RISK_LEVELS.map((level) => level.level),
      },
      oneAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      repeatedFirstComparison: false,
      productionIntegrated: false,
      sharedProhibition: 'charterBlocksの第3引数を省略すると上限2',
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.limit.safe),
      ...reversalsOf(sweeps.limit.risky),
      ...reversalsOf(sweeps.splitPieceValue.safe),
      ...reversalsOf(sweeps.splitPieceValue.risky),
      ...reversalsOf(sweeps.riskWeight),
    ],
  };
}
