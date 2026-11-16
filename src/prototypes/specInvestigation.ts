import { createRng } from '../sim/rng';
import { createDeadlinePrototype, tickDeadlinePrototype, type DeadlineState } from './taskDeadline';

export type WorkArea = 'familiar' | 'unfamiliar';
export type PastCase = 'matched' | 'none';
export type PriorStrategy =
  'always-rush' | 'always-investigate' | 'prior-any-warning' | 'prior-both-warnings';

/**
 * 公開兆候ごとの高リスク件数。基準1/4に、新しい作業領域と過去事例なしを1/4ずつ足す。
 * 比較条件であり、推定した的中率ではない。
 */
export const PRIOR_PROFILES = [
  { id: 'quiet', workArea: 'familiar', pastCase: 'matched', highCount: 1, count: 4 },
  { id: 'area', workArea: 'unfamiliar', pastCase: 'matched', highCount: 2, count: 4 },
  { id: 'past', workArea: 'familiar', pastCase: 'none', highCount: 2, count: 4 },
  { id: 'both', workArea: 'unfamiliar', pastCase: 'none', highCount: 3, count: 4 },
] as const;

export const PRIOR_STRATEGIES = [
  'always-rush',
  'always-investigate',
  'prior-any-warning',
  'prior-both-warnings',
] as const satisfies readonly PriorStrategy[];

const PRIOR_DECISIONS: Record<PriorStrategy, 0 | 1> = {
  'always-rush': 0,
  'always-investigate': 0,
  'prior-any-warning': 1,
  'prior-both-warnings': 1,
};

export interface InvestigationState {
  version: 1;
  deadline: DeadlineState;
  hiddenRisk: 'low' | 'high';
  workArea: WorkArea;
  pastCase: PastCase;
  revealed: boolean;
  started: boolean;
  researchLeft: number;
  researchTicks: number;
  otherTask: { id: string; ambiguous: boolean; risk: null };
  history: ('work' | 'boost' | 'wait' | 'investigate')[];
}

export function priorComparisonSeeds(): string[] {
  return PRIOR_PROFILES.flatMap((profile) =>
    Array.from({ length: profile.count }, (_, index) => `RI-156-${profile.id}-${index}`),
  );
}

/** 比較用 seed は公開兆候をプロファイルで固定し、添字が highCount 未満のときだけ高リスクにする。 */
function priorAssignment(seed: string | number): {
  workArea: WorkArea;
  pastCase: PastCase;
  hiddenRisk: 'low' | 'high';
} | null {
  if (typeof seed !== 'string') return null;
  const matched = /^RI-156-(quiet|area|past|both)-(\d+)$/.exec(seed);
  if (!matched) return null;
  const profile = PRIOR_PROFILES.find((item) => item.id === matched[1]);
  if (!profile) return null;
  const index = Number(matched[2]);
  if (index >= profile.count) return null;
  return {
    workArea: profile.workArea,
    pastCase: profile.pastCase,
    hiddenRisk: index < profile.highCount ? 'high' : 'low',
  };
}

export function createInvestigationPrototype(seed: string | number): InvestigationState {
  const deadline = createDeadlinePrototype(seed, 'recoverable');
  deadline.deadlineTick = 4;
  deadline.board.horizon = 6;
  const assigned = priorAssignment(seed);
  const rng = createRng(seed);
  // 初回比較の seed は最初の乱数だけを高低に使い、続く乱数を公開兆候にする。比較用 seed は乱数を使わない。
  const hiddenRisk = assigned ? assigned.hiddenRisk : rng() < 0.5 ? 'low' : 'high';
  const workArea = assigned ? assigned.workArea : rng() < 0.5 ? 'familiar' : 'unfamiliar';
  const pastCase = assigned ? assigned.pastCase : rng() < 0.5 ? 'matched' : 'none';
  return {
    version: 1,
    deadline,
    hiddenRisk,
    workArea,
    pastCase,
    revealed: false,
    started: false,
    researchLeft: 0,
    researchTicks: 0,
    otherTask: { id: 'other', ambiguous: true, risk: null },
    history: [],
  };
}

