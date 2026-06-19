import { createInitialSimulationState, stepSimulation } from './sim/engine';
import type { SimulationState } from './sim/types';

export const DEFAULT_SEED = 'devops-tycoon-phase-0';

export interface GameHook {
  pause(): void;
  step(ms?: number): void;
  loadState(seed: string, scenario?: string): void;
  getState(): SimulationState;
}

declare global {
  interface Window {
    game: GameHook;
  }
}

export function resolveSeed(search = window.location.search): string {
  const params = new URLSearchParams(search);
  const seed = params.get('seed')?.trim();
  return seed && seed.length > 0 ? seed : DEFAULT_SEED;
}

export function installGameHook(
  initialSeed = resolveSeed(),
  initialScenario = 'default',
): GameHook {
  let state = createInitialSimulationState(initialSeed, initialScenario);

  const hook: GameHook = {
    pause() {
      state = {
        ...state,
        paused: true,
      };
    },

    step(ms = 16) {
      state = stepSimulation(
        {
          ...state,
          paused: false,
        },
        ms,
      );
    },

    loadState(seed: string, scenario = 'default') {
      state = createInitialSimulationState(seed, scenario);
    },

    getState() {
      return { ...state };
    },
  };

  window.game = hook;
  return hook;
}
