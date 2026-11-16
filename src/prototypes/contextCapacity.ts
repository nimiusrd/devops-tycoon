/** RI-191: 既定は資料2枠。感度比較だけ枠と危険の数を変える。通常ランのdocumentation指標とは接続しない。 */
import {
  applyModelInput,
  createModelBoard,
  summarizeModel,
  type JobKind,
  type ModelState,
} from './modelAssignment';

export const CONTEXT_CAPACITY = 2;
export const RISK_PENALTY = 5;
export const DOCS = {
  spec: { covers: 'requirement', text: '設計書。要件の抜けを埋める。' },
  example: { covers: 'implementation', text: '実例。実装の形を合わせる。' },
  history: { covers: 'change', text: '変更履歴。差分の見落としを埋める。' },
} as const;
export type DocId = keyof typeof DOCS;
export type ContextScenario = 'feature' | 'migration';
export type ContextStrategy = 'empty' | 'example' | 'specHistory' | 'exampleSpec';
export type ContextWidth = 'narrow' | 'wide';
export type ContextPreference = ContextWidth | 'tie';
export type ContextInput =
  { type: 'inspect'; doc: string } | { type: 'set'; docs: string[] } | { type: 'tick' };
export interface ContextJobSpec {
  id: string;
  kind: JobKind;
}
export interface ContextRules {
  capacity: number;
  risks: Record<string, string[]>;
}
export interface ContextState {
  version: 1;
  scenario: ContextScenario | 'custom';
  board: ModelState;
  loaded: DocId[];
  assignedDocs: Record<string, DocId[]>;
  uncovered: Record<string, string[]>;
  inputs: ContextInput[];
  /** 無いときは枠2。機能は実装1つ、移行は要件と変更。初回の比較JSONは持たない。 */
  rules?: ContextRules;
}

const RISKS: Record<string, readonly string[]> = {
  feature: ['implementation'],
  migration: ['requirement', 'change'],
};
const FEATURE_DANGER_ORDER = ['implementation', 'requirement', 'change'] as const;
const MIGRATION_DANGER_ORDER = ['requirement', 'change', 'implementation'] as const;
const WIDE_ORDER: readonly DocId[] = ['spec', 'history', 'example'];
const CAPACITY_LEVELS = [1, 2, 3] as const;
const DANGER_COUNTS = [0, 1, 2, 3] as const;
const BASELINE_CAPACITY = CONTEXT_CAPACITY;
const BASELINE_DANGERS = { feature: 1, migration: 2 } as const;
const STRATEGY_DOCS: Record<ContextStrategy, readonly DocId[]> = {
  empty: [],
  example: ['example'],
  specHistory: ['spec', 'history'],
  exampleSpec: ['example', 'spec'],
};

export function createContextBoard(
  seed: string,
  scenario: ContextState['scenario'],
  jobs: readonly ContextJobSpec[],
  horizon = 8,
  rules?: ContextRules,
): ContextState {
  const state: ContextState = {
    version: 1,
    scenario,
    board: createModelBoard(
      seed,
      0,
      horizon,
      jobs.map((job) => job.kind),
      jobs.map((job) => job.id),
    ),
    loaded: [],
    assignedDocs: {},
    uncovered: {},
    inputs: [],
  };
  if (rules) state.rules = copyRules(rules);
  return state;
}

function prototypeJobs(scenario: ContextScenario): ContextJobSpec[] {
  if (scenario === 'feature') return [{ id: 'feature', kind: 'simple' }];
  return [{ id: 'migration', kind: 'complex' }];
}

export function createContextPrototype(seed: string, scenario: ContextScenario): ContextState {
  return createContextBoard(seed, scenario, prototypeJobs(scenario));
}

export function viewContext(state: ContextState) {
  return {
    capacity: capacityOf(state),
    loaded: state.loaded,
    assignedDocs: state.assignedDocs,
    uncovered: state.uncovered,
    docs: (Object.keys(DOCS) as DocId[]).map((id) => ({
      id,
      covers: DOCS[id].covers,
      text: DOCS[id].text,
    })),
  };
}

function isDoc(doc: string): doc is DocId {
  return doc === 'spec' || doc === 'example' || doc === 'history';
}

function openJob(state: ContextState) {
  return state.board.jobs.find((job) => job.shipped === null);
}

function sameDocs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((doc) => right.includes(doc));
}

function copyRules(rules: ContextRules): ContextRules {
  return {
    capacity: rules.capacity,
    risks: Object.fromEntries(Object.entries(rules.risks).map(([id, risks]) => [id, [...risks]])),
  };
}

function capacityOf(state: ContextState): number {
  return state.rules?.capacity ?? CONTEXT_CAPACITY;
}

