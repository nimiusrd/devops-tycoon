/** RI-160: 通常ランから隔離した2便・期待損失の比較。乱数事故は扱わない。 */
export interface WindowTask {
  id: string;
  reviewCompletedTick: number;
  status: 'awaitingRelease' | 'published';
  verificationLeft: number;
  riskLoss: number;
  deadlineTick: number;
  onTimeValue: number;
  lateValue: number;
  publishedTick: number | null;
  value: number;
  loss: number;
}
export interface WindowState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  departures: number[];
  tasks: WindowTask[];
  verificationWork: number;
  inputs: WindowInput[];
}
export interface WindowInput {
  verifyId?: string;
  holdIds: string[];
}
export function createWindowPrototype(seed: string | number, impact: 'low' | 'high'): WindowState {
  return {
    version: 1,
    seed,
    tick: 1,
    horizon: 6,
    departures: [2, 5],
    verificationWork: 0,
    inputs: [],
    tasks: [
      {
        id: 'change',
        reviewCompletedTick: 1,
        status: 'awaitingRelease',
        verificationLeft: 2,
        riskLoss: impact === 'low' ? 2 : 8,
        deadlineTick: 2,
        onTimeValue: 10,
        lateValue: 6,
        publishedTick: null,
        value: 0,
        loss: 0,
      },
    ],
  };
}
/** 1枠の確認を行い、tick終端で搭載。2工数完了時だけ期待損失を解消する。 */
export function tickWindowPrototype(state: WindowState, input: WindowInput): WindowState {
  if (
    state.tick >= state.horizon ||
    new Set(input.holdIds).size !== input.holdIds.length ||
    input.holdIds.some(
      (id) => !state.tasks.some((t) => t.id === id && t.status === 'awaitingRelease'),
    ) ||
    (input.verifyId !== undefined &&
      !state.tasks.some(
        (t) => t.id === input.verifyId && t.status === 'awaitingRelease' && t.verificationLeft > 0,
      ))
  )
    return state;
  const next = structuredClone(state);
  next.tick++;
  if (input.verifyId !== undefined) {
    next.tasks.find((t) => t.id === input.verifyId)!.verificationLeft--;
    next.verificationWork++;
  }
  if (next.departures.includes(next.tick))
    for (const task of next.tasks) {
      if (
        task.status !== 'awaitingRelease' ||
        input.holdIds.includes(task.id) ||
        task.reviewCompletedTick > next.tick
      )
        continue;
      task.status = 'published';
      task.publishedTick = next.tick;
      task.value = next.tick <= task.deadlineTick ? task.onTimeValue : task.lateValue;
      task.loss = task.verificationLeft === 0 ? 0 : task.riskLoss;
    }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeWindows(state: WindowState) {
  const published = state.tasks.filter((t) => t.status === 'published');
  return {
    tick: state.tick,
    reviewed: state.tasks.length,
    published: published.length,
    carryover: state.tasks.filter((t) => t.status === 'awaitingRelease').map((t) => t.id),
    value: published.reduce((s, t) => s + t.value, 0),
    loss: published.reduce((s, t) => s + t.loss, 0),
    netValue: published.reduce((s, t) => s + t.value - t.loss, 0),
    verificationWork: state.verificationWork,
  };
}
export function compareWindowStrategies(seed: string | number) {
  return (['low', 'high'] as const).flatMap((impact) =>
    (['early', 'verify'] as const).map((strategy) => {
      const initial = createWindowPrototype(seed, impact);
      let state = initial;
      while (state.tick < state.horizon)
        state = tickWindowPrototype(state, {
          holdIds: strategy === 'verify' && state.tick < 2 ? ['change'] : [],
          ...(strategy === 'verify' && state.tick >= 2 && state.tick < 4
            ? { verifyId: 'change' }
            : {}),
        });
      return {
        impact,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeWindows(state),
        tasks: state.tasks,
      };
    }),
  );
}
