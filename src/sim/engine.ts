/**
 * 決定論シミュレーションエンジン（SPEC 第22.2 / 22.3）。
 *
 * 描画を一切知らず、固定タイムステップで状態を進める純TS。
 * 同一 seed・同一の step 列なら常に同一状態へ収束する。
 * Phase 0 では「乱数を1つ消費して tick を進める」最小実装で、
 * 工程モデルは Phase 1 以降で `model/` に追加する。
 */
import { createRng, type Rng } from './rng';
import { DEFAULT_SEED } from './seed';
import { DEFAULT_SCENARIO } from './scenarios';
import type { ScenarioId, SimState } from './types';

/** 固定タイムステップ（ms）。描画フレームレートから独立。 */
export const FIXED_STEP_MS = 100;

export interface EngineInit {
  seed?: string;
  scenario?: ScenarioId;
  fixedStepMs?: number;
}

export class Engine {
  readonly fixedStepMs: number;
  private rng: Rng;
  private accumulatorMs = 0;
  private current: SimState;

  constructor(init: EngineInit = {}) {
    this.fixedStepMs = init.fixedStepMs ?? FIXED_STEP_MS;
    const seed = init.seed ?? DEFAULT_SEED;
    const scenario = init.scenario ?? DEFAULT_SCENARIO;
    this.rng = createRng(seed);
    this.current = Engine.freshState(seed, scenario);
  }

  private static freshState(seed: string, scenario: ScenarioId): SimState {
    return { seed, scenario, tick: 0, elapsedMs: 0, lastRandom: 0 };
  }

  /** 1 固定ステップ進める。Phase 0 では乱数を1つ消費するのみ。 */
  private tickOnce(): void {
    this.current.lastRandom = this.rng();
    this.current.tick += 1;
    this.current.elapsedMs += this.fixedStepMs;
  }

  /**
   * 経過時間 dtMs を固定タイムステップに分解して進める。
   * 端数は内部アキュムレータに蓄積され、次回以降に持ち越される。
   */
  step(dtMs: number): void {
    this.accumulatorMs += dtMs;
    while (this.accumulatorMs >= this.fixedStepMs) {
      this.tickOnce();
      this.accumulatorMs -= this.fixedStepMs;
    }
  }

  /** seed/シナリオを差し替えて状態を初期化する。 */
  load(seed: string, scenario: ScenarioId = this.current.scenario): void {
    this.rng = createRng(seed);
    this.accumulatorMs = 0;
    this.current = Engine.freshState(seed, scenario);
  }

  /** 現在状態のスナップショット（読み取り専用コピー）。 */
  snapshot(): SimState {
    return { ...this.current };
  }
}

export function createEngine(init?: EngineInit): Engine {
  return new Engine(init);
}
