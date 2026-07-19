/**
 * ラン（1四半期）オーケストレーター（SPEC 第3章 / 第4.4〜4.6 / 第8〜17章）。
 *
 * Phase 2 のスプリント純関数（createSprint/stepSprint/applyAction/summarizeSprint）を
 * 再利用し、その上にローグライクの入れ子——**固定トラック（スプリント列）＋スプリント間の
 * ビート（判定/選択イベント）**——とショップ/休息/ボス/勝敗/診断を載せた決定論エンジン。
 * 四半期は固定長のスプリント列で、最終スプリントがボス。スプリントの合間に毎回ビートが
 * 挟まり、組織状態で重み付けした判定/選択イベントを seed付き決定論で引く（第22.3）。
 * `org` はラン中を通じて持続し、各スプリントの消耗が次へ引き継がれる。
 */
import { BOSS_DEFS, getBoss } from '../../data/bosses';
import { getCard } from '../../data/cards';
import { DEPARTMENT_DEFS } from '../../data/departments';
import { getDifficulty, getTrial } from '../../data/difficulties';
import { EVENT_DEFS, RECRUIT_SKIP_MORALE, effectiveKind, getEvent } from '../../data/events';
import { getEvolutionNode } from '../../data/evolution';
import { RELIC_DEFS, getRelic } from '../../data/relics';
import { applyAction } from '../actions';
import { applyDeckBaseline, dealHand, drawDraft, playCardFromHand, upgradeCardAt } from '../cards';
import { diagnose } from '../diagnosis';
import {
  activeEngineerCount,
  aiAssignedCount,
  applySprintGrowth,
  assignMember,
  canRecruit,
  createInitialRoster,
  pickRecruitArchetype,
  recoverStamina,
  recruitMember,
  setAiAssigned,
  RECRUIT_COST,
  REST_STAMINA_RECOVER,
  STAMINA_RECOVER_BETWEEN,
} from '../member';
import type { GrowthOutcome, LaneAssignment, RosterState } from '../member/types';
import { FIXED_STEP_MS } from '../engine';
import { evaluateBoss, evaluateLose, evaluateWinType } from '../outcome';
import { createRng } from '../rng';
import { DEFAULT_SEED } from '../seed';
import { resolveSprintConfig, stepSprint, summarizeSprint } from '../sprint';
import type {
  ActionId,
  ActionTarget,
  CardEffects,
  CardPlayOutcome,
  InterventionOutcome,
  OrgState,
  SprintConfig,
  SprintResult,
  SprintState,
} from '../types';
import { IDENTITY_CARD_EFFECTS } from '../model';
import { applyLever, emptyAdjustState, generateIndustry, generateOrgScale } from '../orgscale';
import type {
  IndustryState,
  OrgAdjustState,
  OrgScaleState,
  RankingKind,
  ZoomLevel,
  ZoomState,
} from '../orgscale/types';
import { foldPassives, toEffects } from './effects';
import {
  applyEventOutcome,
  eventEligible,
  eventSignals,
  eventsOfKind,
  pickWeighted,
  weightedEventPool,
} from './events';
import { canUnlock, unlockNode } from './evolution';
import { canTransition, RunPhaseError } from './phases';
import {
  applyGoalAdjustment,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  canAcknowledgeWin,
  canChooseAdjustment,
  isTerminalFailure,
  loseReasonForOutcome,
} from './quarterReview';
import { createSprintFromBaselineInput, runNoInterventionBaseline } from './sprintBaseline';
import type { SprintBaselineInput } from './sprintBaseline';
import {
  applyTrialAiDependencyPressure,
  BETWEEN_SPRINT_RECOVERY,
  buildSprintBaselineInput,
} from './sprintBaselineBuild';
import { computeWhatIfState, whatIfCacheKey, type WhatIfComputeInput } from './whatIfState';
import type {
  BeatState,
  DifficultyId,
  EvolutionState,
  GoalAdjustmentId,
  LoseReason,
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunState,
  RunStatus,
  RunTotals,
  RunKind,
  ShopOffer,
  SprintKind,
  SprintModifierDelta,
  StakeholderTrust,
  StartRunOptions,
  WhatIfState,
  WinType,
} from './types';
import {
  isSaveablePhase,
  RUN_SAVE_ENGINE_VERSION,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSaveBlob,
  type RunSavePrivate,
  type RunSaveState,
} from './hydrateState';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 1 四半期あたりのスプリント数（最終インデックスがボス）。 */
export const SPRINTS_PER_QUARTER = 6;
/** 各ビートで選択イベント（decision）を引く確率。残りは判定イベント（judgment）。 */
export const DECISION_BEAT_CHANCE = 0.55;
/** 休息（heal）でのシニア体力回復量（UI プレビューと共有）。 */
export const REST_HEAL = 40;
/** 休息（heal）での士気回復量。 */
export const REST_MORALE_HEAL = 10;
/** 休息（repay）での技術的負債返済量（UI プレビューと共有）。 */
export const REST_REPAY = 30;
/** ショップのレリック価格（割引前）。 */
const SHOP_RELIC_COST = 30;

export interface RunEngineInit {
  seed?: string;
  difficulty?: DifficultyId;
  trials?: string[];
  allowedCards?: ReadonlySet<string>;
  allowedRelics?: ReadonlySet<string>;
}

function emptyTotals(): RunTotals {
  return {
    delivered: 0,
    done: 0,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    aiAssisted: 0,
    completed: 0,
    reviewQueuePeak: 0,
    maxCombo: 0,
    consecutiveIncidentSprints: 0,
  };
}

/** 次スプリント限定の一時効果を合成する（taskCountMul は乗算、加算系は加算）。 */
function mergeModifiers(a: SprintModifierDelta, b: SprintModifierDelta): SprintModifierDelta {
  const reviewLoadAdd = (a.reviewLoadAdd ?? 0) + (b.reviewLoadAdd ?? 0);
  const reworkRateAdd = (a.reworkRateAdd ?? 0) + (b.reworkRateAdd ?? 0);
  const taskCountMul = (a.taskCountMul ?? 1) * (b.taskCountMul ?? 1);
  return {
    ...(reviewLoadAdd !== 0 ? { reviewLoadAdd } : {}),
    ...(reworkRateAdd !== 0 ? { reworkRateAdd } : {}),
    ...(taskCountMul !== 1 ? { taskCountMul } : {}),
  };
}

function addSprintTotals(
  t: RunTotals,
  result: SprintResult,
  metrics: { aiAssistedCompleted: number; completedCount: number },
): void {
  t.delivered += result.delivered;
  t.done += result.done;
  t.rework += result.rework;
  t.incidents += result.incidents;
  t.contained += result.contained;
  t.spread += result.spread;
  t.aiAssisted += metrics.aiAssistedCompleted;
  t.completed += metrics.completedCount;
  t.reviewQueuePeak = Math.max(t.reviewQueuePeak, result.reviewQueueMax);
  t.maxCombo = Math.max(t.maxCombo, result.maxCombo);
  t.consecutiveIncidentSprints = result.spread > 0 ? (t.consecutiveIncidentSprints ?? 0) + 1 : 0;
}

/** 難易度の組織プリセットから初期 `OrgState` を作る（AI 導入済みの組織を前提）。 */
function buildRunOrg(difficulty: DifficultyId): OrgState {
  const { org } = getDifficulty(difficulty);
  return {
    aiEnabled: true,
    aiDependency: org.aiDependencyBase,
    aiLiteracy: org.aiLiteracy,
    testCoverage: org.testCoverage,
    documentation: org.documentation,
    quality: org.quality,
    morale: org.morale,
    seniorHp: org.seniorHp,
    techDebt: 0,
    deliveryScore: 0,
  };
}

