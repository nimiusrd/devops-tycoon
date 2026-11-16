import { getCard } from '../data/cards';
import { createRng } from '../sim/rng';

export type ReviewMode = 'human' | 'coefficient' | 'dedicated';
export type ReviewStage = 'bot' | 'human' | 'verification' | 'done';
export type FallbackPriority = 'fallbackLast' | 'fifo' | 'fallbackFirst';
export type FalsePositivePlacement = 'seed' | 'back' | 'burst' | 'front';

export interface ReviewJob {
  id: number;
  kind: 'routine' | 'complex';
  value: number;
  stage: ReviewStage;
  humanLeft: number;
  botLeft: number;
  falsePositive: boolean;
  route: 'human' | 'bot' | 'fallback';
  humanQueuedAt: number | null;
}

export interface ReviewBotState {
  version: 1;
  tick: number;
  deadline: number;
  mode: ReviewMode;
  coefficient: number;
  fallbackPriority: FallbackPriority;
  jobs: ReviewJob[];
  humanSpent: number;
  botSpent: number;
  triageSpent: number;
  falsePositives: number;
}

export interface ReviewBotCreateOptions {
  deadline?: number;
  fallbackPriority?: FallbackPriority;
  falsePositivePlacement?: FalsePositivePlacement;
}

/** 見逃し判定の試作値。誤検知とは別の乱数列で、手戻り工程には使わない。 */
export const REVIEW_BOT_MISS_RATE = 0.25;
export const REVIEW_BOT_BASELINE_DEADLINE = 12;
export const REVIEW_BOT_BASELINE_SEED = 'RI-177';

/** 各案件を独立に判定する。Botのまま出荷した案件だけを見逃しに数える。 */
export function reviewBotLatentMisses(seed: string | number, jobCount: number): boolean[] {
  const rng = createRng(`${seed}:miss`);
  return Array.from({ length: jobCount }, () => rng() < REVIEW_BOT_MISS_RATE);
}

function placeFalsePositives(
  kinds: readonly ReviewJob['kind'][],
  flagged: readonly boolean[],
  placement: FalsePositivePlacement,
): boolean[] {
  if (placement === 'seed') return [...flagged];
  const routine = kinds.flatMap((kind, index) => (kind === 'routine' ? [index] : []));
  const count = routine.filter((index) => flagged[index]).length;
  const chosen = new Set<number>();
  if (placement === 'front') {
    for (const index of routine.slice(0, count)) chosen.add(index);
  } else if (placement === 'back') {
    for (const index of routine.slice(Math.max(0, routine.length - count))) chosen.add(index);
  } else {
    const start = Math.max(0, Math.floor((routine.length - count) / 2));
    for (const index of routine.slice(start, start + count)) chosen.add(index);
  }
  return flagged.map((flag, index) => (kinds[index] === 'routine' ? chosen.has(index) : flag));
}

/** 実装済みPRだけの固定盤面。3枠のうち専用経路では1枠をBot運用へ移す。 */
export function createReviewBotPrototype(
  seed: string | number,
  kinds: ReviewJob['kind'][],
  mode: ReviewMode,
  options: ReviewBotCreateOptions = {},
): ReviewBotState {
  const rng = createRng(seed);
  const placement = options.falsePositivePlacement ?? 'seed';
  const flagged = placeFalsePositives(
    kinds,
    kinds.map(() => rng() < 0.25),
    placement,
  );
  return {
    version: 1,
    tick: 0,
    deadline: options.deadline ?? REVIEW_BOT_BASELINE_DEADLINE,
    mode,
    coefficient: getCard('review-bot')!.base.reviewEfficiencyMul!,
    fallbackPriority: options.fallbackPriority ?? 'fifo',
    jobs: kinds.map((kind, id) => ({
      id,
      kind,
      value: kind === 'routine' ? 2 : 5,
      stage: mode === 'dedicated' && kind === 'routine' ? 'bot' : 'human',
      humanLeft: kind === 'routine' ? 3 : 6,
      botLeft: 1,
      falsePositive: flagged[id] ?? false,
      route: mode === 'dedicated' && kind === 'routine' ? 'bot' : 'human',
      humanQueuedAt: mode === 'dedicated' && kind === 'routine' ? null : 0,
    })),
    humanSpent: 0,
    botSpent: 0,
    triageSpent: 0,
    falsePositives: 0,
  };
}

