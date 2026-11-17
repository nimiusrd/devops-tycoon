/** RI-257: 需要予測と容量確保の独立試作。通常ラン・UI・通常保存には接続しない。 */
import { createRng, randInt } from '../sim/rng';

export type CapacityInvestment = 'small' | 'large';
export type CapacityStrategy = 'none' | 'small' | 'large' | 'small-reactive';
export type CapacityPhase = 'prepare' | 'start' | 'peak' | 'result';
export type CapacityInput =
  | { type: 'view' }
  | { type: 'invest'; level: CapacityInvestment }
  | { type: 'scale' }
  | { type: 'advance' };

const ACTIVE_TICKS = 4;
const INITIAL_BUDGET = 100;
const BASE_CAPACITY = 6;
const BASE_LEASE = 3;
const SCALE = { capacity: 5, setup: 12, lease: 10 };
const INVESTMENTS = {
  small: { capacity: 3, setup: 8, lease: 3 },
  large: { capacity: 8, setup: 22, lease: 8 },
} as const;
const FORECAST = { start: { low: 4, high: 6 }, peak: { low: 7, high: 14 } };

export interface CapacityObservation {
  tick: number;
  phase: 'start' | 'peak';
  actualDemand: number;
  capacity: number;
  served: number;
  unserved: number;
  equivalentDowntimeSeconds: number;
  unusedCapacityLease: number;
}

/** 信頼済み内部保存。plannedDemand はプレイヤー向けAPIへ渡さない。 */
export interface DemandCapacityState {
  version: 1;
  seed: string;
  plannedDemand: number[];
  tick: number;
  investment: CapacityInvestment | null;
  scaled: boolean;
  setupSpent: number;
  leaseSpent: number;
  observations: CapacityObservation[];
  inputs: CapacityInput[];
}

function phaseOf(state: DemandCapacityState): CapacityPhase {
  if (state.tick === 0) return 'prepare';
  if (state.tick > ACTIVE_TICKS) return 'result';
  return state.tick === 1 ? 'start' : 'peak';
}

function remainingTicks(state: DemandCapacityState): number {
  return ACTIVE_TICKS - state.observations.length;
}

function allocation(state: DemandCapacityState) {
  const investment = state.investment === null ? null : INVESTMENTS[state.investment];
  return {
    capacity: BASE_CAPACITY + (investment?.capacity ?? 0) + (state.scaled ? SCALE.capacity : 0),
    lease: BASE_LEASE + (investment?.lease ?? 0) + (state.scaled ? SCALE.lease : 0),
  };
}

function finance(state: DemandCapacityState) {
  const capacitySpent = state.setupSpent + state.leaseSpent;
  const committedCapacityLease = remainingTicks(state) * allocation(state).lease;
  return {
    account: 'prototype-capacity-operations' as const,
    initialBudget: INITIAL_BUDGET,
    setupSpent: state.setupSpent,
    leaseSpent: state.leaseSpent,
    capacitySpent,
    committedCapacityLease,
    normalDevelopmentBudget: INITIAL_BUDGET - capacitySpent - committedCapacityLease,
    existingToolUpkeepCharged: false as const,
  };
}

export function createDemandCapacityBoss(seed: string): DemandCapacityState {
  const rng = createRng(seed);
  const highDemand = rng() >= 0.5;
  // 生成はここだけ。再表示・操作・保存再開で乱数を消費しない。
  const plannedDemand = [
    randInt(rng, 4, 6),
    ...Array.from({ length: 3 }, () => randInt(rng, highDemand ? 12 : 7, highDemand ? 14 : 9)),
  ];
  return {
    version: 1,
    seed,
    plannedDemand,
    tick: 0,
    investment: null,
    scaled: false,
    setupSpent: 0,
    leaseSpent: 0,
    observations: [],
    inputs: [],
  };
}

function canScale(state: DemandCapacityState): boolean {
  return (
    state.tick >= 1 &&
    state.tick <= ACTIVE_TICKS &&
    !state.scaled &&
    finance(state).normalDevelopmentBudget >= SCALE.setup + remainingTicks(state) * SCALE.lease
  );
}