function risksOf(state: ContextState, jobId: string): readonly string[] {
  if (state.rules) return state.rules.risks[jobId] ?? [];
  return RISKS[jobId] ?? [];
}

function docForRisk(risk: string): DocId | undefined {
  return (Object.keys(DOCS) as DocId[]).find((id) => DOCS[id].covers === risk);
}

function narrowDocs(risks: readonly string[], capacity: number): DocId[] {
  const first = risks[0];
  if (capacity < 1 || first === undefined) return [];
  const doc = docForRisk(first);
  return doc ? [doc] : [];
}

function wideDocs(capacity: number): DocId[] {
  return WIDE_ORDER.slice(0, Math.max(0, capacity));
}

export function applyContextInput(state: ContextState, input: ContextInput): ContextState {
  if (input.type === 'inspect') return state;
  if (state.board.tick >= state.board.horizon) return state;
  if (input.type === 'set') return setDocs(state, input.docs);
  return workTick(state);
}

function setDocs(state: ContextState, docs: string[]): ContextState {
  const job = openJob(state);
  if (!job || job.progress > 0 || docs.length > capacityOf(state)) return state;
  if (new Set(docs).size !== docs.length || !docs.every(isDoc)) return state;
  if (sameDocs(docs, state.loaded)) return state;
  const next = structuredClone(state);
  next.loaded = [...docs] as DocId[];
  next.inputs.push({ type: 'set', docs: [...next.loaded] });
  return next;
}

function workTick(state: ContextState): ContextState {
  const next = structuredClone(state);
  const starting = next.board.jobs.find((job) => job.shipped === null);
  if (starting && starting.progress === 0 && next.assignedDocs[starting.id] === undefined) {
    next.assignedDocs[starting.id] = [...next.loaded];
  }
  const before = new Map(next.board.jobs.map((job) => [job.id, job.shipped]));
  next.board = applyModelInput(next.board, { type: 'tick' });
  for (const job of next.board.jobs) {
    if (before.get(job.id) !== null || job.shipped === null) continue;
    const docs = next.assignedDocs[job.id] ?? [];
    const covered = new Set<string>(docs.map((doc) => DOCS[doc].covers));
    const missing = risksOf(next, job.id).filter((risk) => !covered.has(risk));
    next.uncovered[job.id] = [...missing];
    const listed = docs.join('+') || 'none';
    if (missing.length > 0) {
      const penalty = missing.length * RISK_PENALTY;
      job.shipped -= penalty;
      next.board.shippedValue -= penalty;
      next.board.resolutions.push(`context:${job.id}:docs=${listed}:missing=${missing.join('+')}`);
    } else {
      next.board.resolutions.push(`context:${job.id}:docs=${listed}:covered`);
    }
  }
  next.inputs.push({ type: 'tick' });
  return next;
}

export function summarizeContext(state: ContextState) {
  const board = summarizeModel(state.board);
  return {
    tick: board.tick,
    shippedValue: board.shippedValue,
    spent: board.spent,
    assignedDocs: state.assignedDocs,
    uncovered: state.uncovered,
    resolutions: state.board.resolutions,
    netValue: board.netValue,
  };
}

export function chooseContextAction(state: ContextState, strategy: ContextStrategy): ContextInput {
  const job = openJob(state);
  const wanted = STRATEGY_DOCS[strategy];
  if (job && job.progress === 0 && !sameDocs(wanted, state.loaded)) {
    return { type: 'set', docs: [...wanted] };
  }
  return { type: 'tick' };
}

const COMPARE_ROWS: { scenario: ContextScenario; strategies: ContextStrategy[] }[] = [
  { scenario: 'feature', strategies: ['empty', 'example', 'specHistory'] },
  { scenario: 'migration', strategies: ['specHistory', 'exampleSpec'] },
];

export function compareContextStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createContextPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.board.tick < state.board.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = chooseContextAction(state, strategy);
        const next = applyContextInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.board.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeContext(state),
      };
    }),
  );
}

function dangerList(scenario: ContextScenario, count: number): string[] {
  const order = scenario === 'feature' ? FEATURE_DANGER_ORDER : MIGRATION_DANGER_ORDER;
  return order.slice(0, count);
}

function preferenceOf(narrow: number, wide: number): ContextPreference {
  if (narrow > wide) return 'narrow';
  if (wide > narrow) return 'wide';
  return 'tie';
}

export function chooseContextWidth(state: ContextState, width: ContextWidth): ContextInput {
  const job = openJob(state);
  const wanted =
    width === 'narrow'
      ? narrowDocs(job ? risksOf(state, job.id) : [], capacityOf(state))
      : wideDocs(capacityOf(state));
  if (job && job.progress === 0 && !sameDocs(wanted, state.loaded)) {
    return { type: 'set', docs: [...wanted] };
  }
  return { type: 'tick' };
}