/** プレイヤーへ渡す投影。内部保存の予定リスクを表示前に漏らさない。 */
export function investigationView(state: InvestigationState) {
  return {
    tick: state.deadline.board.tick,
    workArea: state.workArea,
    pastCase: state.pastCase,
    task: {
      id: 'campaign',
      workLeft: state.deadline.board.tasks[0].workLeft,
      ambiguous: !state.revealed,
      risk: state.revealed ? state.hiddenRisk : null,
      avoidedRework: state.revealed ? (state.hiddenRisk === 'high' ? 3 : 0) : null,
    },
    otherTask: { ...state.otherTask },
    researchLeft: state.researchLeft,
    researchCost: 2,
    deadlineTick: state.deadline.deadlineTick,
    onTimeValue: state.deadline.onTimeValue,
    lateValue: state.deadline.lateValue,
    focus: state.deadline.focus,
    stamina: state.deadline.stamina,
  };
}

/** 調査は2tickの処理容量を独占。着手後や完了後の調査は拒否する。 */
export function tickInvestigationPrototype(
  state: InvestigationState,
  action: InvestigationState['history'][number],
): InvestigationState {
  if (
    state.deadline.board.tick >= state.deadline.board.horizon ||
    state.deadline.board.tasks[0].done
  )
    return state;
  if (action === 'investigate' && (state.started || state.revealed)) return state;
  if (state.researchLeft > 0 || action === 'investigate') {
    const researchLeft = (state.researchLeft || 2) - 1;
    return {
      ...state,
      deadline: tickDeadlinePrototype(state.deadline, 'wait'),
      researchLeft,
      researchTicks: state.researchTicks + 1,
      revealed: researchLeft === 0,
      history: [...state.history, action],
    };
  }
  let deadline = state.deadline;
  // 調査せず着手した場合だけ、初期seedで確定済みの後工程手戻りを工数に載せる。
  const starting = !state.started && action !== 'wait';
  if (starting && !state.revealed && state.hiddenRisk === 'high') {
    deadline = {
      ...deadline,
      board: {
        ...deadline.board,
        tasks: deadline.board.tasks.map((task) => ({ ...task, workLeft: task.workLeft + 3 })),
      },
    };
  }
  const next = tickDeadlinePrototype(deadline, action);
  // 資源不足による拒否では隠し工数の公開や着手を確定しない。
  if (next === deadline) return state;
  return {
    ...state,
    deadline: next,
    started: state.started || starting,
    history: [...state.history, action],
  };
}

export function replayInvestigation(
  seed: string | number,
  inputs: InvestigationState['history'],
): InvestigationState {
  return inputs.reduce(tickInvestigationPrototype, createInvestigationPrototype(seed));
}

export function compareInvestigationStrategies(seeds: (string | number)[]) {
  return seeds.flatMap((seed) =>
    (['rush', 'investigate'] as const).map((strategy) => {
      let state = createInvestigationPrototype(seed);
      while (
        !state.deadline.board.tasks[0].done &&
        state.deadline.board.tick < state.deadline.board.horizon
      ) {
        state = tickInvestigationPrototype(
          state,
          strategy === 'investigate' && state.deadline.board.tick === 0 ? 'investigate' : 'work',
        );
      }
      return {
        seed,
        risk: state.hiddenRisk,
        strategy,
        shipped: state.deadline.board.shipped,
        workLeft: state.deadline.board.tasks[0].workLeft,
        researchTicks: state.researchTicks,
        focus: state.deadline.focus,
        stamina: state.deadline.stamina,
        history: state.history,
      };
    }),
  );
}

/** 公開された作業領域と過去事例だけを見る。隠しリスクと高リスク件数は引数に無い。 */
export function actionFromPrior(
  strategy: PriorStrategy,
  signals: { workArea: WorkArea; pastCase: PastCase },
): 'work' | 'investigate' {
  if (strategy === 'always-rush') return 'work';
  if (strategy === 'always-investigate') return 'investigate';
  const unfamiliar = signals.workArea === 'unfamiliar';
  const noPastCase = signals.pastCase === 'none';
  if (strategy === 'prior-any-warning') return unfamiliar || noPastCase ? 'investigate' : 'work';
  return unfamiliar && noPastCase ? 'investigate' : 'work';
}

