/** RI-210: 紙上の面接比較。通常ラン・採用画面・保存schemaには接続しない。 */
import { RECRUIT_ARCHETYPES } from '../data/members';
import { foldTraitModifiers } from '../data/traits';
import { createRng, randInt } from '../sim/rng';

export const INTERVIEW_TOPICS = ['implementation', 'review', 'learning'] as const;
export type RecruitTopic = (typeof INTERVIEW_TOPICS)[number];
export type InterviewMode = 'precision' | 'additional';
export type InterviewStrategy = 'none' | RecruitTopic | 'two';
type Scores = Record<RecruitTopic, number>;
type Range = { low: number; high: number };
export interface RecruitInterviewRules {
  fee: number;
  spread: number;
  opportunityPerTick: number;
}
interface Candidate {
  id: string;
  rank: string;
  traits: string[];
  stats: { implementation: number; review: number; aiMastery: number };
  anchors: Scores;
  sample: Scores;
}
export type RecruitInterviewInput =
  { type: 'view' } | { type: 'ask'; topic: RecruitTopic } | { type: 'hire'; id: string };
export interface RecruitInterviewState {
  version: 1;
  seed: string;
  mode: InterviewMode;
  demand: RecruitTopic;
  rules: RecruitInterviewRules;
  initialBudget: number;
  budget: number;
  ticks: number;
  horizon: number;
  candidates: Candidate[];
  asked: RecruitTopic[];
  hired: string | null;
  inputs: RecruitInterviewInput[];
}
const CANDIDATES = ['recruit-ai-prodigy', 'recruit-doc', 'recruit-mega'];
const DEFAULT_RULES: RecruitInterviewRules = { fee: 2, spread: 18, opportunityPerTick: 2 };
const STRATEGIES: InterviewStrategy[] = ['none', ...INTERVIEW_TOPICS, 'two'];

export function createRecruitInterview(
  seed: string,
  mode: InterviewMode,
  demand: RecruitTopic,
  overrides: Partial<RecruitInterviewRules> = {},
): RecruitInterviewState {
  const rules = { ...DEFAULT_RULES, ...overrides };
  if (
    Object.values(rules).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    rules.spread > 40
  )
    throw new Error('面接係数は非負整数、振れ幅は40以下');
  const candidates = CANDIDATES.map((id) => {
    const archetype = RECRUIT_ARCHETYPES.find((item) => item.id === id);
    if (!archetype) throw new Error(id);
    const { xpMul } = foldTraitModifiers(archetype.traits);
    // learningは試作専用の説明用指標。実際の学習速度や新しい本番能力ではない。
    const anchors = {
      implementation: archetype.stats.implementation,
      review: archetype.stats.review,
      learning: 40 * xpMul,
    };
    const sample = { ...anchors };
    for (const topic of INTERVIEW_TOPICS) {
      const rng = createRng(`${seed}:ri210:${id}:${topic}`);
      sample[topic] = anchors[topic] + randInt(rng, -rules.spread, rules.spread);
    }
    return {
      id,
      rank: archetype.rank,
      traits: [...archetype.traits],
      stats: { ...archetype.stats },
      anchors,
      sample,
    };
  });
  return {
    version: 1,
    seed,
    mode,
    demand,
    rules,
    initialBudget: 12,
    budget: 12,
    ticks: 0,
    horizon: 3,
    candidates,
    asked: [],
    hired: null,
    inputs: [],
  };
}

function coarse(value: number): Range {
  const low = Math.floor(value / 20) * 20;
  return { low, high: low + 19 };
}
function exact(value: number): Range {
  return { low: value, high: value };
}
function weights(demand: RecruitTopic): Scores {
  return {
    implementation: demand === 'implementation' ? 3 : 1,
    review: demand === 'review' ? 3 : 1,
    learning: demand === 'learning' ? 3 : 1,
  };
}
function weighted(scores: Scores, demand: RecruitTopic): number {
  const weight = weights(demand);
  return INTERVIEW_TOPICS.reduce((sum, topic) => sum + scores[topic] * weight[topic], 0) / 5;
}

/** 公開情報だけ。未確認のsample、seed、内部anchorsを公開しない。 */
export function viewRecruitInterview(state: RecruitInterviewState) {
  return {
    mode: state.mode,
    demand: state.demand,
    weights: weights(state.demand),
    budget: state.budget,
    ticks: state.ticks,
    horizon: state.horizon,
    fee: state.rules.fee,
    opportunityPerTick: state.rules.opportunityPerTick,
    maxQuestions: 2,
    asked: [...state.asked],
    hired: state.hired,
    candidates: state.candidates.map((candidate) => {
      const evidence = {} as Record<RecruitTopic, Range>;
      for (const topic of INTERVIEW_TOPICS) {
        const anchor =
          state.mode === 'additional' || state.asked.includes(topic)
            ? exact(candidate.anchors[topic])
            : coarse(candidate.anchors[topic]);
        evidence[topic] = state.asked.includes(topic)
          ? exact(candidate.sample[topic])
          : { low: anchor.low - state.rules.spread, high: anchor.high + state.rules.spread };
      }
      return {
        id: candidate.id,
        rank: candidate.rank,
        traits: [...candidate.traits],
        stats:
          state.mode === 'additional'
            ? { ...candidate.stats }
            : {
                implementation: state.asked.includes('implementation')
                  ? exact(candidate.stats.implementation)
                  : coarse(candidate.stats.implementation),
                review: state.asked.includes('review')
                  ? exact(candidate.stats.review)
                  : coarse(candidate.stats.review),
                aiMastery: coarse(candidate.stats.aiMastery),
              },
        evidence,
      };
    }),
  };
}

