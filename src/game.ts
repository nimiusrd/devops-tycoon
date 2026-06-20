/**
 * 決定論フック `window.game`（SPEC 第22.5）。
 *
 * E2E / デバッグから状態を固定・前進できるようにする骨組み。
 * `pause/resume/step/loadState` を露出し、Playwright が seed と
 * 一時停止でフレームを固定できることを保証する。
 */
import { createEngine, type Engine } from './sim/engine';
import { resolveSeedFromLocation } from './sim/seed';
import { DEFAULT_SCENARIO } from './sim/scenarios';
import type { ScenarioId, SimState } from './sim/types';

export interface GameHandle {
  /** 自動進行を止める。 */
  pause(): void;
  /** 自動進行を再開する。 */
  resume(): void;
  /** 一時停止中か。 */
  isPaused(): boolean;
  /** 指定 ms ぶん手動で前進させ、進行後の状態を返す。 */
  step(ms: number): SimState;
  /** seed/シナリオを読み込み直して状態をリセットし、初期状態を返す。 */
  loadState(seed: string, scenario?: ScenarioId): SimState;
  /** 現在状態のスナップショット。 */
  getState(): SimState;
  /** 内部エンジン（高度なデバッグ用）。 */
  readonly engine: Engine;
}

export interface CreateGameOptions {
  seed?: string;
  scenario?: ScenarioId;
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const scenario = options.scenario ?? DEFAULT_SCENARIO;
  const engine = createEngine({ seed, scenario });
  let paused = false;

  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    step(ms: number) {
      engine.step(ms);
      return engine.snapshot();
    },
    loadState(nextSeed: string, nextScenario?: ScenarioId) {
      engine.load(nextSeed, nextScenario);
      return engine.snapshot();
    },
    getState() {
      return engine.snapshot();
    },
    engine,
  };
}

declare global {
  interface Window {
    game?: GameHandle;
  }
}

/**
 * `window.game` を生成して公開する。アプリ起動時に一度だけ呼ぶ。
 */
export function installGame(options?: CreateGameOptions): GameHandle {
  const handle = createGame(options);
  if (typeof window !== 'undefined') {
    window.game = handle;
  }
  return handle;
}