function compareHumanQueue(priority: FallbackPriority, left: ReviewJob, right: ReviewJob): number {
  if (priority !== 'fifo') {
    const fallbackRank = (job: ReviewJob) => (job.route === 'fallback' ? 1 : 0);
    const delta = fallbackRank(left) - fallbackRank(right);
    if (delta !== 0) return priority === 'fallbackFirst' ? -delta : delta;
  }
  return left.humanQueuedAt! - right.humanQueuedAt! || left.id - right.id;
}

/** Bot結果・人間レビューから最終検証へは次tickに移る。 */
export function tickReviewBotPrototype(state: ReviewBotState): ReviewBotState {
  if (state.tick >= state.deadline) return state;
  const next = { ...state, tick: state.tick + 1, jobs: state.jobs.map((job) => ({ ...job })) };
  let human = state.mode === 'dedicated' ? 2 : 3;
  if (state.mode === 'coefficient') human *= state.coefficient;
  let bot = state.mode === 'dedicated' ? 2 : 0;
  let verification = 2;
  // 専用経路を準備する初期費用。最初のtickは人間レビュー2工数を譲る。
  if (state.mode === 'dedicated' && state.tick === 0) {
    next.humanSpent += human;
    human = 0;
  }
  const jobs = state.jobs.map((job, index) => ({ job, index }));
  const processingOrder = [
    ...jobs.filter(({ job }) => job.stage === 'bot'),
    ...jobs
      .filter(({ job }) => job.stage === 'human')
      .sort((a, b) => compareHumanQueue(state.fallbackPriority ?? 'fifo', a.job, b.job)),
    ...jobs.filter(({ job }) => job.stage === 'verification'),
  ];
  for (const { index: i } of processingOrder) {
    const before = state.jobs[i];
    const job = next.jobs[i];
    if (before.stage === 'bot') {
      const work = Math.min(bot, before.botLeft);
      job.botLeft -= work;
      bot -= work;
      next.botSpent += work;
      if (job.botLeft === 0) {
        if (job.falsePositive) {
          job.stage = 'human';
          job.route = 'fallback';
          job.humanLeft += 1;
          job.humanQueuedAt = next.tick;
          next.falsePositives += 1;
        } else {
          job.stage = 'verification';
        }
      }
    } else if (before.stage === 'human') {
      const work = Math.min(human, before.humanLeft);
      // 誤検知の仕分けは追加1工数から先に消費。通常レビューと分けて記録する。
      if (before.route === 'fallback' && before.humanLeft > 3) {
        next.triageSpent += Math.min(work, before.humanLeft - 3);
      }
      job.humanLeft = Math.max(0, before.humanLeft - work);
      if (job.humanLeft < 1e-9) job.humanLeft = 0;
      human -= work;
      next.humanSpent += work;
      if (job.humanLeft === 0) job.stage = 'verification';
    } else if (before.stage === 'verification' && verification > 0) {
      job.stage = 'done';
      verification -= 1;
    }
  }
  return next;
}

export function summarizeReviewBot(state: ReviewBotState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  return {
    delivered: done.reduce((total, job) => total + job.value, 0),
    completed: done.length,
    botCompleted: done.filter((job) => job.route === 'bot').length,
    humanCompleted: done.filter((job) => job.route === 'human').length,
    fallbackCompleted: done.filter((job) => job.route === 'fallback').length,
    pending: state.jobs.length - done.length,
    humanSpent: Math.round(state.humanSpent * 100) / 100,
    botSpent: state.botSpent,
    falsePositives: state.falsePositives,
    triageSpent: state.triageSpent,
  };
}