export function applyDemandCapacityBoss(
  state: DemandCapacityState,
  input: CapacityInput,
): DemandCapacityState {
  if (input.type === 'view' || phaseOf(state) === 'result') return state;
  if (input.type === 'invest' && (state.tick !== 0 || state.investment !== null)) return state;
  if (input.type === 'scale' && !canScale(state)) return state;
  const next = structuredClone(state);
  if (input.type === 'invest') {
    next.investment = input.level;
    next.setupSpent += INVESTMENTS[input.level].setup;
  } else if (input.type === 'scale') {
    next.scaled = true;
    next.setupSpent += SCALE.setup;
  } else if (input.type === 'advance') {
    if (next.tick > 0) {
      const { capacity, lease } = allocation(next);
      const actualDemand = next.plannedDemand[next.tick - 1]!;
      const unserved = Math.max(0, actualDemand - capacity);
      const unused = Math.max(0, capacity - actualDemand);
      const boostUnused = Math.min(next.scaled ? SCALE.capacity : 0, unused);
      const reservedUnused = Math.min(
        next.investment === null ? 0 : INVESTMENTS[next.investment].capacity,
        unused - boostUnused,
      );
      next.leaseSpent += lease;
      next.observations.push({
        tick: next.tick,
        phase: next.tick === 1 ? 'start' : 'peak',
        actualDemand,
        capacity,
        served: actualDemand - unserved,
        unserved,
        equivalentDowntimeSeconds: Math.ceil((600 * unserved) / actualDemand),
        unusedCapacityLease: reservedUnused + (boostUnused * SCALE.lease) / SCALE.capacity,
      });
    }
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}

/** 予測は帯だけ。将来の実需要・seed・内部状態による最終得点の先読みを含めない。 */
export function viewDemandCapacityBoss(state: DemandCapacityState) {
  return {
    phase: phaseOf(state),
    tick: state.tick,
    forecast: structuredClone(FORECAST),
    capacity: allocation(state).capacity,
    investment: state.investment,
    scaled: state.scaled,
    investmentOptions:
      state.tick === 0 && state.investment === null ? structuredClone(INVESTMENTS) : null,
    scaleOption: { ...SCALE, available: canScale(state), effective: 'next-advance' as const },
    finance: finance(state),
    // コピーを返し、表示側が内部の履歴を変更できないようにする。
    observations: structuredClone(state.observations),
    result: phaseOf(state) === 'result' ? summarizeDemandCapacityBoss(state) : null,
  };
}

/** 評価専用。停止損失は比較係数であり、予算に二重計上しない。 */
export function summarizeDemandCapacityBoss(state: DemandCapacityState, lossPerSecond = 0.1) {
  const equivalentDowntimeSeconds = state.observations.reduce(
    (sum, observation) => sum + observation.equivalentDowntimeSeconds,
    0,
  );
  const normalDevelopmentBudget = finance(state).normalDevelopmentBudget;
  return {
    completed: phaseOf(state) === 'result',
    ...finance(state),
    equivalentDowntimeSeconds,
    unusedCapacityLease: state.observations.reduce(
      (sum, item) => sum + item.unusedCapacityLease,
      0,
    ),
    served: state.observations.reduce((sum, item) => sum + item.served, 0),
    unserved: state.observations.reduce((sum, item) => sum + item.unserved, 0),
    lossPerSecond,
    comparisonValue: normalDevelopmentBudget - equivalentDowntimeSeconds * lossPerSecond,
    continued: true,
  };
}

/** 比較方針も公開済み観測しか読まない。入力なしは時間進行だけを行う。 */
export function chooseCapacityAction(
  state: DemandCapacityState,
  strategy: CapacityStrategy,
): CapacityInput {
  const view = viewDemandCapacityBoss(state);
  if (view.phase === 'result') return { type: 'view' };
  if (view.investmentOptions !== null && strategy !== 'none') {
    return { type: 'invest', level: strategy === 'large' ? 'large' : 'small' };
  }
  const last = view.observations[view.observations.length - 1];
  if (strategy === 'small-reactive' && last && last.unserved > 0 && view.scaleOption.available) {
    return { type: 'scale' };
  }
  return { type: 'advance' };
}

export function compareDemandCapacityBoss(seeds: string[]) {
  return seeds.flatMap((seed) =>
    (['none', 'small', 'large', 'small-reactive'] as const).map((strategy) => {
      const initial = createDemandCapacityBoss(seed);
      let state = initial;
      while (phaseOf(state) !== 'result') {
        state = applyDemandCapacityBoss(state, chooseCapacityAction(state, strategy));
      }
      return {
        seed,
        strategy,
        initial,
        inputs: state.inputs,
        observations: state.observations,
        result: summarizeDemandCapacityBoss(state),
        sensitivity: [0.05, 0.15].map((loss) => summarizeDemandCapacityBoss(state, loss)),
      };
    }),
  );
}
