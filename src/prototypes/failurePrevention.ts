/** RI-164: 点火sourceと分離した原因分類。対策は仕様漏れのチェックリスト1種だけ。 */
export type FailureCause = 'spec-omission' | 'migration-failure';
export type PreventionInput = 'work' | 'checklist' | 'induce-failure';
export interface PreventionJob {
  id: string;
  cause: FailureCause;
  stage: 'work' | 'repair' | 'done';
  remaining: number;
}
export interface PreventionState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  prevention: 0 | 1;
  investment: number;
  loss: number;
  incidents: { jobId: string | null; cause: FailureCause; loss: number; induced: boolean }[];
  jobs: PreventionJob[];
  inputs: PreventionInput[];
}
export function createPreventionPrototype(
  seed: string | number,
  nextCause: FailureCause,
): PreventionState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    prevention: 0,
    investment: 0,
    loss: 0,
    incidents: [],
    jobs: ['spec-omission', nextCause, nextCause].map((cause, index) => ({
      id: `job-${index}`,
      cause: cause as FailureCause,
      stage: 'work',
      remaining: 2,
    })),
    inputs: [],
  };
}
/** 免疫ではなく限定軽減: 同原因でも損失1・修復1が残る。 */
export function describePrevention(cause: FailureCause, prevention: 0 | 1) {
  const protectedJob = cause === 'spec-omission' && prevention === 1;
  return { loss: protectedJob ? 1 : 4, repairTicks: protectedJob ? 1 : 2 };
}
export function tickPreventionPrototype(
  state: PreventionState,
  input: PreventionInput,
): PreventionState {
  if (state.tick >= state.horizon || state.jobs.every((job) => job.stage === 'done')) return state;
  const active = state.jobs.find((job) => job.stage !== 'done')!;
  // 投資と故意の失敗は仕事開始前のみ。対策は実際に記録した原因に結び付ける。
  if (input !== 'work' && (active.stage !== 'work' || active.remaining !== 2)) return state;
  if (
    input === 'checklist' &&
    (state.prevention === 1 ||
      !state.incidents.some((incident) => incident.cause === 'spec-omission'))
  )
    return state;
  if (input !== 'work' && state.horizon - state.tick < 2) return state;
  const next = structuredClone(state);
  if (input === 'checklist') {
    next.prevention = 1;
    next.investment += 2;
    next.tick += 2;
  } else if (input === 'induce-failure') {
    // 故意の事故は成果なし・損失4・2工数。対策済みでも強さは増えない。
    next.tick += 2;
    next.loss += 4;
    next.incidents.push({ jobId: null, cause: 'spec-omission', loss: 4, induced: true });
  } else {
    next.tick++;
    const job = next.jobs.find((candidate) => candidate.id === active.id)!;
    job.remaining--;
    if (job.remaining === 0) {
      if (job.stage === 'work') {
        const effect = describePrevention(job.cause, next.prevention);
        next.loss += effect.loss;
        next.incidents.push({ jobId: job.id, cause: job.cause, loss: effect.loss, induced: false });
        job.stage = 'repair';
        job.remaining = effect.repairTicks;
      } else job.stage = 'done';
    }
  }
  next.inputs.push(input);
  return next;
}
export function summarizePrevention(state: PreventionState) {
  const value = state.jobs.filter((job) => job.stage === 'done').length * 8;
  return {
    value,
    loss: state.loss,
    investment: state.investment,
    netValue: value - state.loss - state.investment,
    prevention: state.prevention,
    incidents: state.incidents,
    pending: state.jobs.filter((job) => job.stage !== 'done'),
  };
}
export function comparePreventionStrategies(seed: string | number) {
  return (['spec-omission', 'migration-failure'] as const).flatMap((nextCause) =>
    (['ship', 'prevent', 'farm'] as const).map((strategy) => {
      const initial = createPreventionPrototype(seed, nextCause);
      let state = initial;
      // 共通の初仕事を完了し、確認済みの失敗原因を得る。
      for (let tick = 0; tick < 4; tick++) state = tickPreventionPrototype(state, 'work');
      if (strategy === 'farm') {
        state = tickPreventionPrototype(state, 'induce-failure');
        state = tickPreventionPrototype(state, 'induce-failure');
      }
      if (strategy !== 'ship') state = tickPreventionPrototype(state, 'checklist');
      while (state.tick < state.horizon && state.jobs.some((job) => job.stage !== 'done')) {
        state = tickPreventionPrototype(state, 'work');
      }
      return {
        nextCause,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePrevention(state),
      };
    }),
  );
}
