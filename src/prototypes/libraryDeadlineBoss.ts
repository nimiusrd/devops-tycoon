/** RI-258: 仮想依存の保守期限戦。通常ラン・UI・保存・rulesetには接続しない。 */
export type LibraryId = 'ledger-kernel' | 'relay-mesh' | 'palette-cache';
export type LibraryStrategy = 'none' | 'batch' | 'focus' | 'serial-all';
export type LibraryInput =
  | { type: 'view' }
  | { type: 'plan'; mode: 'batch' | 'focus'; order: LibraryId[] }
  | { type: 'advance' };

interface LibraryProgress {
  id: LibraryId;
  importance: 'critical' | 'important' | 'low';
  domains: string[];
  implementationWork: number;
  verificationWork: number;
  implementationLeft: number;
  verificationLeft: number;
  deadlineTick: number;
  graceTicks: number;
  incidentLossPerTick: number;
  updatedAt: number | null;
}

interface LibraryPeriod {
  tick: number;
  implementation: number;
  coordination: number;
  verification: number;
  shipped: number;
  incidents: { id: LibraryId; loss: number }[];
  updated: LibraryId[];
}

/** version 1 は試作内部の信頼済みJSON専用。外部保存の読込APIではない。 */
export interface LibraryDeadlineState {
  version: 1;
  seed: string;
  tick: number;
  activeTicks: number;
  capacity: number;
  batchCoordinationWork: number;
  coordinationLeft: number;
  plan: { mode: 'batch' | 'focus'; order: LibraryId[] } | null;
  libraries: LibraryProgress[];
  periods: LibraryPeriod[];
  inputs: LibraryInput[];
}

export function createLibraryDeadlineBoss(seed = 'RI-258'): LibraryDeadlineState {
  const specs = [
    {
      id: 'ledger-kernel' as const,
      importance: 'critical' as const,
      domains: ['billing', 'orders'],
      implementationWork: 4,
      verificationWork: 2,
      deadlineTick: 1,
      graceTicks: 1,
      incidentLossPerTick: 6,
    },
    {
      id: 'relay-mesh' as const,
      importance: 'important' as const,
      domains: ['search', 'notifications'],
      implementationWork: 3,
      verificationWork: 2,
      deadlineTick: 3,
      graceTicks: 1,
      incidentLossPerTick: 3,
    },
    {
      id: 'palette-cache' as const,
      importance: 'low' as const,
      domains: ['catalog'],
      implementationWork: 2,
      verificationWork: 1,
      deadlineTick: 4,
      graceTicks: 1,
      incidentLossPerTick: 1,
    },
  ];
  return {
    version: 1,
    seed,
    tick: 0,
    activeTicks: 6,
    capacity: 4,
    batchCoordinationWork: 2,
    coordinationLeft: 0,
    plan: null,
    libraries: specs.map((spec) => ({
      ...spec,
      implementationLeft: spec.implementationWork,
      verificationLeft: spec.verificationWork,
      updatedAt: null,
    })),
    periods: [],
    inputs: [],
  };
}

function phaseOf(state: LibraryDeadlineState) {
  if (state.tick === 0) return 'prepare';
  if (state.tick > state.activeTicks) return 'result';
  return state.tick === 1 ? 'start' : 'peak';
}

function validPlan(state: LibraryDeadlineState, input: Extract<LibraryInput, { type: 'plan' }>) {
  return (
    state.tick === 0 &&
    state.plan === null &&
    input.order.length > 0 &&
    new Set(input.order).size === input.order.length &&
    input.order.every((id) => state.libraries.some((library) => library.id === id)) &&
    (input.mode !== 'batch' || input.order.length === state.libraries.length)
  );
}