export function compareReviewBotStrategies(seed: string | number, kinds: ReviewJob['kind'][]) {
  return (['human', 'coefficient', 'dedicated'] as const).map((mode) => {
    let state = createReviewBotPrototype(seed, kinds, mode);
    while (state.tick < state.deadline) state = tickReviewBotPrototype(state);
    return { mode, ...summarizeReviewBot(state) };
  });
}

export type ReviewBoard = 'routine' | 'complex' | 'mixed';
export type ReviewPreference = 'dedicated' | 'coefficient' | 'tie';
export type ReviewFactorScoreName = 'delivered' | 'quality';

export interface ReviewBotFactorRules {
  deadline: number;
  fallbackPriority: FallbackPriority;
  falsePositivePlacement: FalsePositivePlacement;
  missPenalty: number;
}

export const reviewBotFactorBaseline: ReviewBotFactorRules = {
  deadline: REVIEW_BOT_BASELINE_DEADLINE,
  fallbackPriority: 'fifo',
  falsePositivePlacement: 'seed',
  missPenalty: 0,
};

/** 初回比較と同じ20件。混合は complex, routine, routine の繰り返し。 */
export function reviewBotBoardKinds(board: ReviewBoard): ReviewJob['kind'][] {
  if (board === 'routine') return Array.from({ length: 20 }, () => 'routine');
  if (board === 'complex') return Array.from({ length: 20 }, () => 'complex');
  return Array.from({ length: 20 }, (_, index) => (index % 3 === 0 ? 'complex' : 'routine'));
}

export interface ReviewBotFactorScore {
  delivered: number;
  completed: number;
  botCompleted: number;
  humanCompleted: number;
  fallbackCompleted: number;
  pending: number;
  humanSpent: number;
  botSpent: number;
  falsePositives: number;
  triageSpent: number;
  scheduledFalsePositives: number;
  missed: number;
  quality: number;
}

/** 固定戦略で期末まで進める。見逃しは出荷後の指標で、工程は変えない。 */
export function scoreReviewBotFactor(
  seed: string | number,
  kinds: readonly ReviewJob['kind'][],
  mode: ReviewMode,
  rules: ReviewBotFactorRules,
  countMisses = false,
): ReviewBotFactorScore {
  let state = createReviewBotPrototype(seed, [...kinds], mode, {
    deadline: rules.deadline,
    fallbackPriority: rules.fallbackPriority,
    falsePositivePlacement: rules.falsePositivePlacement,
  });
  const scheduledFalsePositives = state.jobs.filter(
    (job) => job.kind === 'routine' && job.falsePositive,
  ).length;
  while (state.tick < state.deadline) state = tickReviewBotPrototype(state);
  const summary = summarizeReviewBot(state);
  const latent = countMisses ? reviewBotLatentMisses(seed, state.jobs.length) : [];
  const missed = countMisses
    ? state.jobs.filter((job) => job.stage === 'done' && job.route === 'bot' && latent[job.id])
        .length
    : 0;
  return {
    ...summary,
    scheduledFalsePositives,
    missed,
    quality: summary.delivered - rules.missPenalty * missed,
  };
}

export interface ReviewBotFactorOutcome {
  delivered: number;
  botCompleted: number;
  fallbackCompleted: number;
  falsePositives: number;
  scheduledFalsePositives: number;
  triageSpent: number;
  missed: number;
  quality: number;
}

export interface ReviewBotFactorPoint {
  parameter: string;
  board: ReviewBoard;
  seed: string;
  preference: ReviewPreference;
  margin: number;
  coefficient: ReviewBotFactorOutcome;
  dedicated: ReviewBotFactorOutcome;
}

export interface ReviewBotFactorReversal {
  axis: string;
  board: ReviewBoard;
  before: {
    parameter: string;
    preference: ReviewPreference;
    coefficient: number;
    dedicated: number;
  };
  after: {
    parameter: string;
    preference: ReviewPreference;
    coefficient: number;
    dedicated: number;
  };
}

