export type ScenarioId = 'default';

export interface SimulationState {
  seed: string;
  scenario: ScenarioId | string;
  elapsedMs: number;
  paused: boolean;
}