export class RunEngine {
  private seed: string;
  private difficulty: DifficultyId;
  private trials: string[];
  private allowedCards: ReadonlySet<string> | null = null;
  private allowedRelics: ReadonlySet<string> | null = null;

  private bossId!: string;
  private baseConfig!: SprintConfig;

  private org!: OrgState;
  private deck: { defId: string; level: number }[] = [];
  private relics: string[] = [];
  private bossRelicReward: string | undefined;
  /** ボス報酬適用前の org（勝利種別判定用。報酬で同じ四半期の称号を押し上げない）。 */
  private winEvalOrg: OrgState | null = null;
  private evolution!: EvolutionState;
  private roster!: RosterState;
  private lastGrowth: GrowthOutcome | null = null;
  private budget = 0;

  private phase: RunState['phase'] = 'title';
  private status: RunStatus = 'playing';
  private runKind: RunKind = 'normal';
  private dailyDate: string | undefined;
  private winType?: WinType;
  private loseReason?: LoseReason;

  // 固定トラック（旧マップの置換）。
  private sprintsPerQuarter = SPRINTS_PER_QUARTER;
  /** 当四半期で進行中／直近に開始したスプリントの 1 起点インデックス（0=未開始）。 */
  private sprintIndexInQuarter = 0;
  /** 次スプリントの種別（ビートの選択／ボス強制で確定。一回消費）。 */
  private pendingSprintKind: SprintKind = 'normal';
  /** 進行中スプリントの種別（完了時の評価・進化ポイントまで保持）。 */
  private currentSprintKind: SprintKind = 'normal';
  /** 次スプリント限定の一時効果（beginSprint で消費）。 */
  private pendingSprintModifiers: SprintModifierDelta = {};
  /** 提示中のビート（beat フェーズのみ）。 */
  private beat: BeatState | null = null;

  private currentSprintId: string | null = null;
  private sprint: SprintState | null = null;
  private sprintRng = createRng('init');
  private sprintTick = 0;
  private accumulatorMs = 0;
  private sprintBaselineInput: SprintBaselineInput | null = null;
  /** スプリント開始時のパッシブ係数（カード発動時の合成ベース。RI-30）。 */
  private sprintPassiveEffects: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  private lastResult: SprintResult | null = null;
  private draft: string[] | null = null;
  private shop: ShopOffer | null = null;

  private diagnosis: RunState['diagnosis'] = 'healthyAcceleration';
  private sprintsPlayed = 0;
  /** ラン通算（勝利種別・メタ報酬用）。 */
  private totals: RunTotals = emptyTotals();
  /** 当四半期のみ（四半期レビュー KPI 用）。 */
  private quarterTotals: RunTotals = emptyTotals();
  private usedHeavyActions = false;

  // 組織スケール（第4.7〜4.11）。ズーム状態とレバー蓄積を持つ。
  private zoom: ZoomState = { level: 'team', deptId: null, teamId: null };
  private rankingKind: RankingKind = 'overall';
  private orgAdjust: OrgAdjustState = emptyAdjustState();

  private quarterNumber = 1;
  private quarterGoal!: QuarterGoal;
  private stakeholderTrust!: StakeholderTrust;
  private quarterReview: QuarterReview | null = null;
  private goalAdjustmentsTaken: GoalAdjustmentId[] = [];
  private reviewHistory: QuarterOutcome[] = [];
  private nextBudgetCap: number | null = null;
  /** pause_ai_rollout の速度デバフが有効な四半期（その四半期のみ）。 */
  private pauseAiDebuffQuarter: number | null = null;
  /** UI 向け what-if 試算のキャッシュ（同一入力の再計算を避ける）。 */
  private whatIfCache: { key: string; value: WhatIfState | null } | null = null;

  constructor(init: RunEngineInit = {}) {
    this.seed = init.seed ?? DEFAULT_SEED;
    this.difficulty = init.difficulty ?? 'normal';
    this.trials = init.trials ?? [];
    this.allowedCards = init.allowedCards ?? null;
    this.allowedRelics = init.allowedRelics ?? null;
    this.initRun();
    this.resetPhase('title');
  }

  /**
   * フェーズを遷移表（`RUN_PHASE_TRANSITIONS`）で検証して進める。
   * 表に無い遷移はエンジン実装のバグなので常に throw する（決定論なので再現可能）。
   */
  private setPhase(next: RunState['phase']): void {
    if (!canTransition(this.phase, next)) throw new RunPhaseError(this.phase, next);
    this.phase = next;
  }

  /**
   * フェーズを遷移表を経ずにリセットする（新規ラン・タイトル復帰の入口のみ）。
   * XState 的にはアクターの再生成に相当し、won/lost からのリスタートもここを通る。
   */
  private resetPhase(next: 'title' | 'setup'): void {
    this.phase = next;
  }

  /** ラン開始時点の解放プールを設定する（ラン中は固定）。 */
  setUnlockedContent(cards: ReadonlySet<string>, relics: ReadonlySet<string>): void {
    this.allowedCards = cards;
    this.allowedRelics = relics;
  }

  /** タイトルで選んだ難易度・試練でランを開始する（phase=setup）。 */
  startRun(
    difficulty: DifficultyId = this.difficulty,
    trials: string[] = this.trials,
    seed?: string,
    options?: StartRunOptions,
  ): void {
    if (seed !== undefined) this.seed = seed;
    this.difficulty = difficulty;
    this.trials = trials;
    this.initRun();
    this.runKind = options?.kind ?? 'normal';
    this.dailyDate = options?.dailyDate;
    this.resetPhase('setup');
  }

  /** タイトル画面へ戻る（新しいランの難易度選択へ）。 */
  toTitle(seed?: string): void {
    if (seed !== undefined) this.seed = seed;
    this.initRun();
    this.resetPhase('title');
  }

  /** 内部状態をランの初期状態へ戻す（組織・予算・進化・トラックを作り直す）。 */
  private initRun(): void {
    this.quarterNumber = 1;
    this.bossId = this.pickBoss(1);
    const diff = getDifficulty(this.difficulty);
    const base = resolveSprintConfig('default');
    this.baseConfig = {
      ...base,
      taskCount: Math.max(6, Math.round(base.taskCount * diff.taskCountMul)),
    };
    this.org = buildRunOrg(this.difficulty);
    this.deck = [];
    this.relics = [];
    this.bossRelicReward = undefined;
    this.winEvalOrg = null;
    this.evolution = { points: 0, unlocked: {} };
    this.roster = createInitialRoster(createRng(`${this.seed}:roster`));
    this.lastGrowth = null;
    this.budget = Math.round(diff.startBudget * this.trialBudgetMul());
    this.stakeholderTrust = buildInitialTrust(this.difficulty);
    const boss = getBoss(this.bossId);
    this.quarterGoal = boss
      ? buildQuarterGoal(boss, this.difficulty, diff.bossTargetMul)
      : {
          deliveryTarget: 60,
          qualityTarget: 45,
          techDebtLimit: 55,
          moraleTarget: 40,
          incidentLimit: 6,
        };
    this.quarterReview = null;
    this.goalAdjustmentsTaken = [];
    this.reviewHistory = [];
    this.nextBudgetCap = null;
    this.pauseAiDebuffQuarter = null;
    this.sprintsPerQuarter = SPRINTS_PER_QUARTER;
    this.sprintIndexInQuarter = 0;
    this.pendingSprintKind = 'normal';
    this.currentSprintKind = 'normal';
    this.pendingSprintModifiers = {};
    this.beat = null;
    this.currentSprintId = null;
    this.sprint = null;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprintBaselineInput = null;
    this.lastResult = null;
    this.draft = null;
    this.shop = null;
    this.diagnosis = 'healthyAcceleration';
    this.sprintsPlayed = 0;
    this.totals = emptyTotals();
    this.quarterTotals = emptyTotals();
    this.usedHeavyActions = false;
    this.zoom = { level: 'team', deptId: null, teamId: null };
    this.rankingKind = 'overall';
    this.orgAdjust = emptyAdjustState();
    this.status = 'playing';
    this.runKind = 'normal';
    this.dailyDate = undefined;
    this.winType = undefined;
    this.loseReason = undefined;
  }