export interface PriorComparisonRow {
  seed: string;
  workArea: WorkArea;
  pastCase: PastCase;
  risk: 'low' | 'high';
  strategy: PriorStrategy;
  decisionCount: 0 | 1;
  openingAction: 'work' | 'investigate';
  value: number;
  rushValue: number;
  investigateValue: number;
  opportunityCost: number;
  shipped: { id: string; tick: number; value: number }[];
  workLeft: number;
  researchTicks: number;
  focus: number;
  stamina: number;
  history: InvestigationState['history'];
}

function playFromOpening(seed: string, openingAction: 'work' | 'investigate'): InvestigationState {
  let state = createInvestigationPrototype(seed);
  while (
    !state.deadline.board.tasks[0].done &&
    state.deadline.board.tick < state.deadline.board.horizon
  ) {
    state = tickInvestigationPrototype(
      state,
      state.deadline.board.tick === 0 ? openingAction : 'work',
    );
  }
  return state;
}

function rowWithoutBaseline(
  seed: string,
  strategy: PriorStrategy,
): Omit<PriorComparisonRow, 'rushValue' | 'investigateValue' | 'opportunityCost'> {
  const openingState = createInvestigationPrototype(seed);
  const opening = investigationView(openingState);
  const openingAction = actionFromPrior(strategy, {
    workArea: opening.workArea,
    pastCase: opening.pastCase,
  });
  const state = playFromOpening(seed, openingAction);
  return {
    seed,
    workArea: opening.workArea,
    pastCase: opening.pastCase,
    risk: state.hiddenRisk,
    strategy,
    decisionCount: PRIOR_DECISIONS[strategy],
    openingAction,
    value: state.deadline.board.shipped[0]?.value ?? 0,
    shipped: state.deadline.board.shipped,
    workLeft: state.deadline.board.tasks[0].workLeft,
    researchTicks: state.researchTicks,
    focus: state.deadline.focus,
    stamina: state.deadline.stamina,
    history: state.history,
  };
}

export interface SignalGroupSummary {
  id: (typeof PRIOR_PROFILES)[number]['id'];
  workArea: WorkArea;
  pastCase: PastCase;
  seedCount: number;
  highRiskCount: number;
  lowRiskCount: number;
  rushExpectedValue: number;
  investigateExpectedValue: number;
  investigationAdvantage: number;
}

export interface PriorStrategySummary {
  strategy: PriorStrategy;
  seedCount: number;
  totalValue: number;
  meanValue: number;
  decisionCount: number;
  investigationCount: number;
  opportunityCost: number;
  meanOpportunityCost: number;
  lowRiskInvestigated: number;
  highRiskInvestigated: number;
  lowRiskRushed: number;
  highRiskRushed: number;
}

function summarizeSignalGroups(rows: PriorComparisonRow[]): SignalGroupSummary[] {
  return PRIOR_PROFILES.map((profile) => {
    const prefix = `RI-156-${profile.id}-`;
    const rushed = rows.filter(
      (row) => row.strategy === 'always-rush' && row.seed.startsWith(prefix),
    );
    const investigated = rows.filter(
      (row) => row.strategy === 'always-investigate' && row.seed.startsWith(prefix),
    );
    const rushTotal = rushed.reduce((sum, row) => sum + row.value, 0);
    const investigateTotal = investigated.reduce((sum, row) => sum + row.value, 0);
    const highRiskCount = rushed.filter((row) => row.risk === 'high').length;
    const rushExpectedValue = rushTotal / rushed.length;
    const investigateExpectedValue = investigateTotal / investigated.length;
    return {
      id: profile.id,
      workArea: profile.workArea,
      pastCase: profile.pastCase,
      seedCount: rushed.length,
      highRiskCount,
      lowRiskCount: rushed.length - highRiskCount,
      rushExpectedValue,
      investigateExpectedValue,
      investigationAdvantage: investigateExpectedValue - rushExpectedValue,
    };
  });
}

