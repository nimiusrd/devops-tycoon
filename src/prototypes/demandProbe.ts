/** RI-232: 試作品は完成品の報酬を出さない。反応は seed の盤面で一度だけ。RI-229 の人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';

export type ProbeFeature = 'api' | 'screen';
export type ProbeSituation = 'confident' | 'unsure' | 'open';
export type ProbeStrategy = 'shipNow' | 'probeThen' | 'shipOther';
export type ProbeReaction = 'yes' | 'no';
export type ProbeInput =
  | { type: 'probe'; feature: ProbeFeature }
  | { type: 'ship'; feature: ProbeFeature }
  | { type: 'view' };

export interface ProbeState {
  version: 1;
  seed: string;
  situation: ProbeSituation;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  demand: ProbeFeature;
  rumor: ProbeFeature;
  fades: boolean;
  rumorWeight: number;
  otherWeight: number;
  fullReward: number;
  lateReward: number;
  probeReward: number;
  probed: boolean;
  probedFeature: ProbeFeature | null;
  reaction: ProbeReaction | null;
  shipped: boolean;
  delivered: boolean;
  value: number;
  probeValue: number;
  opportunityLoss: number;
  inputs: ProbeInput[];
}

const SITUATIONS: Record<
  ProbeSituation,
  { fades: boolean; rumorWeight: number; otherWeight: number }
> = {
  confident: { fades: true, rumorWeight: 4, otherWeight: 1 },
  unsure: { fades: true, rumorWeight: 1, otherWeight: 1 },
  open: { fades: false, rumorWeight: 1, otherWeight: 1 },
};

const FULL_REWARD = 14;
const LATE_REWARD = 6;
const PROBE_REWARD = 2;

/** 感度で一つだけ動かす係数。完成報酬と機会の有無は観測に残す。 */
export interface ProbeRules {
  rumorWeight: number;
  otherWeight: number;
  probeReward: number;
  lateReward: number;
}

function isFeature(value: string): value is ProbeFeature {
  return value === 'api' || value === 'screen';
}

/** rules を渡した欄だけ観測プリセットを上書きする。未指定の欄は初回の値。 */
export function createDemandProbe(
  seed: string,
  situation: ProbeSituation,
  demand: ProbeFeature,
  rules?: Partial<ProbeRules>,
): ProbeState {
  const preset = SITUATIONS[situation];
  return {
    version: 1,
    seed,
    situation,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    demand,
    rumor: 'api',
    fades: preset.fades,
    rumorWeight: rules?.rumorWeight ?? preset.rumorWeight,
    otherWeight: rules?.otherWeight ?? preset.otherWeight,
    fullReward: FULL_REWARD,
    lateReward: rules?.lateReward ?? LATE_REWARD,
    probeReward: rules?.probeReward ?? PROBE_REWARD,
    probed: false,
    probedFeature: null,
    reaction: null,
    shipped: false,
    delivered: false,
    value: 0,
    probeValue: 0,
    opportunityLoss: 0,
    inputs: [],
  };
}

function other(feature: ProbeFeature): ProbeFeature {
  return feature === 'api' ? 'screen' : 'api';
}

/** 消失する観測では、最初の期間に全額を取れなければ機会損失を一度だけ記録する。 */
function closeFirstPeriod(next: ProbeState) {
  const opened = next.tick;
  if (opened === 0 && next.fades && !(next.delivered && next.value >= next.fullReward)) {
    next.opportunityLoss = next.fullReward - next.lateReward;
  }
  next.tick = opened + 1;
}