  private pickBoss(quarterNumber: number): string {
    const rng = createRng(`${this.seed}:boss:q${quarterNumber}`);
    const ids = BOSS_DEFS.map((b) => b.id);
    return ids[Math.floor(rng() * ids.length)];
  }

  private trialBudgetMul(): number {
    return this.trials.reduce((m, id) => m * (getTrial(id)?.budgetMul ?? 1), 1);
  }

  /**
   * 試練「フロンティアモデル依存」のスプリント開始時コストを適用する。
   * 依存度が高いほど高価なモデルへ安易に寄り、予算消費も増える。
   */
  private applyTrialAiDependencyPressure(org: OrgState, budget: number): number {
    return applyTrialAiDependencyPressure(org, budget, {
      deck: this.deck,
      relics: this.relics,
      evolution: this.evolution,
      difficulty: this.difficulty,
      trials: this.trials,
    });
  }

  // --- セットアップ → スプリント起動 ---

  /**
   * 編成フェーズ（setup / setup-pre）から次スプリントを開始する。
   * 第1スプリント・ショップ/休息後・次四半期の開始入口（旧 enterNode の置換）。
   */
  beginSetupSprint(): void {
    if (this.phase !== 'setup') return;
    this.launchSprint();
  }

  /**
   * トラック上の次スプリントを起動する。種別は pendingSprintKind を消費し、
   * トラック最終インデックスでは必ず boss を優先する（二重決定防止）。
   */
  private launchSprint(): void {
    const index = this.sprintIndexInQuarter + 1;
    const kind: SprintKind = index >= this.sprintsPerQuarter ? 'boss' : this.pendingSprintKind;
    const modifiers = this.pendingSprintModifiers;
    this.sprintIndexInQuarter = index;
    this.currentSprintKind = kind;
    this.currentSprintId = `q${this.quarterNumber}-s${index}`;
    // 一回消費（次ビートが種別/効果を明示しない限り、次は normal / 無効果）。
    this.pendingSprintKind = 'normal';
    this.pendingSprintModifiers = {};
    this.beginSprint(kind, modifiers);
  }

  private beginSprint(kind: SprintKind, modifiers: SprintModifierDelta): void {
    // スプリント間のギャップでシニア体力が一部回復する（持続的な過負荷のみ燃え尽きへ）。
    this.org.seniorHp = clamp(
      this.org.seniorHp + (100 - this.org.seniorHp) * BETWEEN_SPRINT_RECOVERY,
      0,
      100,
    );
    this.budget = this.applyTrialAiDependencyPressure(this.org, this.budget);
    // 試練の開始時コストで予算が尽きた場合はスプリントへ進まず継続不能にする。
    if (this.applyImmediateLose()) return;
    this.sprintBaselineInput = this.buildSprintBaselineInput({
      deck: this.deck,
      roster: this.roster,
      org: this.org,
      kind,
      modifiers,
      seed: `${this.seed}:sprint:${this.currentSprintId}`,
    });
    const initialized = createSprintFromBaselineInput(this.sprintBaselineInput, this.org);
    this.sprintRng = initialized.rng;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprint = initialized.sprint;
    // パッシブ（レリック等）のみを基準に保持し、手札を配布する（RI-30）。
    this.sprintPassiveEffects = { ...this.sprint.cardEffects };
    const dealRng = createRng(`${this.seed}:deal:${this.currentSprintId}`);
    this.sprint.cardPiles = dealHand(this.deck.length, dealRng);
    this.setPhase('sprint');
  }

  /**
   * 指定したデッキ・編成から次スプリントの純粋な初期入力を組み立てる。
   * 本番起動と RI-46 の試算で共有し、候補試算中に実ランの状態を変更しない。
   */
  private buildSprintBaselineInput({
    deck,
    roster,
    org,
    kind,
    modifiers,
    seed,
    playedCards = [],
  }: {
    deck: { defId: string; level: number }[];
    roster: RosterState;
    org: OrgState;
    kind: SprintKind;
    modifiers: SprintModifierDelta;
    seed: string;
    /** what-if: 次スプリントで発動すると仮定するカード（RI-30）。 */
    playedCards?: { defId: string; level: number }[];
  }): SprintBaselineInput {
    return buildSprintBaselineInput(
      {
        relics: this.relics,
        evolution: this.evolution,
        difficulty: this.difficulty,
        trials: this.trials,
        bossId: this.bossId,
        pauseAiDebuffQuarter: this.pauseAiDebuffQuarter,
        quarterNumber: this.quarterNumber,
        baseConfig: this.baseConfig,
      },
      { deck, roster, org, kind, modifiers, seed, playedCards },
    );
  }

  /** 進行中スプリントを dtMs 分だけ固定タイムステップで進める。 */
  step(dtMs: number): void {
    if (this.phase !== 'sprint' || !this.sprint || this.sprint.complete) return;
    this.accumulatorMs += dtMs;
    while (this.accumulatorMs >= FIXED_STEP_MS && this.sprint && !this.sprint.complete) {
      stepSprint(this.sprint, this.org, this.sprintRng, this.sprintTick);
      this.sprintTick += 1;
      this.accumulatorMs -= FIXED_STEP_MS;
    }
    if (this.sprint && this.sprint.complete) this.resolveSprint();
  }

  /** 介入アクションを発動する（sprint フェーズのみ。第6章）。 */
  dispatch(id: ActionId, target?: ActionTarget): InterventionOutcome {
    if (this.phase !== 'sprint' || !this.sprint) return { ok: false, reason: 'complete' };
    const outcome = applyAction(id, this.sprint, this.org, this.sprintRng, this.sprintTick, target);
    if (outcome.ok && (id === 'overtime' || id === 'andon')) this.usedHeavyActions = true;
    return outcome;
  }

  /** 手札からカードを発動する（deckIndex。sprint フェーズのみ。RI-30 / SPEC 第7.1）。 */
  playCard(deckIndex: number): CardPlayOutcome {
    if (this.phase !== 'sprint' || !this.sprint) return { ok: false, reason: 'complete' };
    const outcome = playCardFromHand(
      this.sprint,
      this.org,
      this.deck,
      deckIndex,
      this.sprintPassiveEffects,
    );
    if (outcome.ok) this.applyImmediateLose();
    return outcome;
  }

  /** スプリント完了時の集計・診断・勝敗判定・進化ポイント付与。 */
  private resolveSprint(): void {
    if (!this.sprint || !this.currentSprintId) return;
    const result = summarizeSprint(this.sprint, this.org);
    if (this.sprintBaselineInput) {
      result.baseline = runNoInterventionBaseline(this.sprintBaselineInput);
    }
    this.lastResult = result;
    this.sprintsPlayed += 1;
    this.accumulateTotals(result);
    this.applyGrowth(result);
    // スプリント終了時に個体スタミナを一部回復する（休職者は復帰しうる）。
    // ここで回復させることで、続くビート／編成ウィンドウで復帰メンバーをすぐ再配置できる。
    const justLeft = new Set((this.lastGrowth?.wentOnLeave ?? []).map((w) => w.id));
    this.roster = recoverStamina(this.roster, STAMINA_RECOVER_BETWEEN, justLeft);
    this.diagnosis = diagnose(this.org, this.totals);

    if (this.currentSprintKind === 'boss') {
      const lose = evaluateLose(this.org, this.totals, this.budget);
      if (lose) {
        this.status = 'lost';
        this.loseReason = lose;
        this.setPhase('lost');
        return;
      }
      const boss = getBoss(this.bossId);
      const bossTargetMul = getDifficulty(this.difficulty).bossTargetMul;
      const bossCleared = !!boss && evaluateBoss({ boss, result, org: this.org, bossTargetMul });
      // 四半期 KPI は報酬前の org で判定する（報酬の加算効果が同じ四半期を書き換えないように）。
      this.quarterReview = buildQuarterReview({
        goal: this.quarterGoal,
        org: this.org,
        totals: this.quarterTotals,
        trust: this.stakeholderTrust,
        budget: this.budget,
        quarterNumber: this.quarterNumber,
        bossSprintCleared: bossCleared,
      });
      if (bossCleared) {
        // 勝利種別も報酬前の組織状態で判定する。
        this.winEvalOrg = structuredClone(this.org);
        this.bossRelicReward = this.grantBossRelic();
      }
      this.reviewHistory = [...this.reviewHistory, this.quarterReview.outcome];
      this.setPhase('quarterReview');
      return;
    }

    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.status = 'lost';
      this.loseReason = lose;
      this.setPhase('lost');
      return;
    }

