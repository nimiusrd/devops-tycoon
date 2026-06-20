/**
 * 決定論シミュレーションエンジン（SPEC 第22.2 / 22.3）。
 *
 * 描画を一切知らず、固定タイムステップで状態を進める純TS。
 * 同一 seed・同一の step 列なら常に同一状態へ収束する。
 * Phase 1 ではスプリント（Backlog→Coding→Review→Rework→Done）を駆動する。
 */
import { createRng, type Rng } from './rng';
import { createOrgState } from './org';
import { DEFAULT_SEED } from './seed';
import { DEFAULT_SCENARIO } from './scenarios';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from './sprint';
import type { OrgState, ScenarioId, SimState, SprintResult, SprintState } from './types';

/** 固定タイムステップ（ms）。描画フレームレートから独立。 */
export const FIXED_STEP_MS = 100;

export interface EngineInit {
  seed?: string;
  scenario?: ScenarioId;
  /** AI 導入フラグ（本作のコア因果のスイッチ。第2章）。 */
  aiEnabled?: boolean;
  fixedStepMs?: number;
}

export class Engine {
  readonly fixedStepMs: number;
  private rng: Rng;
  private lastRandom = 0;
  private accumulatorMs = 0;
  private seed: string;
  private scenario: ScenarioId;
  private aiEnabled: boolean;
  private tick = 0;
  private elapsedMs = 0;
  private org: OrgState;
  private sprint: SprintState;

  constructor(init: EngineInit = {}) {
    this.fixedStepMs = init.fixedStepMs ?? FIXED_STEP_MS;
    this.seed = init.seed ?? DEFAULT_SEED;
    this.scenario = init.scenario ?? DEFAULT_SCENARIO;
    this.aiEnabled = init.aiEnabled ?? false;
    this.rng = this.recordingRng(this.seed);
    this.org = createOrgState(this.scenario, this.aiEnabled);
    this.sprint = createSprint(resolveSprintConfig(this.scenario), this.org, this.rng);
  }

  /** 消費した最新の乱数を記録するラッパ（決定論の可視化・検証用）。 */
  private recordingRng(seed: string): Rng {
    const base = createRng(seed);
    return () => {
      const v = base();
      this.lastRandom = v;
      return v;
    };
  }

  /** 1 固定ステップ進める。スプリントを 1 tick 駆動する。 */
  private tickOnce(): void {
    stepSprint(this.sprint, this.org, this.rng, this.tick);
    this.tick += 1;
    this.elapsedMs += this.fixedStepMs;
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

  /** seed/シナリオ/AIフラグを差し替えて状態を初期化する。 */
  load(
    seed: string,
    scenario: ScenarioId = this.scenario,
    aiEnabled: boolean = this.aiEnabled,
  ): void {
    this.seed = seed;
    this.scenario = scenario;
    this.aiEnabled = aiEnabled;
    this.lastRandom = 0;
    this.accumulatorMs = 0;
    this.tick = 0;
    this.elapsedMs = 0;
    this.rng = this.recordingRng(seed);
    this.org = createOrgState(scenario, aiEnabled);
    this.sprint = createSprint(resolveSprintConfig(scenario), this.org, this.rng);
  }

  /** スプリントが完了したか。 */
  isComplete(): boolean {
    return this.sprint.complete;
  }

  /** 現時点のスプリントリザルトを集計する。 */
  result(): SprintResult {
    return summarizeSprint(this.sprint, this.org);
  }

  /** 現在状態のスナップショット（ネストを含む独立コピー）。 */
  snapshot(): SimState {
    return {
      seed: this.seed,
      scenario: this.scenario,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      lastRandom: this.lastRandom,
      aiEnabled: this.aiEnabled,
      org: structuredClone(this.org),
      sprint: structuredClone(this.sprint),
    };
  }
}

export function createEngine(init?: EngineInit): Engine {
  return new Engine(init);
}
