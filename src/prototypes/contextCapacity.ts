/** RI-191: 資料2枠。通常ランのdocumentation指標とは接続しない。 */
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
export type ContextInput =
  | { type: 'inspect'; doc: string }
  | { type: 'set'; docs: string[] }
  | { type: 'tick' };
export interface ContextJobSpec {
  id: string;
  kind: JobKind;
}
export interface ContextState {
  version: 1;
  scenario: ContextScenario | 'custom';
  board: ModelState;
  loaded: DocId[];
  assignedDocs: Record<string, DocId[]>;
  uncovered: Record<string, string[]>;
  inputs: ContextInput[];
}

const RISKS: Record<string, readonly string[]> = {
  feature: ['implementation'],
  migration: ['requirement', 'change'],
};
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
): ContextState {
  return {
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
}

export function createContextPrototype(seed: string, scenario: ContextScenario): ContextState {
  if (scenario === 'feature') {
    return createContextBoard(seed, scenario, [{ id: 'feature', kind: 'simple' }]);
  }
  return createContextBoard(seed, scenario, [{ id: 'migration', kind: 'complex' }]);
}

export function viewContext(state: ContextState) {
  return {
    capacity: CONTEXT_CAPACITY,
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
  return left.length === right.length && left.every((doc, index) => doc === right[index]);
}

export function applyContextInput(state: ContextState, input: ContextInput): ContextState {
  if (input.type === 'inspect') return state;
  if (state.board.tick >= state.board.horizon) return state;
  if (input.type === 'set') return setDocs(state, input.docs);
  return workTick(state);
}

function setDocs(state: ContextState, docs: string[]): ContextState {
  const job = openJob(state);
  if (!job || job.progress > 0 || docs.length > CONTEXT_CAPACITY) return state;
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
    const missing = (RISKS[job.id] ?? []).filter((risk) => !covered.has(risk));
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
