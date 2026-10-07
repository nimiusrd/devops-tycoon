/** RI-163: 通常ランから隔離した、領域2種・工数増加1種の負債試作。 */
export type DebtDomain = 'payment' | 'auth';
export type DebtInput = DebtDomain | 'skip' | 'work';
export interface DebtJob {
  id: string;
  domain: DebtDomain;
  remaining: number | null;
  done: boolean;
}
export interface DebtState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  debt: Record<DebtDomain, number>;
  choice: DebtDomain | 'skip' | null;
  repairEffort: number;
  jobs: DebtJob[];
  ledger: { jobId: string; domain: DebtDomain; added: number }[];
  inputs: DebtInput[];
}
export function createDebtPrototype(seed: string | number, demand: DebtDomain): DebtState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    debt: { payment: 4, auth: 4 },
    choice: null,
    repairEffort: 0,
    jobs: [demand, demand, demand === 'payment' ? 'auth' : 'payment'].map((domain, index) => ({
      id: `job-${index}`,
      domain: domain as DebtDomain,
      remaining: null,
      done: false,
    })),
    ledger: [],
    inputs: [],
  };
}
/** 開始時の一度だけ返済先を決める。返済は2工数・負債4、仕事は2+ceil(領域負債/2)工数。 */
export function tickDebtPrototype(state: DebtState, input: DebtInput): DebtState {
  if (state.tick >= state.horizon || state.jobs.every((job) => job.done)) return state;
  if (state.choice === null ? input === 'work' : input !== 'work') return state;
  const next = structuredClone(state);
  if (input !== 'work') {
    next.choice = input;
    if (input !== 'skip') {
      if (next.horizon - next.tick < 2) return state;
      next.debt[input] = Math.max(0, next.debt[input] - 4);
      next.repairEffort = 2;
      next.tick += 2;
    }
  } else {
    const job = next.jobs.find((candidate) => !candidate.done)!;
    job.remaining ??= 2 + Math.ceil(next.debt[job.domain] / 2);
    job.remaining--;
    next.tick++;
    if (job.remaining === 0) {
      job.done = true;
      next.debt[job.domain]++;
      next.ledger.push({ jobId: job.id, domain: job.domain, added: 1 });
    }
  }
  next.inputs.push(input);
  return next;
}
export function summarizeDebt(state: DebtState) {
  const done = state.jobs.filter((job) => job.done);
  return {
    value: done.length * 8,
    done: done.map((job) => job.id),
    debt: state.debt,
    techDebt: state.debt.payment + state.debt.auth,
    repairEffort: state.repairEffort,
    workEffort: state.tick - state.repairEffort,
    pending: state.jobs.filter((job) => !job.done),
    ledger: state.ledger,
  };
}
export function compareDebtStrategies(seed: string | number) {
  return (['payment', 'auth'] as const).flatMap((demand) =>
    (['skip', 'payment', 'auth'] as const).map((choice) => {
      const initial = createDebtPrototype(seed, demand);
      let state = tickDebtPrototype(initial, choice);
      while (state.tick < state.horizon && state.jobs.some((job) => !job.done)) {
        state = tickDebtPrototype(state, 'work');
      }
      return { demand, choice, initial, inputs: state.inputs, result: summarizeDebt(state) };
    }),
  );
}