export function applyLibraryDeadlineBoss(
  state: LibraryDeadlineState,
  input: LibraryInput,
): LibraryDeadlineState {
  if (input.type === 'view' || phaseOf(state) === 'result') return state;
  if (input.type === 'plan' && !validPlan(state, input)) return state;
  const next = structuredClone(state);
  if (input.type === 'plan') {
    next.plan = { mode: input.mode, order: [...input.order] };
    next.coordinationLeft = input.mode === 'batch' ? next.batchCoordinationWork : 0;
  } else if (next.tick === 0) {
    next.tick = 1;
  } else {
    let room = next.capacity;
    const period: LibraryPeriod = {
      tick: next.tick,
      implementation: 0,
      coordination: 0,
      verification: 0,
      shipped: 0,
      incidents: [],
      updated: [],
    };
    const selected =
      next.plan?.order.map((id) => next.libraries.find((lib) => lib.id === id)!) ?? [];
    const implement = (library: LibraryProgress) => {
      const work = Math.min(room, library.implementationLeft);
      library.implementationLeft -= work;
      room -= work;
      period.implementation += work;
    };
    const verify = (library: LibraryProgress) => {
      const work = Math.min(room, library.verificationLeft);
      library.verificationLeft -= work;
      room -= work;
      period.verification += work;
      if (library.verificationLeft === 0 && library.updatedAt === null) {
        library.updatedAt = next.tick;
        period.updated.push(library.id);
      }
    };
    if (next.plan?.mode === 'batch') {
      selected.forEach(implement);
      if (selected.every((library) => library.implementationLeft === 0)) {
        const work = Math.min(room, next.coordinationLeft);
        next.coordinationLeft -= work;
        room -= work;
        period.coordination = work;
        if (next.coordinationLeft === 0) selected.forEach(verify);
      }
    } else {
      for (const library of selected) {
        implement(library);
        if (library.implementationLeft === 0) verify(library);
      }
    }
    // 残枠は通常出荷に使う。旧依存でも運用・出荷は止めない。
    period.shipped = room;
    for (const library of next.libraries) {
      // 当該tickの確認完了を先に反映。期限＋猶予の次tickから損失が発生する。
      if (library.updatedAt === null && next.tick > library.deadlineTick + library.graceTicks) {
        period.incidents.push({ id: library.id, loss: library.incidentLossPerTick });
      }
    }
    next.periods.push(period);
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}

/** 得点は比較用。障害損失と次期工数の評価係数を変え、生データと区別する。 */
export function summarizeLibraryDeadlineBoss(state: LibraryDeadlineState, carryCost = 2) {
  const shipped = state.periods.reduce((sum, period) => sum + period.shipped, 0);
  const incidents = state.periods.flatMap((period) => period.incidents);
  const incidentLoss = incidents.reduce((sum, incident) => sum + incident.loss, 0);
  const remaining = state.libraries
    .filter((library) => library.updatedAt === null)
    .map((library) => ({
      id: library.id,
      domains: [...library.domains],
      implementationLeft: library.implementationLeft,
      verificationLeft: library.verificationLeft,
    }));
  const carryoverWork = remaining.reduce(
    (sum, library) => sum + library.implementationLeft + library.verificationLeft,
    state.coordinationLeft,
  );
  return {
    completed: phaseOf(state) === 'result',
    shipped,
    incidents: incidents.length,
    incidentLoss,
    updated: state.libraries
      .filter((library) => library.updatedAt !== null)
      .map((library) => ({
        id: library.id,
        domains: [...library.domains],
        tick: library.updatedAt,
      })),
    remaining,
    coordinationLeft: state.coordinationLeft,
    carryoverWork,
    carryCost,
    shipmentValuePerWork: 2,
    comparisonValue: shipped * 2 - incidentLoss - carryoverWork * carryCost,
    continued: true,
  };
}

export function viewLibraryDeadlineBoss(state: LibraryDeadlineState) {
  return {
    phase: phaseOf(state),
    tick: state.tick,
    activeTicks: state.activeTicks,
    capacity: state.capacity,
    batchCoordinationWork: state.batchCoordinationWork,
    coordinationLeft: state.coordinationLeft,
    plan: structuredClone(state.plan),
    canPlan: state.tick === 0 && state.plan === null,
    libraries: structuredClone(state.libraries),
    periods: structuredClone(state.periods),
    result: phaseOf(state) === 'result' ? summarizeLibraryDeadlineBoss(state) : null,
  };
}

export function chooseLibraryAction(
  state: LibraryDeadlineState,
  strategy: LibraryStrategy,
): LibraryInput {
  const view = viewLibraryDeadlineBoss(state);
  if (view.phase === 'result') return { type: 'view' };
  if (view.canPlan && strategy !== 'none') {
    return {
      type: 'plan',
      mode: strategy === 'batch' ? 'batch' : 'focus',
      order: view.libraries
        .filter((library) => strategy !== 'focus' || library.importance !== 'low')
        .map((library) => library.id),
    };
  }
  return { type: 'advance' };
}

export function compareLibraryDeadlineBoss(batchCoordinationWork = 2) {
  return (['none', 'batch', 'focus', 'serial-all'] as const).map((strategy) => {
    const initial = createLibraryDeadlineBoss();
    initial.batchCoordinationWork = batchCoordinationWork;
    let state = initial;
    while (phaseOf(state) !== 'result') {
      state = applyLibraryDeadlineBoss(state, chooseLibraryAction(state, strategy));
    }
    return {
      strategy,
      initial,
      inputs: state.inputs,
      periods: state.periods,
      result: summarizeLibraryDeadlineBoss(state),
      sensitivity: [0, 6].map((cost) => summarizeLibraryDeadlineBoss(state, cost)),
    };
  });
}