    this.evolution = {
      ...this.evolution,
      points: this.evolution.points + this.evoPointsFor(result),
    };
    this.setPhase('result');
  }

  private accumulateTotals(result: SprintResult): void {
    if (!this.sprint) return;
    const m = this.sprint.metrics;
    addSprintTotals(this.totals, result, m);
    addSprintTotals(this.quarterTotals, result, m);
  }

  /**
   * スプリント後の個体成長・消耗・離脱を適用する（第12.2）。
   * 配置された稼働メンバーが経験値を得て昇格し、スタミナを消費して休職しうる。
   * ドキュメント魔などが積んだドキュメントを組織へ反映する。乱数はスプリント単位で派生。
   */
  private applyGrowth(result: SprintResult): void {
    if (!this.sprint || !this.currentSprintId) return;
    const rng = createRng(`${this.seed}:growth:${this.currentSprintId}`);
    const { roster, outcome } = applySprintGrowth(
      this.roster,
      { delivered: result.delivered, done: result.done },
      rng,
    );
    this.roster = roster;
    this.lastGrowth = outcome;
    if (outcome.docGain > 0) {
      this.org.documentation = clamp(this.org.documentation + outcome.docGain, 0, 100);
    }
  }

  private evoPointsFor(result: SprintResult): number {
    const base = 1 + Math.floor(result.delivered / 40);
    return this.currentSprintKind === 'elite' ? base + 1 : base;
  }

  /** 四半期レビューを承認する（達成→won / 継続不能→lost）。 */
  acknowledgeQuarterReview(): void {
    if (this.phase !== 'quarterReview' || !this.quarterReview) return;
    const { outcome } = this.quarterReview;
    if (canAcknowledgeWin(outcome)) {
      this.status = 'won';
      this.winType = evaluateWinType({
        org: this.winEvalOrg ?? this.org,
        totals: this.totals,
        budget: this.budget,
        usedHeavyActions: this.usedHeavyActions,
      });
      this.setPhase('won');
      return;
    }
    if (isTerminalFailure(outcome)) {
      this.status = 'lost';
      this.loseReason = loseReasonForOutcome(outcome);
      this.setPhase('lost');
    }
  }

  /** 目標修正を選び、次四半期へ進む（missed_adjustable のみ）。 */
  chooseGoalAdjustment(id: GoalAdjustmentId): void {
    if (this.phase !== 'quarterReview' || !this.quarterReview) return;
    if (!canChooseAdjustment(this.quarterReview.outcome)) return;
    if (!this.quarterReview.availableAdjustments.includes(id)) return;

    const applied = applyGoalAdjustment(
      {
        goal: this.quarterGoal,
        trust: this.stakeholderTrust,
        org: this.org,
        budget: this.budget,
        goalAdjustmentsTaken: this.goalAdjustmentsTaken,
        nextBudgetCap: this.nextBudgetCap,
      },
      id,
    );
    this.quarterGoal = applied.goal;
    this.stakeholderTrust = applied.trust;
    this.org = applied.org;
    this.budget = applied.budget;
    this.goalAdjustmentsTaken = applied.goalAdjustmentsTaken;
    this.nextBudgetCap = applied.nextBudgetCap;
    if (applied.pauseAiDebuff) this.pauseAiDebuffQuarter = this.quarterNumber + 1;

    if (id === 'reorg_teams') {
      this.applyReorgDeparture();
    }

    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.status = 'lost';
      this.loseReason = lose;
      this.setPhase('lost');
      return;
    }

    this.startNextQuarter();
  }

  /** 組織再編による離脱（決定論 RNG）。 */
  private applyReorgDeparture(): void {
    const rng = createRng(`${this.seed}:reorg:q${this.quarterNumber}`);
    const active = this.roster.members.filter((m) => !m.onLeave);
    if (active.length <= 2) return;
    const idx = Math.floor(rng() * active.length);
    const victim = active[idx];
    this.roster = {
      ...this.roster,
      members: this.roster.members.map((m) =>
        m.id === victim.id
          ? { ...m, onLeave: true, assignment: 'bench' as const, aiAssigned: false }
          : m,
      ),
    };
  }

  /** 次四半期を開始する（トラックを初期化・組織状態は引き継ぎ。phase=setup）。 */
  private startNextQuarter(): void {
    this.quarterNumber += 1;
    this.bossId = this.pickBoss(this.quarterNumber);
    const diff = getDifficulty(this.difficulty);
    const boss = getBoss(this.bossId);
    if (boss) {
      this.quarterGoal = buildQuarterGoal(
        boss,
        this.difficulty,
        diff.bossTargetMul,
        this.quarterGoal,
      );
    }
    if (this.nextBudgetCap !== null) {
      this.budget = Math.min(this.budget, this.nextBudgetCap);
      this.nextBudgetCap = null;
    }

    this.quarterTotals = emptyTotals();

    this.sprintIndexInQuarter = 0;
    this.pendingSprintKind = 'normal';
    this.currentSprintKind = 'normal';
    this.pendingSprintModifiers = {};
    this.beat = null;
    this.currentSprintId = null;
    this.sprint = null;
    this.lastResult = null;
    this.bossRelicReward = undefined;
    this.winEvalOrg = null;
    this.draft = null;
    this.shop = null;
    this.quarterReview = null;
    this.zoom = { level: 'team', deptId: null, teamId: null };
    this.setPhase('setup');
  }

  /** リザルトを確認してドラフトへ進む。 */
  acknowledgeResult(): void {
    if (this.phase !== 'result') return;
    this.draft = drawDraft(
      createRng(`${this.seed}:draft:${this.sprintsPlayed}`),
      3,
      this.allowedCards ?? undefined,
    );
    this.setPhase('draft');
  }

  /** ドラフトでカードを選びデッキに加える（加算系の効果は即時に組織へ反映）。 */
  chooseCard(defId: string): void {
    if (this.phase !== 'draft') return;
    this.addCard(defId, 1);
    this.draft = null;
    // RI-30: カード効果は手札発動時に反映されるため、獲得時の即時敗北は見ない。
    this.setPhase('evolution');
  }

  /** ドラフトをスキップする。 */
  skipDraft(): void {
    if (this.phase !== 'draft') return;
    this.draft = null;
    this.setPhase('evolution');
  }

  /** 進化ノードを解放する（加算系効果は即時反映。phase は evolution のまま）。 */
  unlockEvolution(id: string): void {
    if (this.phase !== 'evolution') return;
    if (!canUnlock(this.evolution, id)) return;
    const node = getEvolutionNodeEffects(id);
    if (node) applyDeckBaseline(this.org, toEffects(node));
    this.evolution = unlockNode(this.evolution, id);
  }

  /** 進化フェーズを終え、次のビート（スプリント間イベント）へ進む。 */
  finishEvolution(): void {
    if (this.phase !== 'evolution') return;
    this.advanceBeat();
  }

  // --- ビート（スプリント間イベント） ---

  /**
   * 次スプリント前のビートを 1 件抽選して提示する（判定/選択の混合）。
   * ボス直前の最終ビートでは elite を出さず、ボス種別を優先する（§5.2 / §6）。
   */
  private advanceBeat(): void {
    // 完了したスプリント盤面はビート以降では参照させない（旧 advanceMap の sprint=null 相当）。
    // result/draft/evolution の間は背景として残すため、ビートへ移るこの時点でクリアする。
    this.sprint = null;
    this.currentSprintId = null;

    const nextIndex = this.sprintIndexInQuarter + 1;
    const isBossNext = nextIndex >= this.sprintsPerQuarter;
    const rng = createRng(`${this.seed}:beat:q${this.quarterNumber}:s${nextIndex}`);

    // 最終ビート（ボス直前）は高負荷案件（elite）を提示しない。
    let pool = EVENT_DEFS;
    if (isBossNext) {
      pool = pool.filter((d) => !d.choices.some((c) => c.leadsTo === 'sprint-elite'));
    }
    // 採用不能時は採用系ビートを出さない（面接へ進んでも採用できずペナルティだけ、を防ぐ。RI-26）。
    const canHireNow = canRecruit(this.roster) && this.budget >= RECRUIT_COST;
    if (!canHireNow) {
      pool = pool.filter(
        (d) => !d.choices.some((c) => c.leadsTo === 'recruit' || c.outcome.grantRecruit),
      );
    }
    // 組織状態の信号で抽選対象を絞る（minSignal 未達のイベントはプールに入れない）。
    const signals = eventSignals(this.org);
    pool = pool.filter((d) => eventEligible(d, signals));
    const decisionPool = eventsOfKind(pool, 'decision');
    const judgmentPool = eventsOfKind(pool, 'judgment');

    const wantDecision = rng() < DECISION_BEAT_CHANCE;
    const primary = wantDecision ? decisionPool : judgmentPool;
    const fallback = wantDecision ? judgmentPool : decisionPool;

    let def;
    if (primary.length > 0) {
      def = pickWeighted(weightedEventPool(this.org, this.quarterTotals, primary), rng());
    } else {
      // 空プール対策: もう一方の種別へ決定論フォールバック（別派生キーで偏りを避ける）。
      const fr = createRng(`${this.seed}:beat:q${this.quarterNumber}:s${nextIndex}:fallback`)();
      def = pickWeighted(weightedEventPool(this.org, this.quarterTotals, fallback), fr);
    }
    if (!def) {
      // 究極のフォールバック（定義が空のときのみ）。長さゼロのビートとして
      // beat を経由し（遷移表の FINISH→ENTER_SPRINT 相当）、次スプリントへ直行する。
      // 同期処理内の2段遷移なのでスナップショットが中間状態を観測することはない。
      this.setPhase('beat');
      this.launchSprint();
      return;
    }
    this.beat = { eventId: def.id, kind: effectiveKind(def) };
    this.setPhase('beat');
  }

  /**
   * 提示中ビートを解決する。判定は引数なし（hidden choice[0] を自動適用）、
   * 選択は choiceIndex。選択の `leadsTo` で sprint(通常/高負荷)/shop/rest/recruit へ分岐する。
   */
  resolveBeat(choiceIndex?: number): void {
    if (this.phase !== 'beat' || !this.beat) return;
    const def = getEvent(this.beat.eventId);
    if (!def) return;
    const idx = this.beat.kind === 'judgment' ? 0 : (choiceIndex ?? 0);
    const choice = def.choices[idx];
    if (!choice) return;

    const res = applyEventOutcome(choice.outcome, this.org, foldPassives(this.relics));
    this.budget = Math.max(0, this.budget + res.budgetDelta);
    if (res.grantRelic) this.grantRelic(res.grantRelic);
    if (res.grantCard) this.addCard(res.grantCard, 1);
    if (res.delivered) {
      this.totals.delivered += res.delivered;
      this.quarterTotals.delivered += res.delivered;
    }
    if (res.trust) this.applyTrust(res.trust);
    if (res.nextSprint) {
      this.pendingSprintModifiers = mergeModifiers(this.pendingSprintModifiers, res.nextSprint);
    }
    this.beat = null;

    // ハード敗北（判定イベントが直接敗北を起こす場合）。
    if (res.forceLose) {
      this.status = 'lost';
      this.loseReason = res.forceLose;
      this.setPhase('lost');
      return;
    }
    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.status = 'lost';
      this.loseReason = lose;
      this.setPhase('lost');
      return;
    }

    // RI-26: イベント即時採用（予算消費。成功時は編成へ戻し配置可能にする。
    // 失敗時は onRecruitFail で見送り相当の代償を課し、既定の leadsTo へ進む）。
    if (res.grantRecruit) {
      const hired = this.tryRecruit(
        `event-recruit:q${this.quarterNumber}:s${this.sprintIndexInQuarter + 1}`,
      );
      if (this.status === 'lost') return;
      if (hired) {
        this.setPhase('setup');
        return;
      }
      if (choice.outcome.onRecruitFail) {
        const fail = applyEventOutcome(
          choice.outcome.onRecruitFail,
          this.org,
          foldPassives(this.relics),
        );
        this.budget = Math.max(0, this.budget + fail.budgetDelta);
        if (fail.trust) this.applyTrust(fail.trust);
        if (fail.forceLose) {
          this.status = 'lost';
          this.loseReason = fail.forceLose;
          this.setPhase('lost');
          return;
        }
        if (this.applyImmediateLose()) return;
      }
    }

    const leadsTo = choice.leadsTo ?? 'sprint';
    if (leadsTo === 'shop') {
      this.shop = this.buildShop();
      this.setPhase('shop');
      return;
    }
    if (leadsTo === 'rest') {
      this.setPhase('rest');
      return;
    }
    if (leadsTo === 'recruit') {
      this.setPhase('recruit');
      return;
    }
    if (leadsTo === 'sprint-elite') {
      this.pendingSprintKind = 'elite';
    }
    this.launchSprint();
  }

  /** ステークホルダー信頼を増減する（安全側の代償等）。 */
  private applyTrust(delta: Partial<StakeholderTrust>): void {
    const t = this.stakeholderTrust;
    if (delta.management) t.management = clamp(t.management + delta.management, 0, 100);
    if (delta.customers) t.customers = clamp(t.customers + delta.customers, 0, 100);
    if (delta.team) t.team = clamp(t.team + delta.team, 0, 100);
  }

  // --- ショップ ---

  private buildShop(): ShopOffer {
    const key = `${this.seed}:shop:q${this.quarterNumber}:s${this.sprintIndexInQuarter + 1}`;
    const rng = createRng(key);
    const discount = foldPassives(this.relics).shopDiscount;
    const cardIds = drawDraft(rng, 3, this.allowedCards ?? undefined);
    const cards = cardIds.map((defId) => ({
      defId,
      cost: Math.max(1, Math.round((getCard(defId)?.cost ?? 12) * (1 - discount))),
      bought: false,
    }));
    const relicId = this.offerRelic(rng);
    const relic = relicId
      ? {
          id: relicId,
          cost: Math.max(1, Math.round(SHOP_RELIC_COST * (1 - discount))),
          bought: false,
        }
      : undefined;
    // 採用枠は休息と同コスト（割引なし）。RI-26。
    return { cards, relic, recruit: { cost: RECRUIT_COST, bought: false } };
  }

  /** ショップ用: メタ解放済みかつ未所持のレリックを 1 つ提示（無ければ undefined）。 */
  private offerRelic(rng: () => number): string | undefined {
    const slots = foldPassives(this.relics).relicSlots;
    if (this.relics.length >= slots) return undefined;
    const pool = relicIds().filter(
      (id) => !this.relics.includes(id) && (!this.allowedRelics || this.allowedRelics.has(id)),
    );
    if (pool.length === 0) return undefined;
    return pool[Math.floor(rng() * pool.length)];
  }

  /** ボス報酬用: メタ解放に依存せず、未所持レリック全体から 1 つ選ぶ。 */
  private pickBossRelic(rng: () => number): string | undefined {
    const pool = relicIds().filter((id) => !this.relics.includes(id));
    if (pool.length === 0) return undefined;
    return pool[Math.floor(rng() * pool.length)];
  }

  /** ショップでカードを購入する。 */
  buyShopCard(defId: string): void {
    if (this.phase !== 'shop' || !this.shop) return;
    const offer = this.shop.cards.find((c) => c.defId === defId && !c.bought);
    if (!offer || this.budget < offer.cost) return;
    this.budget -= offer.cost;
    offer.bought = true;
    this.addCard(defId, 1);
    // RI-30: 効果は手札発動時。購入だけでは即時敗北しない。
    this.applyImmediateLose();
  }

  /** ショップでレリックを購入する。 */
  buyShopRelic(): void {
    if (this.phase !== 'shop' || !this.shop?.relic || this.shop.relic.bought) return;
    const relic = this.shop.relic;
    if (this.budget < relic.cost) return;
    // 枠上限・重複で付与できない場合は課金しない（無償で敗北させない）。
    const slots = foldPassives(this.relics).relicSlots;
    if (this.relics.includes(relic.id) || this.relics.length >= slots) return;
    this.budget -= relic.cost;
    relic.bought = true;
    this.grantRelic(relic.id);
    this.applyImmediateLose();
  }

  /** ショップでメンバーを採用する（RI-26）。購入後もショップに残る。 */
  buyShopRecruit(): void {
    if (this.phase !== 'shop' || !this.shop?.recruit || this.shop.recruit.bought) return;
    if (!this.tryRecruit(`shop-recruit:q${this.quarterNumber}:s${this.sprintIndexInQuarter + 1}`)) {
      return;
    }
    this.shop.recruit.bought = true;
  }

  /** ショップを出て編成（setup-pre）へ。採用メンバーを次スプリント前に配置できる。 */
  leaveShop(): void {
    if (this.phase !== 'shop') return;
    this.shop = null;
    this.setPhase('setup');
  }

  // --- 休息 ---

  /**
   * 休息の選択（heal: シニア+個体スタミナ回復 / repay: 負債返済 /
   * upgrade: カード強化 / recruit: 採用）。選択後は編成（setup-pre）へ。
   * upgrade はデッキ位置を指定できる。未指定時は既存互換で先頭カードを強化する。
   */
  restChoose(option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number): void {
    if (this.phase !== 'rest') return;
    if (option === 'heal') {
      const bonus = foldPassives(this.relics).restHealBonus;
      this.org.seniorHp = clamp(this.org.seniorHp + REST_HEAL + bonus, 0, 100);
      this.org.morale = clamp(this.org.morale + REST_MORALE_HEAL, 0, 100);
      // 個体メンバーのスタミナも大きく回復し、休職者は復帰しやすくなる。
      this.roster = recoverStamina(this.roster, REST_STAMINA_RECOVER);
    } else if (option === 'repay') {
      this.org.techDebt = Math.max(0, this.org.techDebt - REST_REPAY);
    } else if (option === 'upgrade' && this.deck.length > 0) {
      this.deck = upgradeCardAt(this.deck, deckIndex ?? 0);
    } else if (option === 'recruit') {
      // 採用は予算を消費する（ラン経済。SPEC 第4.4）。空き枠と予算が揃ったときのみ。
      this.tryRecruit(`recruit:q${this.quarterNumber}:s${this.sprintIndexInQuarter + 1}`);
      if (this.status === 'lost') return;
    }
    this.setPhase('setup');
  }

  /**
   * 採用フェーズの選択（hire: 採用 / skip: 見送り）。選択後は編成（setup-pre）へ。
   * RI-26 の専用採用ビート。見送り（および採用失敗）は recruit-offer 見送りと同経路・同コスト。
   */
  recruitChoose(option: 'hire' | 'skip'): void {
    if (this.phase !== 'recruit') return;
    if (option === 'hire') {
      const hired = this.tryRecruit(
        `recruit-phase:q${this.quarterNumber}:s${this.sprintIndexInQuarter + 1}`,
      );
      if (this.status === 'lost') return;
      if (!hired && this.applyRecruitSkipPenalty()) return;
    } else if (this.applyRecruitSkipPenalty()) {
      return;
    }
    this.setPhase('setup');
  }

  /**
   * 採用フェーズ見送りの士気コスト（`RECRUIT_SKIP_MORALE`）。
   * recruit-offer 見送りと同じく `applyEventOutcome`（moraleDamageMul）経由で適用し、即時敗北を評価する。
   * @returns true なら lost へ遷移済み。
   */
  private applyRecruitSkipPenalty(): boolean {
    applyEventOutcome({ morale: RECRUIT_SKIP_MORALE }, this.org, foldPassives(this.relics));
    return this.applyImmediateLose();
  }

  /**
   * 個体メンバーを 1 人採用する共通コア（休息 / ショップ / 採用フェーズ / イベント）。
   * 空き枠と予算が揃ったときのみ成功し、成功時は予算を減らし即時敗北を評価する。
   */
  private tryRecruit(rngKey: string): boolean {
    if (!canRecruit(this.roster) || this.budget < RECRUIT_COST) return false;
    const rng = createRng(`${this.seed}:${rngKey}`);
    const next = recruitMember(this.roster, pickRecruitArchetype(rng), rng);
    if (next === this.roster) return false;
    this.roster = next;
    this.budget -= RECRUIT_COST;
    this.applyImmediateLose();
    return true;
  }

  /** メンバーをレーンへ配置する（編成。第12.2）。スプリント中は変更しない。 */
  assignMember(id: string, assignment: LaneAssignment): void {
    if (this.phase === 'sprint') return;
    this.roster = assignMember(this.roster, id, assignment);
  }

  /** メンバーへの AI 配布を切り替える（編成。第12.2）。スプリント中は変更しない。 */
  setMemberAi(id: string, on: boolean): void {
    if (this.phase === 'sprint') return;
    this.roster = setAiAssigned(this.roster, id, on);
  }

  // --- 共通 ---

  /** カードをデッキへ加える（効果は手札発動時に反映。RI-30）。 */
  private addCard(defId: string, level: number): void {
    const def = getCard(defId);
    if (!def) return;
    this.deck.push({ defId, level });
  }

  /** 即時敗北条件を評価し、該当すれば lost へ遷移する。 */
  private applyImmediateLose(): boolean {
    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (!lose) return false;
    this.status = 'lost';
    this.loseReason = lose;
    this.setPhase('lost');
    return true;
  }

  /** レリックを獲得し、加算系効果を即時に組織へ反映する（枠上限あり）。 */
  private grantRelic(id: string): void {
    if (this.relics.includes(id)) return;
    const slots = foldPassives(this.relics).relicSlots;
    if (this.relics.length >= slots) return;
    const relic = getRelic(id);
    if (!relic) return;
    this.relics.push(id);
    if (relic.effects) applyDeckBaseline(this.org, toEffects(relic.effects));
  }

  /** ボス突破報酬として未所持レリックを決定論的に 1 個付与する。 */
  private grantBossRelic(): string | undefined {
    const relicId = this.pickBossRelic(createRng(`${this.seed}:boss-relic:q${this.quarterNumber}`));
    if (!relicId) return undefined;
    this.grantRelic(relicId);
    return this.relics.includes(relicId) ? relicId : undefined;
  }

  // --- 組織スケール / ズーム階層（第4.7〜4.11） ---

  /**
   * ズーム階層を切り替える（業界 ▸ 全社 ▸ 部署 ▸ 現場）。
   * 部署へ移るときは未選択なら先頭部門をフォーカスする。
   */
  zoomTo(level: ZoomLevel): void {
    if (level === 'department' && !this.zoom.deptId) {
      this.zoom.deptId = DEPARTMENT_DEFS[0]?.id ?? null;
    }
    this.zoom = { ...this.zoom, level };
  }

  /** 部門をフォーカスして部署ビューへ（ドリルダウン）。 */
  focusDepartment(id: string): void {
    if (!DEPARTMENT_DEFS.some((d) => d.id === id)) return;
    this.zoom = { ...this.zoom, level: 'department', deptId: id };
  }

  /**
   * チームへドリルダウンする（第4.11）。
   * 実在する現場はプレイヤーチームのみなので、プレイヤーチームを選んだときだけ
   * 現場（team）へ着地する。他の合成チームには遊べる盤面が無いため、嘘の着地を避け、
   * そのチームが属する部門の部署ビューへ寄せる（注意の粒度を一段だけ下げる）。
   * 未知の ID は無視する。
   */
  focusTeam(id: string): void {
    const team = this.buildOrgScale()
      .departments.flatMap((d) => d.teams)
      .find((t) => t.id === id);
    if (!team) return;
    if (team.isPlayer) {
      this.zoom = { ...this.zoom, level: 'team', teamId: id };
    } else {
      this.zoom = { ...this.zoom, level: 'department', deptId: team.deptId, teamId: id };
    }
  }

  /** 業界ランキングの種別タブを切り替える。 */
  setRankingKind(kind: RankingKind): void {
    this.rankingKind = kind;
  }

  /**
   * 全社 / 部門レバーを発動する（四半期予算を消費して下位制約を緩める。第4.7）。
   * 予算不足・スコープ不一致は何も起きない。返り値は適用できたか。
   */
  applyOrgLever(leverId: string, deptId?: string): boolean {
    // ラン外（タイトル・終端）では発動しない（即時敗北判定が終端フェーズから再遷移しないように）。
    if (this.phase === 'title' || this.phase === 'won' || this.phase === 'lost') return false;
    const res = applyLever(this.orgAdjust, this.budget, leverId, deptId);
    if (!res.changed) return false;
    this.orgAdjust = res.adjust;
    this.budget = res.budget;
    this.applyImmediateLose();
    return true;
  }

  /** 現在の全社マップ集約を生成する（決定論。第4.8）。 */
  private buildOrgScale(): OrgScaleState {
    // 進行中スプリントの現在の渋滞・炎上を取り、俯瞰時の現場を最新に保つ。
    const live = this.sprint
      ? {
          liveReviewQueue: Math.max(
            this.sprint.metrics.reviewQueueMax,
            this.sprint.tasks.filter((t) => t.lane === 'review').length,
          ),
          liveIncidents: this.sprint.tasks.filter((t) => t.incident).length,
        }
      : {};
    return generateOrgScale({
      seed: this.seed,
      org: this.org,
      totals: this.totals,
      diagnosis: this.diagnosis,
      budget: this.budget,
      adjust: this.orgAdjust,
      playerEngineers: activeEngineerCount(this.roster),
      playerAiAssigned: aiAssignedCount(this.roster),
      ...live,
    });
  }

  /** 現在のズームに応じて全社マップを生成する（現場では不要なので null）。 */
  private orgScaleForSnapshot(): OrgScaleState | null {
    return this.zoom.level === 'team' ? null : this.buildOrgScale();
  }

  /** 業界ランキングを生成する（業界ビューのときのみ）。 */
  private industryForSnapshot(org: OrgScaleState | null): IndustryState | null {
    if (this.zoom.level !== 'industry') return null;
    const scale = org ?? this.buildOrgScale();
    return generateIndustry(scale, this.rankingKind);
  }

  /** 現在のフェーズ（スナップショットを作らない軽量アクセサ）。 */
  currentPhase(): RunState['phase'] {
    return this.phase;
  }

  /** スプリントが進行中（自動ステップ対象）か。 */
  sprintRunning(): boolean {
    return this.phase === 'sprint' && this.sprint !== null && !this.sprint.complete;
  }

  /**
   * Worker / 同期フォールバック向けの what-if 入力スライス。
   * setup / draft 以外では null。
   */
  whatIfComputeInput(): WhatIfComputeInput | null {
    if (this.phase !== 'setup' && this.phase !== 'draft') return null;
    return {
      phase: this.phase,
      seed: this.seed,
      quarterNumber: this.quarterNumber,
      sprintIndexInQuarter: this.sprintIndexInQuarter,
      sprintsPerQuarter: this.sprintsPerQuarter,
      pendingSprintKind: this.pendingSprintKind,
      pendingSprintModifiers: { ...this.pendingSprintModifiers },
      deck: this.deck.map((c) => ({ ...c })),
      draft: this.draft ? [...this.draft] : null,
      roster: structuredClone(this.roster),
      org: structuredClone(this.org),
      budget: this.budget,
      totals: { ...this.totals },
      relics: [...this.relics],
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      difficulty: this.difficulty,
      trials: [...this.trials],
      bossId: this.bossId,
      pauseAiDebuffQuarter: this.pauseAiDebuffQuarter,
      baseConfig: { ...this.baseConfig },
    };
  }

  /**
   * UI 向けの what-if 試算（同期）。ユニットテストと Worker 不可環境向け。
   * オートプレイ／モンテカルロの snapshot 経路からは呼ばない。
   * 同一入力はキャッシュし、編成変更時だけ再計算する。
   * 返却値は独立コピーなので、呼び出し側の変更がキャッシュを汚さない。
   */
  whatIfPreview(): WhatIfState | null {
    const input = this.whatIfComputeInput();
    if (!input) {
      this.whatIfCache = null;
      return null;
    }
    const key = whatIfCacheKey(input);
    if (this.whatIfCache?.key !== key) {
      this.whatIfCache = { key, value: computeWhatIfState(input) };
    }
    return this.whatIfCache.value ? structuredClone(this.whatIfCache.value) : null;
  }

  /** スナップショット（独立コピー）。レンダラ・E2E はこれを読む。 */
  snapshot(): RunState {
    const orgScale = this.orgScaleForSnapshot();
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      trials: [...this.trials],
      runKind: this.runKind,
      dailyDate: this.dailyDate,
      phase: this.phase,
      status: this.status,
      winType: this.winType,
      loseReason: this.loseReason,
      bossId: this.bossId,
      sprintsPerQuarter: this.sprintsPerQuarter,
      sprintIndexInQuarter: this.sprintIndexInQuarter,
      beat: this.beat ? { ...this.beat } : null,
      pendingSprintKind: this.pendingSprintKind,
      currentSprintKind: this.currentSprintKind,
      pendingSprintModifiers: { ...this.pendingSprintModifiers },
      org: structuredClone(this.org),
      deck: this.deck.map((c) => ({ ...c })),
      relics: [...this.relics],
      bossRelicReward: this.bossRelicReward,
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      roster: structuredClone(this.roster),
      lastGrowth: this.lastGrowth ? structuredClone(this.lastGrowth) : null,
      budget: this.budget,
      currentSprintId: this.currentSprintId,
      sprint: this.sprint ? structuredClone(this.sprint) : null,
      sprintTick: this.sprint ? this.sprintTick : 0,
      lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
      draft: this.draft ? [...this.draft] : null,
      // 重い seed 掃引は whatIfPreview() / game.getState() 側で必要時のみ行う。
      whatIf: null,
      whatIfStatus: 'idle',
      shop: this.shop
        ? {
            cards: this.shop.cards.map((c) => ({ ...c })),
            relic: this.shop.relic ? { ...this.shop.relic } : undefined,
            recruit: this.shop.recruit ? { ...this.shop.recruit } : undefined,
          }
        : null,
      diagnosis: this.diagnosis,
      sprintsPlayed: this.sprintsPlayed,
      totals: { ...this.totals },
      quarterTotals: { ...this.quarterTotals },
      usedHeavyActions: this.usedHeavyActions,
      quarterNumber: this.quarterNumber,
      quarterGoal: { ...this.quarterGoal },
      stakeholderTrust: { ...this.stakeholderTrust },
      quarterReview: this.quarterReview ? structuredClone(this.quarterReview) : null,
      goalAdjustmentsTaken: [...this.goalAdjustmentsTaken],
      reviewHistory: [...this.reviewHistory],
      zoom: { ...this.zoom },
      rankingKind: this.rankingKind,
      orgScale,
      industry: this.industryForSnapshot(orgScale),
    };
  }

  /**
   * フェーズ境界セーブ用の hydrate 状態を書き出す（RI-58）。
   * sprint / title では null（セーブスカム抑制・入口はセーブ不要）。
   * `game` フィールドは GameHandle 側で埋める。
   */
  exportHydrateState(): Omit<RunSaveBlob, 'game' | 'savedAt'> | null {
    if (!isSaveablePhase(this.phase)) return null;
    const priv: RunSavePrivate = {
      allowedCards: this.allowedCards ? [...this.allowedCards] : [],
      allowedRelics: this.allowedRelics ? [...this.allowedRelics] : [],
      baseConfig: { ...this.baseConfig },
      orgAdjust: structuredClone(this.orgAdjust),
      nextBudgetCap: this.nextBudgetCap,
      pauseAiDebuffQuarter: this.pauseAiDebuffQuarter,
      winEvalOrg: this.winEvalOrg ? structuredClone(this.winEvalOrg) : null,
    };
    const state: RunSaveState = {
      seed: this.seed,
      difficulty: this.difficulty,
      trials: [...this.trials],
      runKind: this.runKind,
      dailyDate: this.dailyDate,
      phase: this.phase,
      status: this.status,
      winType: this.winType,
      loseReason: this.loseReason,
      bossId: this.bossId,
      sprintsPerQuarter: this.sprintsPerQuarter,
      sprintIndexInQuarter: this.sprintIndexInQuarter,
      beat: this.beat ? { ...this.beat } : null,
      pendingSprintKind: this.pendingSprintKind,
      currentSprintKind: this.currentSprintKind,
      pendingSprintModifiers: { ...this.pendingSprintModifiers },
      org: structuredClone(this.org),
      deck: this.deck.map((c) => ({ ...c })),
      relics: [...this.relics],
      bossRelicReward: this.bossRelicReward,
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      roster: structuredClone(this.roster),
      lastGrowth: this.lastGrowth ? structuredClone(this.lastGrowth) : null,
      budget: this.budget,
      currentSprintId: this.currentSprintId,
      sprintTick: 0,
      lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
      draft: this.draft ? [...this.draft] : null,
      shop: this.shop
        ? {
            cards: this.shop.cards.map((c) => ({ ...c })),
            relic: this.shop.relic ? { ...this.shop.relic } : undefined,
            recruit: this.shop.recruit ? { ...this.shop.recruit } : undefined,
          }
        : null,
      diagnosis: this.diagnosis,
      sprintsPlayed: this.sprintsPlayed,
      totals: { ...this.totals },
      quarterTotals: { ...this.quarterTotals },
      usedHeavyActions: this.usedHeavyActions,
      quarterNumber: this.quarterNumber,
      quarterGoal: { ...this.quarterGoal },
      stakeholderTrust: { ...this.stakeholderTrust },
      quarterReview: this.quarterReview ? structuredClone(this.quarterReview) : null,
      goalAdjustmentsTaken: [...this.goalAdjustmentsTaken],
      reviewHistory: [...this.reviewHistory],
      zoom: { ...this.zoom },
      rankingKind: this.rankingKind,
    };
    return {
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      engineVersion: RUN_SAVE_ENGINE_VERSION,
      private: priv,
      state,
    };
  }

  /**
   * フェーズ境界セーブからエンジン状態を復元する（RI-58）。
   * sprint フェーズや非互換 blob は拒否する。
   */
  hydrate(blob: RunSaveBlob): boolean {
    if (!isSaveablePhase(blob.state.phase)) return false;
    const s = blob.state;
    const p = blob.private;

    this.seed = s.seed;
    this.difficulty = s.difficulty;
    this.trials = [...s.trials];
    this.allowedCards = new Set(p.allowedCards);
    this.allowedRelics = new Set(p.allowedRelics);
    this.baseConfig = { ...p.baseConfig };
    this.orgAdjust = structuredClone(p.orgAdjust);
    this.nextBudgetCap = p.nextBudgetCap;
    this.pauseAiDebuffQuarter = p.pauseAiDebuffQuarter;
    this.winEvalOrg = p.winEvalOrg ? structuredClone(p.winEvalOrg) : null;

    this.runKind = s.runKind;
    this.dailyDate = s.dailyDate;
    this.phase = s.phase;
    this.status = s.status;
    this.winType = s.winType;
    this.loseReason = s.loseReason;
    this.bossId = s.bossId;
    this.sprintsPerQuarter = s.sprintsPerQuarter;
    this.sprintIndexInQuarter = s.sprintIndexInQuarter;
    this.beat = s.beat ? { ...s.beat } : null;
    this.pendingSprintKind = s.pendingSprintKind;
    this.currentSprintKind = s.currentSprintKind;
    this.pendingSprintModifiers = { ...s.pendingSprintModifiers };
    this.org = structuredClone(s.org);
    this.deck = s.deck.map((c) => ({ ...c }));
    this.relics = [...s.relics];
    this.bossRelicReward = s.bossRelicReward;
    this.evolution = { points: s.evolution.points, unlocked: { ...s.evolution.unlocked } };
    this.roster = structuredClone(s.roster);
    this.lastGrowth = s.lastGrowth ? structuredClone(s.lastGrowth) : null;
    this.budget = s.budget;
    this.currentSprintId = s.currentSprintId;
    this.lastResult = s.lastResult ? structuredClone(s.lastResult) : null;
    this.draft = s.draft ? [...s.draft] : null;
    this.shop = s.shop
      ? {
          cards: s.shop.cards.map((c) => ({ ...c })),
          relic: s.shop.relic ? { ...s.shop.relic } : undefined,
          recruit: s.shop.recruit ? { ...s.shop.recruit } : undefined,
        }
      : null;
    this.diagnosis = s.diagnosis;
    this.sprintsPlayed = s.sprintsPlayed;
    this.totals = { ...s.totals };
    this.quarterTotals = { ...s.quarterTotals };
    this.usedHeavyActions = s.usedHeavyActions;
    this.quarterNumber = s.quarterNumber;
    this.quarterGoal = { ...s.quarterGoal };
    this.stakeholderTrust = { ...s.stakeholderTrust };
    this.quarterReview = s.quarterReview ? structuredClone(s.quarterReview) : null;
    this.goalAdjustmentsTaken = [...s.goalAdjustmentsTaken];
    this.reviewHistory = [...s.reviewHistory];
    this.zoom = { ...s.zoom };
    this.rankingKind = s.rankingKind;

    // フェーズ境界制約: スプリント進行状態は持たない。
    this.sprint = null;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprintBaselineInput = null;
    this.sprintPassiveEffects = { ...IDENTITY_CARD_EFFECTS };
    this.sprintRng = createRng('init');
    this.whatIfCache = null;
    return true;
  }
}

export function createRunEngine(init?: RunEngineInit): RunEngine {
  return new RunEngine(init);
}

function relicIds(): string[] {
  return RELIC_DEFS.map((r) => r.id);
}
function getEvolutionNodeEffects(id: string): Partial<CardEffects> | undefined {
  return getEvolutionNode(id)?.effects;
}