export function applyRecruitInterview(
  state: RecruitInterviewState,
  input: RecruitInterviewInput,
): RecruitInterviewState {
  if (input.type === 'view' || state.hired !== null) return state;
  if (input.type === 'ask') {
    if (
      !INTERVIEW_TOPICS.includes(input.topic) ||
      state.asked.includes(input.topic) ||
      state.asked.length >= 2 ||
      state.ticks >= state.horizon - 1 ||
      state.budget < state.rules.fee
    )
      return state;
  } else if (!state.candidates.some((item) => item.id === input.id)) return state;
  const next = structuredClone(state);
  if (input.type === 'ask') {
    next.asked.push(input.topic);
    next.budget -= state.rules.fee;
    next.ticks += 1;
  } else next.hired = input.id;
  next.inputs.push({ ...input });
  return next;
}

/** 問い順は固定。候補の選択だけ公開区間の中点を用いる（全知の最適化ではない）。 */
export function chooseRecruitInterviewAction(
  state: RecruitInterviewState,
  strategy: InterviewStrategy,
): RecruitInterviewInput {
  const view = viewRecruitInterview(state);
  if (view.hired !== null) return { type: 'view' };
  const questions =
    strategy === 'none'
      ? []
      : strategy === 'two'
        ? [view.demand, ...INTERVIEW_TOPICS.filter((topic) => topic !== view.demand)].slice(0, 2)
        : [strategy];
  const topic = questions.find((item) => !view.asked.includes(item));
  if (topic && view.budget >= view.fee && view.asked.length < 2 && view.ticks < view.horizon - 1)
    return { type: 'ask', topic };
  const estimates = view.candidates.map((candidate) => {
    const scores = {} as Scores;
    for (const topic of INTERVIEW_TOPICS) {
      const range = candidate.evidence[topic];
      scores[topic] = (range.low + range.high) / 2;
    }
    return { id: candidate.id, score: weighted(scores, view.demand) };
  });
  // 同点は既存候補順。非公開情報をタイブレークに使わない。
  estimates.sort((a, b) => b.score - a.score);
  return { type: 'hire', id: estimates[0]!.id };
}

export function summarizeRecruitInterview(state: RecruitInterviewState) {
  const candidate = state.candidates.find((item) => item.id === state.hired);
  const gross = candidate ? weighted(candidate.sample, state.demand) : 0;
  const fee = state.initialBudget - state.budget;
  const opportunity = state.ticks * state.rules.opportunityPerTick;
  return {
    hired: state.hired,
    gross,
    fee,
    opportunity,
    net: gross - fee - opportunity,
    budget: state.budget,
    workTicksLeft: state.horizon - state.ticks,
    unasked: INTERVIEW_TOPICS.filter((topic) => !state.asked.includes(topic)),
  };
}

export function runRecruitInterview(initial: RecruitInterviewState, strategy: InterviewStrategy) {
  let state = initial;
  for (let guard = 0; guard < 3 && state.hired === null; guard += 1)
    state = applyRecruitInterview(state, chooseRecruitInterviewAction(state, strategy));
  if (state.hired === null) throw new Error('面接を終了できない');
  return { inputs: state.inputs, result: summarizeRecruitInterview(state) };
}

function compare(seeds: string[], rules: Partial<RecruitInterviewRules> = {}) {
  // seedごとの全状態を一度保存。案と需要だけを変え、同じ候補・課題・資源で比較する。
  const initial = seeds.map((seed) =>
    createRecruitInterview(seed, 'additional', 'implementation', rules),
  );
  const runs = initial.flatMap((state, initialIndex) =>
    (['precision', 'additional'] as const).flatMap((mode) =>
      INTERVIEW_TOPICS.flatMap((demand) =>
        STRATEGIES.map((strategy) => ({
          initialIndex,
          mode,
          demand,
          strategy,
          ...runRecruitInterview({ ...state, mode, demand }, strategy),
        })),
      ),
    ),
  );
  const summary = (['precision', 'additional'] as const).flatMap((mode) =>
    INTERVIEW_TOPICS.map((demand) => {
      const strategies = STRATEGIES.map((strategy) => {
        const rows = runs.filter(
          (run) => run.strategy === strategy && run.mode === mode && run.demand === demand,
        );
        const mean = (field: 'net' | 'gross') =>
          rows.reduce((sum, row) => sum + row.result[field], 0) / rows.length;
        return { strategy, gross: mean('gross'), net: mean('net') };
      });
      const best = Math.max(...strategies.map((row) => row.net));
      const single = strategies.filter((row) =>
        INTERVIEW_TOPICS.some((topic) => topic === row.strategy),
      );
      const bestQuestion = Math.max(...single.map((row) => row.net));
      return {
        mode,
        demand,
        strategies,
        leaders: strategies
          .filter((row) => Math.abs(row.net - best) < 1e-9)
          .map((row) => row.strategy),
        singleQuestionLeaders: single
          .filter((row) => Math.abs(row.net - bestQuestion) < 1e-9)
          .map((row) => row.strategy),
      };
    }),
  );
  return { rules: { ...DEFAULT_RULES, ...rules }, initial, runs, summary };
}

export function compareRecruitInterviews() {
  const seeds = Array.from({ length: 8 }, (_, index) => `RI-210-${index}`);
  return {
    conditions: {
      seeds,
      candidates: CANDIDATES,
      strategies: STRATEGIES,
      score: 'weighted sample / 5 - paid fee - ticks * opportunityPerTick',
      fixedStrategies: true,
      humanPlaytest: false,
      productionAdoption: false,
    },
    baseline: compare(seeds),
    sensitivity: [{ fee: 0 }, { fee: 6 }, { spread: 0 }, { spread: 9 }].map((rules) => {
      const result = compare(seeds, rules);
      return { rules: result.rules, summary: result.summary };
    }),
  };
}