function summarizeStrategy(
  rows: PriorComparisonRow[],
  strategy: PriorStrategy,
): PriorStrategySummary {
  const selected = rows.filter((row) => row.strategy === strategy);
  const totalValue = selected.reduce((sum, row) => sum + row.value, 0);
  const opportunityCost = selected.reduce((sum, row) => sum + row.opportunityCost, 0);
  const count = (predicate: (row: PriorComparisonRow) => boolean) =>
    selected.filter(predicate).length;
  return {
    strategy,
    seedCount: selected.length,
    totalValue,
    meanValue: totalValue / selected.length,
    decisionCount: selected.reduce((sum, row) => sum + row.decisionCount, 0),
    investigationCount: count((row) => row.openingAction === 'investigate'),
    opportunityCost,
    meanOpportunityCost: opportunityCost / selected.length,
    lowRiskInvestigated: count((row) => row.risk === 'low' && row.openingAction === 'investigate'),
    highRiskInvestigated: count(
      (row) => row.risk === 'high' && row.openingAction === 'investigate',
    ),
    lowRiskRushed: count((row) => row.risk === 'low' && row.openingAction === 'work'),
    highRiskRushed: count((row) => row.risk === 'high' && row.openingAction === 'work'),
  };
}

export function comparePriorInformationStrategies(seeds = priorComparisonSeeds()) {
  const baselines = new Map<string, { rushValue: number; investigateValue: number }>();
  const played = seeds.flatMap((seed) =>
    PRIOR_STRATEGIES.map((strategy) => rowWithoutBaseline(seed, strategy)),
  );
  for (const row of played) {
    const baseline = baselines.get(row.seed) ?? { rushValue: 0, investigateValue: 0 };
    if (row.strategy === 'always-rush') baseline.rushValue = row.value;
    if (row.strategy === 'always-investigate') baseline.investigateValue = row.value;
    baselines.set(row.seed, baseline);
  }
  const results: PriorComparisonRow[] = played.map((row) => {
    const baseline = baselines.get(row.seed);
    if (!baseline) throw new Error(`missing baseline: ${row.seed}`);
    return {
      seed: row.seed,
      workArea: row.workArea,
      pastCase: row.pastCase,
      risk: row.risk,
      strategy: row.strategy,
      decisionCount: row.decisionCount,
      openingAction: row.openingAction,
      value: row.value,
      rushValue: baseline.rushValue,
      investigateValue: baseline.investigateValue,
      opportunityCost:
        row.openingAction === 'investigate'
          ? Math.max(0, baseline.rushValue - baseline.investigateValue)
          : 0,
      shipped: row.shipped,
      workLeft: row.workLeft,
      researchTicks: row.researchTicks,
      focus: row.focus,
      stamina: row.stamina,
      history: row.history,
    };
  });
  return {
    note: '固定戦略の計算であり、人間のプレイ評価はしていない。方針は公開された作業領域と過去事例だけを見て、隠しリスクや高リスク件数は読まない。',
    conditions: {
      weight: 'equal-per-seed',
      productionIntegrated: false,
      humanPlaytest: false,
      profiles: PRIOR_PROFILES.map((profile) => ({ ...profile })),
      strategies: [...PRIOR_STRATEGIES],
      riskRule:
        '比較用 seed の添字が highCount 未満なら高リスク。同じ公開兆候に低リスクと高リスクの両方がある。',
      decisionCountRule:
        '事前情報を使う方針は seed ごとに公開兆候を1回見て1。固定方針は公開兆候を見ないので0。',
      opportunityCostRule:
        '調査を選んだ seed について、即着手の価値から調査の価値を引いた非負の差。評価側の集計で、方針の入力ではない。',
    },
    seeds,
    results,
    signalGroups: summarizeSignalGroups(results),
    summary: PRIOR_STRATEGIES.map((strategy) => summarizeStrategy(results, strategy)),
  };
}