const REVIEW_BOARDS: readonly ReviewBoard[] = ['routine', 'complex', 'mixed'];
const REVIEW_BOT_FACTOR_SEEDS = [
  REVIEW_BOT_BASELINE_SEED,
  ...Array.from({ length: 31 }, (_, index) => `RI-177-${index + 1}`),
];
const REVIEW_BOT_FACTOR_DEADLINES = Array.from({ length: 62 }, (_, index) => index + 1);
const REVIEW_BOT_FACTOR_PLACEMENTS: readonly FalsePositivePlacement[] = [
  'seed',
  'back',
  'burst',
  'front',
];
const REVIEW_BOT_FACTOR_PRIORITIES: readonly FallbackPriority[] = [
  'fallbackLast',
  'fifo',
  'fallbackFirst',
];
const REVIEW_BOT_FACTOR_PENALTIES = Array.from({ length: 14 }, (_, index) => index);

function preferenceOf(coefficient: number, dedicated: number): ReviewPreference {
  if (dedicated > coefficient) return 'dedicated';
  if (coefficient > dedicated) return 'coefficient';
  return 'tie';
}

function outcomeOf(score: ReviewBotFactorScore): ReviewBotFactorOutcome {
  return {
    delivered: score.delivered,
    botCompleted: score.botCompleted,
    fallbackCompleted: score.fallbackCompleted,
    falsePositives: score.falsePositives,
    scheduledFalsePositives: score.scheduledFalsePositives,
    triageSpent: score.triageSpent,
    missed: score.missed,
    quality: score.quality,
  };
}

function factorPoint(
  parameter: string,
  board: ReviewBoard,
  seed: string,
  rules: ReviewBotFactorRules,
  scoreName: ReviewFactorScoreName,
): ReviewBotFactorPoint {
  const kinds = reviewBotBoardKinds(board);
  const countMisses = scoreName === 'quality';
  const coefficient = outcomeOf(
    scoreReviewBotFactor(seed, kinds, 'coefficient', rules, countMisses),
  );
  const dedicated = outcomeOf(scoreReviewBotFactor(seed, kinds, 'dedicated', rules, countMisses));
  const coefficientScore = coefficient[scoreName];
  const dedicatedScore = dedicated[scoreName];
  return {
    parameter,
    board,
    seed,
    preference: preferenceOf(coefficientScore, dedicatedScore),
    margin: dedicatedScore - coefficientScore,
    coefficient,
    dedicated,
  };
}

function reversalsOf(
  axis: string,
  scoreName: ReviewFactorScoreName,
  rows: readonly ReviewBotFactorPoint[],
): ReviewBotFactorReversal[] {
  const found: ReviewBotFactorReversal[] = [];
  for (const board of REVIEW_BOARDS) {
    const series = rows.filter((row) => row.board === board);
    for (let index = 1; index < series.length; index += 1) {
      const before = series[index - 1];
      const after = series[index];
      if (!before || !after || before.preference === after.preference) continue;
      found.push({
        axis,
        board,
        before: {
          parameter: before.parameter,
          preference: before.preference,
          coefficient: before.coefficient[scoreName],
          dedicated: before.dedicated[scoreName],
        },
        after: {
          parameter: after.parameter,
          preference: after.preference,
          coefficient: after.coefficient[scoreName],
          dedicated: after.dedicated[scoreName],
        },
      });
    }
  }
  return found;
}

function factorSweep(axis: string, scoreName: ReviewFactorScoreName, rows: ReviewBotFactorPoint[]) {
  return { score: scoreName, reversals: reversalsOf(axis, scoreName, rows), rows };
}

