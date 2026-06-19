import type { SimulationState } from './types';

export function createInitialSimulationState(seed: string, scenario = 'default'): SimulationState {
  return {
    seed,
    scenario,
    elapsedMs: 0,
    paused: false,
  };
}

export function stepSimulation(state: SimulationState, deltaMs: number): SimulationState {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error('stepSimulation requires a non-negative finite deltaMs.');
  }

  if (state.paused) {
    return state;
  }

  return {
    ...state,
    elapsedMs: state.elapsedMs + deltaMs,
  };
}