/** 試作品の反応は需要で決まり、二度目と、一度でも出荷したあとは状態を変えない。 */
export function applyDemandProbe(state: ProbeState, input: ProbeInput): ProbeState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'probe') {
    if (state.probed || state.shipped || !isFeature(input.feature)) return state;
    const next = structuredClone(state);
    next.probed = true;
    next.probedFeature = input.feature;
    next.reaction = input.feature === next.demand ? 'yes' : 'no';
    next.probeValue += next.probeReward;
    next.value += next.probeReward;
    closeFirstPeriod(next);
    next.inputs.push({ type: 'probe', feature: input.feature });
    return next;
  }
  if (input.type !== 'ship' || !isFeature(input.feature)) return state;
  const next = structuredClone(state);
  next.shipped = true;
  if (!next.delivered && input.feature === next.demand) {
    next.delivered = true;
    const faded = next.fades && next.tick > 0;
    next.value += faded ? next.lateReward : next.fullReward;
  }
  closeFirstPeriod(next);
  next.inputs.push({ type: 'ship', feature: input.feature });
  return next;
}

export function viewDemandProbe(state: ProbeState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    respondents: state.respondents,
    candidates: ['api', 'screen'] as const,
    rumor: state.rumor,
    situation: state.situation,
    rumorWeight: state.rumorWeight,
    otherWeight: state.otherWeight,
    probed: state.probed,
    probedFeature: state.probedFeature,
    reaction: state.reaction,
    shipped: state.shipped,
    fullReward: state.fullReward,
    lateReward: state.fades ? state.lateReward : state.fullReward,
    probeReward: state.probeReward,
    fades: state.fades,
  };
}

export function summarizeDemandProbe(state: ProbeState) {
  return {
    value: state.value,
    probeValue: state.probeValue,
    opportunityLoss: state.opportunityLoss,
    delivered: state.delivered,
    score: state.value,
    lost: false,
  };
}

/** 先に選んだ候補を出荷し、未完成なら次の期間でもう一方を出荷する。 */
function shipInOrder(state: ProbeState, first: ProbeFeature): ProbeInput {
  if (!state.shipped || state.delivered) return { type: 'ship', feature: first };
  return { type: 'ship', feature: other(first) };
}

export function chooseDemandAction(state: ProbeState, strategy: ProbeStrategy): ProbeInput {
  if (strategy === 'shipNow') return shipInOrder(state, state.rumor);
  if (strategy === 'shipOther') return shipInOrder(state, other(state.rumor));
  if (!state.probed || state.probedFeature === null || state.reaction === null) {
    return { type: 'probe', feature: state.rumor };
  }
  const feature = state.reaction === 'yes' ? state.probedFeature : other(state.probedFeature);
  return { type: 'ship', feature };
}