/** 初回と同じ資源で要因を一つずつ動かす。固定戦略で、人間のみの経路は再計算しない。 */
export function compareReviewBotFactorReversals() {
  const seedRows = REVIEW_BOARDS.flatMap((board) =>
    REVIEW_BOT_FACTOR_SEEDS.map((seed) =>
      factorPoint(seed, board, seed, reviewBotFactorBaseline, 'delivered'),
    ),
  );
  const placementRows = REVIEW_BOARDS.flatMap((board) =>
    REVIEW_BOT_FACTOR_PLACEMENTS.map((placement) =>
      factorPoint(
        placement,
        board,
        REVIEW_BOT_BASELINE_SEED,
        { ...reviewBotFactorBaseline, falsePositivePlacement: placement },
        'delivered',
      ),
    ),
  );
  const deadlineRows = REVIEW_BOARDS.flatMap((board) =>
    REVIEW_BOT_FACTOR_DEADLINES.map((deadline) =>
      factorPoint(
        String(deadline),
        board,
        REVIEW_BOT_BASELINE_SEED,
        { ...reviewBotFactorBaseline, deadline },
        'delivered',
      ),
    ),
  );
  const priorityRows = REVIEW_BOARDS.flatMap((board) =>
    REVIEW_BOT_FACTOR_PRIORITIES.map((fallbackPriority) =>
      factorPoint(
        fallbackPriority,
        board,
        REVIEW_BOT_BASELINE_SEED,
        { ...reviewBotFactorBaseline, fallbackPriority },
        'delivered',
      ),
    ),
  );
  const penaltyRows = REVIEW_BOARDS.flatMap((board) =>
    REVIEW_BOT_FACTOR_PENALTIES.map((missPenalty) =>
      factorPoint(
        String(missPenalty),
        board,
        REVIEW_BOT_BASELINE_SEED,
        { ...reviewBotFactorBaseline, missPenalty },
        'quality',
      ),
    ),
  );
  return {
    conditions: {
      seed: REVIEW_BOT_BASELINE_SEED,
      seeds: [...REVIEW_BOT_FACTOR_SEEDS],
      deadlines: [...REVIEW_BOT_FACTOR_DEADLINES],
      placements: [...REVIEW_BOT_FACTOR_PLACEMENTS],
      priorities: [...REVIEW_BOT_FACTOR_PRIORITIES],
      penalties: [...REVIEW_BOT_FACTOR_PENALTIES],
      jobs: 20,
      deadline: REVIEW_BOT_BASELINE_DEADLINE,
      humanSlots: 3,
      coefficient: getCard('review-bot')!.base.reviewEfficiencyMul!,
      dedicatedHuman: 2,
      dedicatedBot: 2,
      verification: 2,
      prepHuman: 2,
      falsePositiveRate: 0.25,
      missRate: REVIEW_BOT_MISS_RATE,
      boards: {
        routine: reviewBotBoardKinds('routine'),
        complex: reviewBotBoardKinds('complex'),
        mixed: reviewBotBoardKinds('mixed'),
      },
      score: {
        seed: 'delivered' as const,
        placement: 'delivered' as const,
        deadline: 'delivered' as const,
        fallbackPriority: 'delivered' as const,
        missPenalty: 'quality' as const,
      },
      held: {
        seed: '期限12、誤検知はseedの位置、差戻しは到着順、罰0。盤面だけ共通',
        placement: '誤検知の件数はseedのまま、routineの位置だけ先頭・中央・末尾へ寄せる',
        deadline: 'seed RI-177、位置と差戻しと罰は基準。期限だけ1から62',
        fallbackPriority: '期限12、seedの位置。差戻しを後回し、到着順、先に処理する順',
        missPenalty: '見逃しは別乱数。出荷は変えず、Bot出荷の見逃し件数×罰だけ品質から引く',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      singleSeedProductionCoefficients: false,
      repeatedFirstComparison: false,
      normalRun: false,
    },
    sweeps: {
      seed: factorSweep('seed', 'delivered', seedRows),
      placement: factorSweep('placement', 'delivered', placementRows),
      deadline: factorSweep('deadline', 'delivered', deadlineRows),
      fallbackPriority: factorSweep('fallbackPriority', 'delivered', priorityRows),
      missPenalty: factorSweep('missPenalty', 'quality', penaltyRows),
    },
  };
}
