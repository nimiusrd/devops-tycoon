/**
 * 決定論シミュレーションエンジン（SPEC 第22.2 / 22.3）。
 *
 * 描画を一切知らず、固定タイムステップで状態を進める純TS。
 * 同一 seed・同一の step / dispatch 列なら常に同一状態へ収束する。
 * Phase 2 ではスプリント駆動に加え、介入アクションのディスパッチ（イベント入力）と
 * スプリント後のドラフト→デッキ更新による周回（第6章 / 第7章）を担う。
 */
import { applyAction } from './actions';
import { dealHand, drawDraft, playCardFromHand } from './cards';
import { IDENTITY_CARD_EFFECTS } from './model';
import { createOrgState } from './org';
import { createRng, type Rng } from './rng';
import { DEFAULT_SEED } from './seed';
import { DEFAULT_SCENARIO } from './scenarios';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from './sprint';
import type {
  ActionId,
  ActionTarget,
  CardEffects,
  CardInstance,
  CardPlayOutcome,
  InterventionOutcome,
  OrgState,
  ScenarioId,
  SimState,
  SprintResult,
  SprintState,
} from './types';

/** 固定タイムステップ（ms）。描画フレームレートから独立。 */
export const FIXED_STEP_MS = 100;

export interface EngineInit {
  seed?: string;
  scenario?: ScenarioId;
  /** AI 導入フラグ（本作のコア因果のスイッチ。第2章）。 */
  aiEnabled?: boolean;
  /** 初期デッキ（既定は空＝Phase 1 と同一挙動）。 */
  deck?: CardInstance[];
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
  private deck: CardInstance[];
  private sprintIndex = 0;
  /** スプリント開始時のパッシブ係数（カード未発動ベース）。 */
  private sprintPassiveEffects: CardEffects = { ...IDENTITY_CARD_EFFECTS };

  constructor(init: EngineInit = {}) {
    this.fixedStepMs = init.fixedStepMs ?? FIXED_STEP_MS;
    this.seed = init.seed ?? DEFAULT_SEED;
    this.scenario = init.scenario ?? DEFAULT_SCENARIO;
    this.aiEnabled = init.aiEnabled ?? false;
    this.deck = init.deck ? init.deck.map((c) => ({ ...c })) : [];
    this.rng = this.recordingRng(this.seed);
    this.org = this.buildOrg();
    this.sprint = this.buildSprint();
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

  /** シナリオ＋AIから、このスプリント開始時の組織状態を作る（カードは発動時反映）。 */
  private buildOrg(carry?: Pick<OrgState, 'deliveryScore' | 'techDebt'>): OrgState {
    const org = createOrgState(this.scenario, this.aiEnabled);
    if (carry) {
      org.deliveryScore = carry.deliveryScore;
      org.techDebt = carry.techDebt;
    }
    return org;
  }

  /** パッシブのみでスプリントを生成し、手札を配る（RI-30）。 */
  private buildSprint(): SprintState {
    this.sprintPassiveEffects = { ...IDENTITY_CARD_EFFECTS };
    const sprint = createSprint(
      resolveSprintConfig(this.scenario),
      this.org,
      this.rng,
      this.sprintPassiveEffects,
    );
    const dealRng = createRng(`${this.seed}:deal:${this.sprintIndex}`);
    sprint.cardPiles = dealHand(this.deck.length, dealRng);
    return sprint;
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

  /**
   * 介入アクションを発動する（イベント入力。architecture §2）。
   * 集中力・クールダウン・対象の有無を検査し、成立時のみ状態を更新する。
   */
  dispatch(id: ActionId, target?: ActionTarget): InterventionOutcome {
    return applyAction(id, this.sprint, this.org, this.rng, this.tick, target);
  }

  /** 手札からカードを発動する（deckIndex。RI-30）。 */
  playCard(deckIndex: number): CardPlayOutcome {
    return playCardFromHand(this.sprint, this.org, this.deck, deckIndex, this.sprintPassiveEffects);
  }

  /**
   * スプリント後のドラフトで選んだカードをデッキに加え、次スプリントを開始する。
   * `pickedDefId` 省略でスキップ。乱数列は継続するため周回ごとに展開が変わる。
   */
  nextSprint(pickedDefId?: string): void {
    if (pickedDefId) this.deck.push({ defId: pickedDefId, level: 1 });
    this.sprintIndex += 1;
    this.accumulatorMs = 0;
    this.tick = 0;
    this.elapsedMs = 0;
    this.org = this.buildOrg({
      deliveryScore: this.org.deliveryScore,
      techDebt: this.org.techDebt,
    });
    this.sprint = this.buildSprint();
  }

  /** seed/シナリオ/AIフラグを差し替えて新しいラン（デッキ空）を初期化する。 */
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
    this.deck = [];
    this.sprintIndex = 0;
    this.rng = this.recordingRng(seed);
    this.org = this.buildOrg();
    this.sprint = this.buildSprint();
  }

  /** スプリントが完了したか。 */
  isComplete(): boolean {
    return this.sprint.complete;
  }

  /** 現時点のスプリントリザルトを集計する。 */
  result(): SprintResult {
    return summarizeSprint(this.sprint, this.org);
  }

  /**
   * 現スプリント完了時に提示するドラフト候補（カード定義 ID×3）。
   * 専用の派生 seed から引くため、呼び出すタイミングに依らず安定する（第7.1）。
   */
  draftOptions(): string[] {
    return drawDraft(createRng(`${this.seed}:draft:${this.sprintIndex}`));
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
      sprintIndex: this.sprintIndex,
      deck: this.deck.map((c) => ({ ...c })),
      draft: this.sprint.complete ? this.draftOptions() : null,
    };
  }
}

export function createEngine(init?: EngineInit): Engine {
  return new Engine(init);
}