function runWidth(
  seed: string,
  scenario: ContextScenario,
  width: ContextWidth,
  capacity: number,
  dangerCount: number,
) {
  const dangers = dangerList(scenario, dangerCount);
  const initial = createContextBoard(seed, scenario, prototypeJobs(scenario), 8, {
    capacity,
    risks: { [scenario]: dangers },
  });
  let state = initial;
  let guard = 0;
  while (state.board.tick < state.board.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${width}:${capacity}:${dangerCount}`);
    const action = chooseContextWidth(state, width);
    const next = applyContextInput(state, action);
    if (next === state) throw new Error(`${scenario}:${width} tick ${state.board.tick}`);
    state = next;
  }
  return {
    scenario,
    width,
    capacity,
    dangerCount,
    dangers,
    initial,
    inputs: state.inputs,
    result: summarizeContext(state),
  };
}

function widthPoint(
  seed: string,
  scenario: ContextScenario,
  capacity: number,
  dangerCount: number,
) {
  const narrow = runWidth(seed, scenario, 'narrow', capacity, dangerCount);
  const wide = runWidth(seed, scenario, 'wide', capacity, dangerCount);
  return {
    scenario,
    capacity,
    dangerCount,
    dangers: narrow.dangers,
    narrow: narrow.result.netValue,
    wide: wide.result.netValue,
    preference: preferenceOf(narrow.result.netValue, wide.result.netValue),
    runs: [narrow, wide],
  };
}

function reversals(factor: 'capacity' | 'dangerCount', points: ReturnType<typeof widthPoint>[]) {
  const found = [];
  for (const scenario of ['feature', 'migration'] as const) {
    const rows = points.filter((point) => point.scenario === scenario);
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1];
      const after = rows[index];
      if (!before || !after || before.preference === after.preference) continue;
      found.push({
        factor,
        scenario,
        before: {
          level: factor === 'capacity' ? before.capacity : before.dangerCount,
          preference: before.preference,
          narrow: before.narrow,
          wide: before.wide,
        },
        after: {
          level: factor === 'capacity' ? after.capacity : after.dangerCount,
          preference: after.preference,
          narrow: after.narrow,
          wide: after.wide,
        },
        strict: before.preference !== 'tie' && after.preference !== 'tie',
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、枠数と危険の数を一つずつ動かす。固定戦略。 */
export function compareContextWidthSensitivity(seed = 'RI-191') {
  const capacityPoints = CAPACITY_LEVELS.flatMap((capacity) =>
    (['feature', 'migration'] as const).map((scenario) =>
      widthPoint(seed, scenario, capacity, BASELINE_DANGERS[scenario]),
    ),
  );
  const dangerPoints = DANGER_COUNTS.flatMap((dangerCount) =>
    (['feature', 'migration'] as const).map((scenario) =>
      widthPoint(seed, scenario, BASELINE_CAPACITY, dangerCount),
    ),
  );
  return {
    conditions: {
      seed,
      horizon: 8,
      work: 6,
      progress: 1,
      cost: 0,
      penalty: RISK_PENALTY,
      featureValue: 10,
      migrationValue: 18,
      docs: {
        spec: DOCS.spec.covers,
        example: DOCS.example.covers,
        history: DOCS.history.covers,
      },
      narrow: '公開された危険の先頭を1枠だけ覆う。枠が余っても足さない。危険が無ければ空',
      wide: '危険を見ず、spec、history、exampleの順に枠を埋める',
      wideOrder: [...WIDE_ORDER],
      featureDangerOrder: [...FEATURE_DANGER_ORDER],
      migrationDangerOrder: [...MIGRATION_DANGER_ORDER],
      capacityLevels: [...CAPACITY_LEVELS],
      dangerCounts: [...DANGER_COUNTS],
      baselineCapacity: BASELINE_CAPACITY,
      baselineDangerCount: {
        feature: BASELINE_DANGERS.feature,
        migration: BASELINE_DANGERS.migration,
      },
      score: 'netValue。未カバー1つにつき5を出荷時に一度だけ引く',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
    },
    capacity: {
      held: '危険の数は機能1、移行2。枠だけを1、2、3にする',
      points: capacityPoints,
      reversals: reversals('capacity', capacityPoints),
    },
    dangerCount: {
      held: '枠は2。危険の数だけを0、1、2、3にする',
      points: dangerPoints,
      reversals: reversals('dangerCount', dangerPoints),
    },
  };
}
