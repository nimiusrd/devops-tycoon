/** RI-166 固定盤面。通常のTask/介入とは接続しない。 */
export interface SplitTask {
  id: string;
  parentId: string | null;
  kind: 'parent' | 'child' | 'integration';
  workLeft: number;
  value: number;
  doneTick: number | null;
  children: string[];
  retired: boolean;
}
export type SplitInput =
  { type: 'split'; id: string } | { type: 'work'; id: string } | { type: 'wait' };
export interface SplitState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  nextId: number;
  focus: number;
  focusSpent: number;
  workSpent: number;
  discardedWork: number;
  integrationFails: boolean;
  failures: number;
  tasks: SplitTask[];
  inputs: SplitInput[];
}
export function createSplitPrototype(
  seed: string,
  horizon = 10,
  integrationFails = false,
): SplitState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    nextId: 1,
    focus: 6,
    focusSpent: 0,
    workSpent: 2,
    discardedWork: 0,
    integrationFails,
    failures: 0,
    tasks: [
      {
        id: 'parent',
        parentId: null,
        kind: 'parent',
        workLeft: 4,
        value: 12,
        doneTick: null,
        children: [],
        retired: false,
      },
    ],
    inputs: [],
  };
}
export function applySplitInput(state: SplitState, input: SplitInput): SplitState {
  if (state.tick >= state.horizon) return state;
  const task = input.type === 'wait' ? undefined : state.tasks.find((t) => t.id === input.id);
  if (input.type !== 'wait' && (!task || task.retired || task.doneTick !== null)) return state;
  if (
    input.type === 'split' &&
    (task!.kind !== 'parent' || task!.children.length > 0 || state.focus < 2)
  )
    return state;
  if (
    input.type === 'work' &&
    task!.kind === 'integration' &&
    !task!.children.every((id) => state.tasks.some((t) => t.id === id && t.doneTick !== null))
  )
    return state;
  const next = structuredClone(state);
  const selected = task ? next.tasks.find((t) => t.id === task.id)! : undefined;
  if (input.type === 'split') {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      let id: string;
      do {
        id = `split-${next.nextId++}`;
      } while (next.tasks.some((t) => t.id === id));
      ids.push(id);
      next.tasks.push({
        id,
        parentId: selected!.id,
        kind: i === 2 ? 'integration' : 'child',
        workLeft: i === 2 ? 2 : 3,
        value: 4,
        doneTick: null,
        children: [],
        retired: false,
      });
    }
    next.tasks.find((t) => t.id === ids[2])!.children = ids.slice(0, 2);
    selected!.children = ids;
    selected!.retired = true;
    // 初期投入2工数とその後の進捗を廃棄。子の総仕事6＋統合2を新規に払う。
    next.discardedWork += 6 - selected!.workLeft;
    next.focus -= 2;
    next.focusSpent += 2;
  } else {
    next.tick++;
    if (selected) {
      selected.workLeft--;
      next.workSpent++;
      if (selected.workLeft === 0) {
        if (selected.kind === 'integration' && next.integrationFails && next.failures === 0) {
          selected.workLeft = 2;
          next.failures++;
        } else selected.doneTick = next.tick;
      }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSplit(state: SplitState) {
  const shipped = state.tasks.filter((t) => t.doneTick !== null);
  const value = shipped.reduce((sum, t) => sum + t.value, 0);
  return {
    value,
    netValue: value - state.focusSpent,
    workSpent: state.workSpent,
    discardedWork: state.discardedWork,
    focusSpent: state.focusSpent,
    failures: state.failures,
    shipped: shipped.map((t) => ({ id: t.id, tick: t.doneTick, value: t.value })),
    remaining: state.tasks
      .filter((t) => !t.retired && t.doneTick === null)
      .map((t) => ({ id: t.id, workLeft: t.workLeft })),
  };
}
export function compareSplitStrategies(seed: string) {
  return [3, 10].flatMap((horizon) =>
    [false, true].flatMap((integrationFails) =>
      (['whole', 'split'] as const).map((strategy) => {
        const initial = createSplitPrototype(seed, horizon, integrationFails);
        let state =
          strategy === 'split'
            ? applySplitInput(initial, { type: 'split', id: 'parent' })
            : initial;
        while (state.tick < state.horizon) {
          const task = state.tasks.find((t) => !t.retired && t.doneTick === null);
          if (!task) break;
          state = applySplitInput(state, { type: 'work', id: task.id });
        }
        return {
          horizon,
          integrationFails,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeSplit(state),
        };
      }),
    ),
  );
}