function runWorld(
  seed: string,
  situation: ProbeSituation,
  demand: ProbeFeature,
  strategy: ProbeStrategy,
  rules?: Partial<ProbeRules>,
) {
  const initial = createDemandProbe(seed, situation, demand, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${situation}:${demand}:${strategy}`);
    const input = chooseDemandAction(state, strategy);
    const next = applyDemandProbe(state, input);
    if (next === state) throw new Error(`${situation}:${demand}:${strategy}@${state.tick}`);
    state = next;
  }
  return { demand, initial, inputs: state.inputs, result: summarizeDemandProbe(state) };
}

export function compareDemandProbes(seed = 'RI-232') {
  return (['confident', 'unsure', 'open'] as const).flatMap((situation) =>
    (['shipNow', 'probeThen', 'shipOther'] as const).map((strategy) => {
      const rumorWorld = runWorld(seed, situation, 'api', strategy);
      const otherWorld = runWorld(seed, situation, 'screen', strategy);
      const { rumorWeight, otherWeight } = rumorWorld.initial;
      return {
        situation,
        strategy,
        rumorWeight,
        otherWeight,
        expected: rumorWeight * rumorWorld.result.score + otherWeight * otherWorld.result.score,
        opportunity:
          rumorWeight * rumorWorld.result.opportunityLoss +
          otherWeight * otherWorld.result.opportunityLoss,
        worlds: [rumorWorld, otherWorld],
      };
    }),
  );
}

export type ProbeFactorAxis = 'rumorWeight' | 'otherWeight' | 'probeReward' | 'lateReward';
export type ProbePreference = 'shipNow' | 'probeThen' | 'tie';

export interface ProbeFactorHeld {
  fades: boolean;
  rumorWeight?: number;
  otherWeight?: number;
  probeReward?: number;
  lateReward?: number;
}

export interface ProbeFactorWorld {
  demand: ProbeFeature;
  initial: ProbeState;
  inputs: ProbeInput[];
  result: ReturnType<typeof summarizeDemandProbe>;
}

export interface ProbeFactorRow {
  axis: ProbeFactorAxis;
  parameter: string;
  situation: ProbeSituation;
  rules: ProbeRules;
  preference: ProbePreference;
  margin: number;
  leaders: ProbeStrategy[];
  scores: Record<ProbeStrategy, number>;
  opportunity: Record<ProbeStrategy, number>;
  worlds: Record<ProbeStrategy, [ProbeFactorWorld, ProbeFactorWorld]>;
}

export interface ProbeFactorReversal {
  axis: ProbeFactorAxis;
  held: ProbeFactorHeld;
  before: {
    parameter: string;
    preference: ProbePreference;
    shipNow: number;
    probeThen: number;
    shipOther: number;
  };
  after: {
    parameter: string;
    preference: ProbePreference;
    shipNow: number;
    probeThen: number;
    shipOther: number;
  };
}

export interface ProbeFactorSeries {
  axis: ProbeFactorAxis;
  anchor: ProbeSituation;
  held: ProbeFactorHeld;
  rows: ProbeFactorRow[];
  reversals: ProbeFactorReversal[];
}

const FACTOR_SEED = 'RI-232';
const FACTOR_AXES = ['rumorWeight', 'otherWeight', 'probeReward', 'lateReward'] as const;
const FACTOR_STRATEGIES = ['shipNow', 'probeThen', 'shipOther'] as const;

const RUMOR_WEIGHT_STEPS = { confident: [0, 1, 4], open: [1, 4] } as const;
const OTHER_WEIGHT_STEPS = { confident: [1, 4, 11, 12, 13], unsure: [1, 2, 3, 4] } as const;
const PROBE_REWARD_STEPS = { confident: [2, 6, 7], unsure: [2, 3, 4, 5], open: [0, 1, 2] } as const;
const LATE_REWARD_STEPS = {
  confident: [6, 11, 12],
  unsure: [6, 9, 10, 11],
  open: [0, 6, 14],
} as const;

function baselineRules(situation: ProbeSituation): ProbeRules {
  const preset = SITUATIONS[situation];
  return {
    rumorWeight: preset.rumorWeight,
    otherWeight: preset.otherWeight,
    probeReward: PROBE_REWARD,
    lateReward: LATE_REWARD,
  };
}

function rulesOnAxis(anchor: ProbeSituation, axis: ProbeFactorAxis, value: number): ProbeRules {
  const rules = baselineRules(anchor);
  return { ...rules, [axis]: value };
}

function heldFor(anchor: ProbeSituation, axis: ProbeFactorAxis): ProbeFactorHeld {
  const rules = baselineRules(anchor);
  const fades = SITUATIONS[anchor].fades;
  if (axis === 'rumorWeight') {
    return {
      fades,
      otherWeight: rules.otherWeight,
      probeReward: rules.probeReward,
      lateReward: rules.lateReward,
    };
  }
  if (axis === 'otherWeight') {
    return {
      fades,
      rumorWeight: rules.rumorWeight,
      probeReward: rules.probeReward,
      lateReward: rules.lateReward,
    };
  }
  if (axis === 'probeReward') {
    return {
      fades,
      rumorWeight: rules.rumorWeight,
      otherWeight: rules.otherWeight,
      lateReward: rules.lateReward,
    };
  }
  return {
    fades,
    rumorWeight: rules.rumorWeight,
    otherWeight: rules.otherWeight,
    probeReward: rules.probeReward,
  };
}

/** 重みと機会の有無が初回の観測と一致するとき、その観測名を使う。 */
function situationFor(anchor: ProbeSituation, rules: ProbeRules): ProbeSituation {
  const fades = SITUATIONS[anchor].fades;
  const match = (['confident', 'unsure', 'open'] as const).find(
    (situation) =>
      SITUATIONS[situation].fades === fades &&
      SITUATIONS[situation].rumorWeight === rules.rumorWeight &&
      SITUATIONS[situation].otherWeight === rules.otherWeight,
  );
  return match ?? anchor;
}

function preferenceOf(shipNow: number, probeThen: number): ProbePreference {
  if (probeThen > shipNow) return 'probeThen';
  if (shipNow > probeThen) return 'shipNow';
  return 'tie';
}

function leadersOf(scores: Record<ProbeStrategy, number>): ProbeStrategy[] {
  const top = Math.max(scores.shipNow, scores.probeThen, scores.shipOther);
  return FACTOR_STRATEGIES.filter((strategy) => scores[strategy] === top);
}

function weighted(rules: ProbeRules, rumor: number, other: number) {
  return rules.rumorWeight * rumor + rules.otherWeight * other;
}

function factorRow(axis: ProbeFactorAxis, anchor: ProbeSituation, value: number): ProbeFactorRow {
  const rules = rulesOnAxis(anchor, axis, value);
  const situation = situationFor(anchor, rules);
  const worlds = Object.fromEntries(
    FACTOR_STRATEGIES.map((strategy) => {
      const rumorWorld = runWorld(FACTOR_SEED, situation, 'api', strategy, rules);
      const otherWorld = runWorld(FACTOR_SEED, situation, 'screen', strategy, rules);
      return [strategy, [rumorWorld, otherWorld] as [ProbeFactorWorld, ProbeFactorWorld]];
    }),
  ) as Record<ProbeStrategy, [ProbeFactorWorld, ProbeFactorWorld]>;
  const scores = Object.fromEntries(
    FACTOR_STRATEGIES.map((strategy) => {
      const [rumorWorld, otherWorld] = worlds[strategy];
      return [strategy, weighted(rules, rumorWorld.result.score, otherWorld.result.score)];
    }),
  ) as Record<ProbeStrategy, number>;
  const opportunity = Object.fromEntries(
    FACTOR_STRATEGIES.map((strategy) => {
      const [rumorWorld, otherWorld] = worlds[strategy];
      return [
        strategy,
        weighted(rules, rumorWorld.result.opportunityLoss, otherWorld.result.opportunityLoss),
      ];
    }),
  ) as Record<ProbeStrategy, number>;
  return {
    axis,
    parameter: String(value),
    situation,
    rules,
    preference: preferenceOf(scores.shipNow, scores.probeThen),
    margin: scores.probeThen - scores.shipNow,
    leaders: leadersOf(scores),
    scores,
    opportunity,
    worlds,
  };
}

function reversalPoint(row: ProbeFactorRow) {
  return {
    parameter: row.parameter,
    preference: row.preference,
    shipNow: row.scores.shipNow,
    probeThen: row.scores.probeThen,
    shipOther: row.scores.shipOther,
  };
}

function reversalsOf(rows: ProbeFactorRow[], held: ProbeFactorHeld): ProbeFactorReversal[] {
  const found: ProbeFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      held,
      before: reversalPoint(before),
      after: reversalPoint(after),
    });
  }
  return found;
}

function buildSeries(
  axis: ProbeFactorAxis,
  anchor: ProbeSituation,
  values: readonly number[],
): ProbeFactorSeries {
  const held = heldFor(anchor, axis);
  const rows = values.map((value) => factorRow(axis, anchor, value));
  return { axis, anchor, held, rows, reversals: reversalsOf(rows, held) };
}

function fixedInputs() {
  return Object.fromEntries(
    FACTOR_STRATEGIES.map((strategy) => [
      strategy,
      {
        api: runWorld(FACTOR_SEED, 'confident', 'api', strategy).inputs,
        screen: runWorld(FACTOR_SEED, 'confident', 'screen', strategy).inputs,
      },
    ]),
  );
}

/** 初回と同じ資源で、重み・試作品報酬・遅延報酬を一つずつ動かす。固定戦略。 */
export function compareDemandFactorReversals() {
  const sample = createDemandProbe(FACTOR_SEED, 'confident', 'api');
  const sweeps = {
    rumorWeight: [
      buildSeries('rumorWeight', 'confident', RUMOR_WEIGHT_STEPS.confident),
      buildSeries('rumorWeight', 'open', RUMOR_WEIGHT_STEPS.open),
    ],
    otherWeight: [
      buildSeries('otherWeight', 'confident', OTHER_WEIGHT_STEPS.confident),
      buildSeries('otherWeight', 'unsure', OTHER_WEIGHT_STEPS.unsure),
    ],
    probeReward: [
      buildSeries('probeReward', 'confident', PROBE_REWARD_STEPS.confident),
      buildSeries('probeReward', 'unsure', PROBE_REWARD_STEPS.unsure),
      buildSeries('probeReward', 'open', PROBE_REWARD_STEPS.open),
    ],
    lateReward: [
      buildSeries('lateReward', 'confident', LATE_REWARD_STEPS.confident),
      buildSeries('lateReward', 'unsure', LATE_REWARD_STEPS.unsure),
      buildSeries('lateReward', 'open', LATE_REWARD_STEPS.open),
    ],
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      capacity: sample.capacity,
      respondents: sample.respondents,
      horizon: sample.horizon,
      fullReward: sample.fullReward,
      rumor: sample.rumor,
      candidates: ['api', 'screen'] as const,
      score: 'rumorWeight * rumorWorld + otherWeight * otherWorld',
      inputs: fixedInputs(),
      decision: {
        compared: ['probeThen', 'shipNow'] as const,
        preference:
          '試作品の期待値が大きいとき試作品、噂を先に出荷する期待値が大きいとき即出荷、同じとき同点',
        margin: '試作品の期待値 − 噂を先に出荷する期待値',
        leaders: '三つの期待値が最大の戦略。同点は複数。並びは即出荷、試作品、別候補先',
      },
      baselines: {
        confident: { fades: true, ...baselineRules('confident') },
        unsure: { fades: true, ...baselineRules('unsure') },
        open: { fades: false, ...baselineRules('open') },
      },
      held: {
        rumorWeight:
          '噂の重みだけを動かす。別候補の重み1、試作品報酬2、遅延報酬6。機会が消える列は確信度の高い観測、機会が残る列は機会が残る観測',
        otherWeight:
          '別候補の重みだけを動かす。試作品報酬2、遅延報酬6。噂の重み4は確信度の高い観測、噂の重み1は五分五分で機会が消える観測',
        probeReward:
          '試作品報酬だけを動かす。遅延報酬6。確信度の高い観測は重み4:1、五分五分は重み1:1、機会が残る観測は重み1:1',
        lateReward:
          '遅延報酬だけを動かす。試作品報酬2。0未満にも完成報酬14を超えても動かさない。機会が残る観測では出荷報酬に遅延報酬を使わない',
      },
      relation:
        '機会が消えるとき、試作品の期待値−即出荷の期待値 = 噂の重み×(試作品報酬+遅延報酬−完成報酬)+別候補の重み×試作品報酬。機会が残るとき、その差は(噂の重み+別候補の重み)×試作品報酬',
      bounds: '重みと試作品報酬は0未満にしない。遅延報酬は0以上、完成報酬14以下',
      steps: {
        rumorWeight: RUMOR_WEIGHT_STEPS,
        otherWeight: OTHER_WEIGHT_STEPS,
        probeReward: PROBE_REWARD_STEPS,
        lateReward: LATE_REWARD_STEPS,
      },
      omitted: '初回の3観測×3戦略の表は再出力しない。基準行だけ初回JSONと照合する',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: FACTOR_AXES.flatMap((axis) => sweeps[axis].flatMap((series) => series.reversals)),
  };
}
