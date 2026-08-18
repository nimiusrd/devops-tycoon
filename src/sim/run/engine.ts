/**
 * ラン（1〜複数四半期）オーケストレーター（SPEC 第3章 / 第4.4〜4.6 / 第8〜17章）。
 *
 * スプリント純関数（createSprint/stepSprint/applyAction/summarizeSprint）を再利用し、
 * その上にローグライクの入れ子——**固定トラック（スプリント列）＋スプリント間の
 * ビート（判定/選択イベント）**——とショップ/休息/ボス/勝敗/診断を載せた決定論エンジン。
 * 四半期は固定長のスプリント列で、最終スプリントがボス。スプリントの合間に毎回ビートが
 * 挟まり、組織状態で重み付けした判定/選択イベントを seed付き決定論で引く（第22.3）。
 * `org` はラン中を通じて持続し、各スプリントの消耗が次へ引き継がれる。
 */
import { BOSS_DEFS, getBoss } from '../../data/bosses';
import { PROCESS_BALANCE } from '../../data/balance';
import { getCard } from '../../data/cards';
import { getGoalAdjustment } from '../../data/goalAdjustments';
import { getLever } from '../../data/levers';
import { DEPARTMENT_DEFS } from '../../data/departments';
import { getDifficulty, getTrial } from '../../data/difficulties';
import { EVENT_DEFS, RECRUIT_SKIP_MORALE, effectiveKind, getEvent } from '../../data/events';
import { getEvolutionNode } from '../../data/evolution';
import { RELIC_DEFS, getRelic } from '../../data/relics';
import { applyAction } from '../actions';
import {
  applyDeckBaseline,
  dealHand,
  drawDraft,
  inheritBaselineAppliedForTeams,
  migrateBaselineAppliedByTeam,
  playCardFromHand,
  upgradeCardAt,
} from '../cards';
import { diagnose } from '../diagnosis';
import {
  activeAssignedCount,
  activeReviewerCount,
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
import { createRng, createRngFromState, getRngState } from '../rng';
import { DEFAULT_SEED } from '../seed';
import { applyScenarioOrg, DEFAULT_SCENARIO, getScenario, resolveScenarioId } from '../scenarios';
import {
  forceShipReviewTask,
  isAwaitingMinCompleteTick,
  resolveSprintConfig,
  stepSprint,
  summarizeSprint,
} from '../sprint';
import type {
  ActionId,
  ActionTarget,
  CardEffects,
  CardInstance,
  CardPlayOutcome,
  InterventionOutcome,
  OrgState,
  ScenarioId,
  SprintConfig,
  SprintResult,
  SprintState,
} from '../types';
import {
  IDENTITY_CARD_EFFECTS,
  securityCustomerTrustDelta,
  securityCustomerTrustFromRaw,
  securityFragility,
} from '../model';
import {
  activeLiveFromOrg,
  advanceCoarseTeams,
  appendTeamsToDept,
  applyEffectToTeam,
  applyLever,
  companyInfraFromTeams,
  companyOrgFromTeams,
  createTeamRoster,
  emptyAdjust,
  emptyAdjustState,
  engineersFromRoster,
  ENTER_TEAM_FOCUS_PENALTY,
  ENTER_TEAM_LOCK_SPRINTS,
  generateIndustry,
  HOME_TEAM_ID,
  initTeamRunStates,
  mergeAdjust,
  RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY,
  deriveTeamCapacities,
  normalizeCoarseTotalsDelta,
  orgFromTeam,
  projectOrgScale,
  stripMetricAdjustments,
  syncTeamFromOrg,
} from '../orgscale';
import type {
  IndustryState,
  OrgAdjustState,
  OrgScaleState,
  RankingKind,
  TeamRunState,
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
import { foldRunEffects, infraBillingRateForSprint } from './effects';
import {
  DRAFT_MULLIGAN_COST,
  EVO_POINTS_BASE,
  EVO_POINTS_DELIVERED_DIVISOR,
  EVO_POINTS_ELITE_BONUS,
  SPRINTS_PER_QUARTER,
} from './constants';
import {
  applyGoalAdjustment,
  applyGoalCarryoverOrgTick,
  applyGoalCarryoverToEffects,
  applyGoalOrgEffectsToTeam,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  canAcknowledgeWin,
  canChooseAdjustment,
  hasGoalCarryoverOrgDelta,
  hasNextQuarterCarryover,
  isTerminalFailure,
  loseReasonForOutcome,
  MIN_QUARTER_DELIVERY_TARGET,
} from './quarterReview';
import {
  createSprintFromBaselineInput,
  runNoInterventionBaseline,
  withTeamBoardPressure,
} from './sprintBaseline';
import type { SprintBaselineInput } from './sprintBaseline';
import {
  applyTrialAiDependencyPressure,
  BETWEEN_SPRINT_RECOVERY,
  buildSprintBaselineInput,
  computeInfraCost,
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
  isReplayFramePhase,
  isRunSavePhase,
  type CounterfactualFrame,
  type RunPersistState,
  type RunReplayFrame,
} from './persist';
import { clamp } from '../clamp';

export { DRAFT_MULLIGAN_COST, SPRINTS_PER_QUARTER };
/** 各ビートで選択イベント（decision）を引く確率。残りは判定イベント（judgment）。 */
export const DECISION_BEAT_CHANCE = 0.55;
/** 休息（heal）でのシニア体力回復量（UI プレビューと共有）。 */
export const REST_HEAL = 40;
/** 休息（heal）での士気回復量。 */
export const REST_MORALE_HEAL = 10;
/** 休息（repay）での技術的負債返済量（UI プレビューと共有）。 */
export const REST_REPAY = 30;
/** 休息（repay）で次スプリントへ持ち越す手戻り率の抑制（RI-78）。 */
export const REST_REPAY_REWORK_RATE = -0.08;
/** 休息（upgrade）で次スプリントへ持ち越す集中力上限の増加（RI-78）。 */
export const REST_UPGRADE_FOCUS_MAX = 2;
/** ショップのレリック価格（割引前）。RI-78: 純出荷受入のため定価を抑える。 */
export const SHOP_RELIC_COST = 12;

/** RI-108 より前のセーブを復元するときに使う、当時の raw 反映閾値。 */
const LEGACY_INCIDENT_TRUST_RAW_THRESHOLD = 0.5;

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

/**
 * RI-108 より前の粗粒度炎上 raw を、当時の規則で顧客信頼デルタへ変換する。
 * 現在の調整値を使うと、過去に確定済みのペナルティが復元時に変わってしまう。
 */
function legacySecurityCustomerTrustFromRaw(raw: number): number {
  return raw < LEGACY_INCIDENT_TRUST_RAW_THRESHOLD ? 0 : -Math.ceil(raw);
}

/** 次スプリント限定の一時効果を合成する（taskCountMul は乗算、加算系は加算）。 */
function mergeModifiers(a: SprintModifierDelta, b: SprintModifierDelta): SprintModifierDelta {
  const reviewLoadAdd = (a.reviewLoadAdd ?? 0) + (b.reviewLoadAdd ?? 0);
  const reworkRateAdd = (a.reworkRateAdd ?? 0) + (b.reworkRateAdd ?? 0);
  const taskCountMul = (a.taskCountMul ?? 1) * (b.taskCountMul ?? 1);
  const focusMaxAdd = (a.focusMaxAdd ?? 0) + (b.focusMaxAdd ?? 0);
  return {
    ...(reviewLoadAdd !== 0 ? { reviewLoadAdd } : {}),
    ...(reworkRateAdd !== 0 ? { reworkRateAdd } : {}),
    ...(taskCountMul !== 1 ? { taskCountMul } : {}),
    ...(focusMaxAdd !== 0 ? { focusMaxAdd } : {}),
  };
}

/** スナップショット／永続用にカードを独立コピーする（baseline マップ含む）。 */
function cloneCardInstance(card: CardInstance): CardInstance {
  return {
    ...card,
    ...(card.baselineAppliedByTeam
      ? { baselineAppliedByTeam: { ...card.baselineAppliedByTeam } }
      : {}),
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

/** 難易度の組織プリセットにシナリオ差分を足して初期 `OrgState` を作る（AI 導入済みの組織を前提）。 */
function buildRunOrg(difficulty: DifficultyId, scenarioId: ScenarioId): OrgState {
  const { org } = getDifficulty(difficulty);
  const scenarioOrg = applyScenarioOrg(org, getScenario(scenarioId));
  return {
    aiEnabled: true,
    aiDependency: scenarioOrg.aiDependencyBase,
    aiLiteracy: scenarioOrg.aiLiteracy,
    testCoverage: scenarioOrg.testCoverage,
    documentation: scenarioOrg.documentation,
    quality: scenarioOrg.quality,
    securityLevel: clamp(
      scenarioOrg.securityLevel,
      PROCESS_BALANCE.securityLevelMinimum.value,
      PROCESS_BALANCE.securityLevelMaximum.value,
    ),
    morale: scenarioOrg.morale,
    seniorHp: scenarioOrg.seniorHp,
    techDebt: 0,
    deliveryScore: 0,
  };
}

export class RunEngine {
  private seed: string;
  private difficulty: DifficultyId;
  private trials: string[];
  /** ラン開始時に固定したツール別シナリオ（RI-103）。 */
  private scenario: ScenarioId = DEFAULT_SCENARIO;
  private allowedCards: ReadonlySet<string> | null = null;
  private allowedRelics: ReadonlySet<string> | null = null;
  /** ラン開始時に固定した研修方針（優先施策。RI-34⁗）。 */
  private preferredCards: ReadonlySet<string> = new Set();

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
  /** 次スプリント手札へ優先配布するデッキインデックス（RI-78。ショップ購入）。 */
  private pendingShopHandIndices: number[] = [];
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
  /**
   * 今スプリント開始時に課したインフラコストと、課金時点の依存度・単価（RI-88）。
   * コスト最適化カード発動時に差額を予算へ戻す（課金と同じ computeInfraCost で再計算）。
   */
  private chargedInfraCost = 0;
  private chargedInfraDependency = 0;
  private chargedInfraRate = 0;
  private lastResult: SprintResult | null = null;
  private draft: string[] | null = null;
  /** 今ドラフトでのマリガン使用済み（RI-81）。 */
  private draftMulliganUsed = false;
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
  /** 全チームの永続状態（RI-64）。 */
  private teams: TeamRunState[] = [];
  private activeTeamId: string = HOME_TEAM_ID;
  private homeTeamId: string = HOME_TEAM_ID;
  private teamLockUntilSprint = 0;
  /** 訪問済みチームのロスター（active 以外はここへ退避）。 */
  private teamRosters: Record<string, RosterState> = {};
  /** 粗粒度炎上の正規化端数（四半期内で繰り越し）。 */
  private coarseIncidentCarry = 0;
  /** 粗粒度炎上の顧客信頼 raw（四半期内で繰り越し。RI-87）。 */
  private coarseSecurityTrustRaw = 0;
  /** 粗粒度炎上の顧客信頼 raw に含まれる発火件数（RI-108）。 */
  private coarseSecurityTrustCount = 0;
  /** 粗粒度炎上で、すでに顧客信頼へ反映済みの累積デルタ（RI-108）。 */
  private coarseSecurityTrustAppliedDelta = 0;

  private quarterNumber = 1;
  private quarterGoal!: QuarterGoal;
  private stakeholderTrust!: StakeholderTrust;
  private quarterReview: QuarterReview | null = null;
  private goalAdjustmentsTaken: GoalAdjustmentId[] = [];
  private reviewHistory: QuarterOutcome[] = [];
  private nextBudgetCap: number | null = null;
  /** 目標修正の次四半期物理キャリーオーバーが有効な四半期（RI-83）。 */
  private goalCarryoverQuarter: number | null = null;
  /** アクティブなキャリーオーバーの目標修正 ID（RI-83）。 */
  private goalCarryoverId: GoalAdjustmentId | null = null;
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

  /** ラン開始時点の研修方針（優先施策）を設定する（ラン中は固定。RI-34⁗）。 */
  setPreferredCards(cardIds: ReadonlySet<string> | readonly string[]): void {
    this.preferredCards = cardIds instanceof Set ? cardIds : new Set(cardIds);
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
    this.scenario =
      options?.kind === 'daily' ? DEFAULT_SCENARIO : resolveScenarioId(options?.scenario);
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
      ...(diff.aiDependencyPerTask !== undefined
        ? { aiDependencyPerTask: diff.aiDependencyPerTask }
        : {}),
    };
    this.org = buildRunOrg(this.difficulty, this.scenario);
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
          deliveryTarget: MIN_QUARTER_DELIVERY_TARGET,
          qualityTarget: 45,
          techDebtLimit: 55,
          moraleTarget: 40,
          incidentLimit: 6,
        };
    this.quarterReview = null;
    this.goalAdjustmentsTaken = [];
    this.reviewHistory = [];
    this.nextBudgetCap = null;
    this.goalCarryoverQuarter = null;
    this.goalCarryoverId = null;
    this.sprintsPerQuarter = SPRINTS_PER_QUARTER;
    this.sprintIndexInQuarter = 0;
    this.pendingSprintKind = 'normal';
    this.currentSprintKind = 'normal';
    this.pendingSprintModifiers = {};
    this.pendingShopHandIndices = [];
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
    this.homeTeamId = HOME_TEAM_ID;
    this.activeTeamId = HOME_TEAM_ID;
    this.teamLockUntilSprint = 0;
    this.teams = initTeamRunStates({
      seed: this.seed,
      org: this.org,
      homeEngineers: activeEngineerCount(this.roster),
    });
    this.teamRosters = { [this.homeTeamId]: structuredClone(this.roster) };
    this.coarseIncidentCarry = 0;
    this.coarseSecurityTrustRaw = 0;
    this.coarseSecurityTrustCount = 0;
    this.coarseSecurityTrustAppliedDelta = 0;
    // ホームの永続指標を初期 org/roster と揃える。
    this.syncActiveTeamFromOrg();
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
   * スプリント開始時の AI 依存圧力（ドリフト＋インフラコスト）を適用する（RI-88 / RI-77）。
   * 通常ランはボス時のみベース単価を課金。インフラ試練（frontier-dependency）の
   * 毎スプリント課金は試練上乗せ分だけ（ベースはボス時のみ。P1）。
   * 無関係な試練だけでは課金しない。
   * 課金の依存度は選択中チームではなく全社集約（`companyOrgFromTeams`）を使う。
   */
  private applyTrialAiDependencyPressure(org: OrgState, budget: number, kind: SprintKind): number {
    const before = budget;
    const hasFrontier = this.trials.includes('frontier-dependency');
    const pressureCtx = {
      deck: this.deck,
      relics: this.relics,
      evolution: this.evolution,
      difficulty: this.difficulty,
      trials: this.trials,
      scenario: this.scenario,
    };
    // ドリフトは選択中チームへ適用し、課金前に永続チームへ同期する。
    applyTrialAiDependencyPressure(org, budget, pressureCtx, { billInfraCost: false });
    this.syncActiveTeamFromOrg();
    const fold = foldRunEffects(pressureCtx);
    const companyDep = companyOrgFromTeams(this.teams, org).aiDependency;
    const rate = infraBillingRateForSprint(kind, hasFrontier, fold.frontierModelCostPerDependency);
    const next =
      rate === null
        ? budget
        : Math.max(0, budget - computeInfraCost(companyDep, rate, fold.effects.infraCostMul));
    this.chargedInfraCost = Math.max(0, before - next);
    // カード発動で依存度が変わっても、課金時点の dep×rate を正として再計算する。
    this.chargedInfraDependency = companyDep;
    this.chargedInfraRate = rate ?? 0;
    return next;
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
    // RI-83: 目標修正の次四半期 org 継続差分（Tech Debt / シニア HP / 品質）。
    // 定義に org 差分が無い選択ではチーム再計算を走らせない（deriveTeamCapacities の毎スプリント
    // 実行は既定オートプレイ経路の勝率を壊す）。アクティブ側が上限・下限で実値が変わらなくても、
    // 非アクティブチームへは同じ差分を適用する。
    this.org = applyGoalCarryoverOrgTick(
      this.org,
      this.goalCarryoverId,
      this.goalCarryoverQuarter,
      this.quarterNumber,
    );
    if (
      hasGoalCarryoverOrgDelta(this.goalCarryoverId, this.goalCarryoverQuarter, this.quarterNumber)
    ) {
      this.teams = this.teams.map((t) => {
        const seeded = {
          ...this.org,
          techDebt: t.techDebt,
          seniorHp: t.seniorHp,
          quality: t.quality,
        };
        const next = applyGoalCarryoverOrgTick(
          seeded,
          this.goalCarryoverId,
          this.goalCarryoverQuarter,
          this.quarterNumber,
        );
        const updated = {
          ...t,
          techDebt: next.techDebt,
          seniorHp: next.seniorHp,
          quality: next.quality,
        };
        return { ...updated, ...deriveTeamCapacities(updated) };
      });
      this.syncActiveTeamFromOrg();
    }
    this.budget = this.applyTrialAiDependencyPressure(this.org, this.budget, kind);
    // インフラコストで予算が尽きた場合はスプリントへ進まず継続不能にする。
    if (this.applyImmediateLose()) return;
    const baseline = this.buildSprintBaselineInput({
      deck: this.deck,
      roster: this.roster,
      org: this.org,
      kind,
      modifiers,
      seed: `${this.seed}:sprint:${this.currentSprintId}`,
    });
    // 正本の行列・炎上を初期盤面へ投入し、入り込み後に俯瞰の問題が消えないようにする。
    const activeTeam = this.teams.find((t) => t.id === this.activeTeamId);
    this.sprintBaselineInput = withTeamBoardPressure(baseline, {
      reviewQueue: activeTeam?.reviewQueue ?? 0,
      incidents: activeTeam?.incidents ?? 0,
    });
    const initialized = createSprintFromBaselineInput(this.sprintBaselineInput, this.org);
    this.sprintRng = initialized.rng;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprint = initialized.sprint;
    // パッシブ（レリック等）のみを基準に保持し、手札を配布する（RI-30）。
    this.sprintPassiveEffects = { ...this.sprint.cardEffects };
    const dealRng = createRng(`${this.seed}:deal:${this.currentSprintId}`);
    // RI-78: ショップで買ったカードは次スプリント手札へ優先配布する。
    const prefer = this.pendingShopHandIndices;
    this.pendingShopHandIndices = [];
    this.sprint.cardPiles = dealHand(this.deck.length, dealRng, undefined, prefer);
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
        scenario: this.scenario,
        bossId: this.bossId,
        goalCarryoverQuarter: this.goalCarryoverQuarter,
        goalCarryoverId: this.goalCarryoverId,
        pauseAiDebuffQuarter:
          this.goalCarryoverId === 'pause_ai_rollout' ? this.goalCarryoverQuarter : null,
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

  /**
   * 介入アクションを発動する（sprint フェーズのみ。第6章）。
   * 成功後も即時敗北は見ない（`playCard` と対照。`dispatchDefersLose` を参照）。
   * 敗北は `resolveSprint` まで延期し、その間の自然回復で生存し得る。
   */
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
      this.activeTeamId,
    );
    if (outcome.ok) {
      // RI-88: コスト最適化カードで infraCostMul が下がったら、開始時課金との差額を返す。
      const mul = this.sprint.cardEffects.infraCostMul;
      if (this.chargedInfraCost > 0 && this.chargedInfraRate > 0 && mul < 1) {
        const revised = computeInfraCost(this.chargedInfraDependency, this.chargedInfraRate, mul);
        const refund = Math.max(0, this.chargedInfraCost - revised);
        if (refund > 0) {
          this.budget += refund;
          this.chargedInfraCost = revised;
        }
      }
      this.applyImmediateLose();
    }
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
    this.applyIncidentTrustPenalty(result);
    this.applyGrowth(result);
    // スプリント終了時に個体スタミナを一部回復する（休職者は復帰しうる）。
    // ここで回復させることで、続くビート／編成ウィンドウで復帰メンバーをすぐ再配置できる。
    const justLeft = new Set((this.lastGrowth?.wentOnLeave ?? []).map((w) => w.id));
    this.roster = recoverStamina(this.roster, STAMINA_RECOVER_BETWEEN, justLeft);
    // RI-64: 選択チームを永続へ同期し、他チームを粗粒度で進める。
    this.syncActiveTeamFromOrg();
    this.advanceOtherTeams(`sprint:${this.currentSprintId}`);
    // 粗粒度の完了・AI 支援を totals へ載せた後で診断する（報酬・図鑑の取りこぼし防止）。
    this.diagnosis = diagnose(this.org, this.totals);

    if (this.currentSprintKind === 'boss') {
      const lose = evaluateLose(this.org, this.totals, this.budget);
      if (lose) {
        this.flushCoarseIncidentCarry();
        this.status = 'lost';
        this.loseReason = lose;
        this.setPhase('lost');
        return;
      }
      const boss = getBoss(this.bossId);
      const bossTargetMul = getDifficulty(this.difficulty).bossTargetMul;
      // ボス突破は選択中チームの詳細盤面、四半期 KPI は全社集約（他チーム悪化を取りこぼさない）。
      const companyOrg = companyOrgFromTeams(this.teams, this.org);
      const bossCleared = !!boss && evaluateBoss({ boss, result, org: this.org, bossTargetMul });
      // 四半期末の粗粒度炎上端数を切り捨てず KPI 判定前に繰り入れる。
      this.flushCoarseIncidentCarry();
      // 四半期 KPI は報酬前の全社集約で判定する（報酬の加算効果が同じ四半期を書き換えないように）。
      this.quarterReview = buildQuarterReview({
        goal: this.quarterGoal,
        org: companyOrg,
        totals: this.quarterTotals,
        trust: this.stakeholderTrust,
        budget: this.budget,
        quarterNumber: this.quarterNumber,
        bossSprintCleared: bossCleared,
      });
      if (bossCleared) {
        // 勝利種別は選択中チームの報酬前状態で判定する。
        this.winEvalOrg = structuredClone(this.org);
        this.bossRelicReward = this.grantBossRelic();
      }
      this.reviewHistory = [...this.reviewHistory, this.quarterReview.outcome];
      this.setPhase('quarterReview');
      return;
    }

    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.flushCoarseIncidentCarry();
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
   * 事故／延焼があったスプリントで顧客信頼を下げる（RI-87）。
   * セキュリティ水準が高いほど下振れを抑える。
   */
  private applyIncidentTrustPenalty(result: SprintResult): void {
    const m = this.sprint?.metrics;
    const minimumCount = PROCESS_BALANCE.incidentTrustMinimumCount.value;
    const delta =
      result.spread > 0 &&
      result.spread >= minimumCount &&
      m &&
      typeof m.securityTrustSpreadRaw === 'number'
        ? securityCustomerTrustFromRaw(
            m.securityTrustSpreadRaw +
              Math.max(minimumCount, result.incidents) *
                PROCESS_BALANCE.incidentTrustPerIncidentRaw.value *
                (m.securityTrustIncidentFragility ?? securityFragility(this.org.securityLevel)),
          )
        : securityCustomerTrustDelta(this.org.securityLevel, result.incidents, result.spread);
    if (delta !== 0) this.applyTrust({ customers: delta });
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
    const base = EVO_POINTS_BASE + Math.floor(result.delivered / EVO_POINTS_DELIVERED_DIVISOR);
    return this.currentSprintKind === 'elite' ? base + EVO_POINTS_ELITE_BONUS : base;
  }

  /** 四半期レビューを承認する（達成→won / 継続不能→lost）。 */
  acknowledgeQuarterReview(): void {
    if (this.phase !== 'quarterReview' || !this.quarterReview) return;
    const { outcome } = this.quarterReview;
    if (canAcknowledgeWin(outcome)) {
      this.flushCoarseIncidentCarry();
      this.status = 'won';
      // 旧セーブに保存された診断は旧式 rework/completed の可能性があるため、
      // 勝利判定直前に現行ロジックで再計算する。
      const winOrg = this.winEvalOrg ?? this.org;
      this.diagnosis = diagnose(winOrg, this.totals);
      this.winType = evaluateWinType({
        org: winOrg,
        totals: this.totals,
        budget: this.budget,
        usedHeavyActions: this.usedHeavyActions,
        diagnosis: this.diagnosis,
      });
      this.setPhase('won');
      return;
    }
    if (isTerminalFailure(outcome)) {
      this.flushCoarseIncidentCarry();
      this.status = 'lost';
      // loseReason の分類も buildQuarterReview と同じ全社集約 org で行う（RI-79）。
      this.loseReason = loseReasonForOutcome(outcome, {
        progress: this.quarterReview.progress,
        trust: this.quarterReview.trust,
        org: companyOrgFromTeams(this.teams, this.org),
        budget: this.budget,
        quarterNumber: this.quarterNumber,
        totals: this.totals,
      });
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

    // org 効果は選択中だけでなく全チーム正本へ焼き込む（切替で消えないように）。
    this.syncActiveTeamFromOrg();
    const adjustmentDef = getGoalAdjustment(id);
    // RI-83: 次四半期だけ効く物理キャリーオーバーを記録する。
    if (adjustmentDef && hasNextQuarterCarryover(adjustmentDef)) {
      this.goalCarryoverQuarter = this.quarterNumber + 1;
      this.goalCarryoverId = id;
    } else {
      this.goalCarryoverQuarter = null;
      this.goalCarryoverId = null;
    }
    if (adjustmentDef) {
      this.teams = this.teams.map((t) =>
        t.id === this.activeTeamId ? t : applyGoalOrgEffectsToTeam(t, adjustmentDef),
      );
      // ラン累計スコア（totals.delivered）にも出荷評価倍率を反映する。
      const mul = adjustmentDef.orgEffects?.deliveryScoreMul;
      if (mul !== undefined) {
        this.totals.delivered = Math.round(this.totals.delivered * mul);
        this.quarterTotals.delivered = Math.round(this.quarterTotals.delivered * mul);
      }
    }

    if (id === 'reorg_teams') {
      this.applyReorgDeparture();
      // 離脱後の稼働人数を正本・キャッシュへ反映（全社表示の人数ズレを防ぐ）。
      this.syncActiveTeamFromOrg();
    }

    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.flushCoarseIncidentCarry();
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
    this.coarseIncidentCarry = 0;
    this.coarseSecurityTrustRaw = 0;
    this.coarseSecurityTrustCount = 0;
    this.coarseSecurityTrustAppliedDelta = 0;

    this.sprintIndexInQuarter = 0;
    this.pendingSprintKind = 'normal';
    this.currentSprintKind = 'normal';
    this.pendingSprintModifiers = {};
    this.pendingShopHandIndices = [];
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
    this.draftMulliganUsed = false;
    this.draft = drawDraft(
      createRng(`${this.seed}:draft:${this.sprintsPlayed}`),
      3,
      this.allowedCards ?? undefined,
      this.preferredCards,
    );
    this.setPhase('draft');
  }

  /** ドラフトでカードを選びデッキに加える（加算系の効果は即時に組織へ反映）。 */
  chooseCard(defId: string): void {
    if (this.phase !== 'draft') return;
    if (!this.draft?.includes(defId)) return;
    this.addCard(defId, 1);
    this.draft = null;
    this.draftMulliganUsed = false;
    // RI-30: カード効果は手札発動時に反映されるため、獲得時の即時敗北は見ない。
    this.setPhase('evolution');
  }

  /** ドラフトをスキップする。 */
  skipDraft(): void {
    if (this.phase !== 'draft') return;
    this.draft = null;
    this.draftMulliganUsed = false;
    this.setPhase('evolution');
  }

  /**
   * ドラフトを予算コストで引き直す（RI-81 / F-12）。
   * 1ドラフトあたり1回。phase は draft のまま候補だけ差し替える。
   * 元候補と同じ集合になる抽選は最大数回まで再試行する。
   */
  mulliganDraft(): void {
    if (this.phase !== 'draft' || !this.draft) return;
    if (this.draftMulliganUsed) return;
    if (this.budget <= DRAFT_MULLIGAN_COST) return;
    const previousKey = [...this.draft].sort().join('\0');
    let next = this.draft;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = drawDraft(
        createRng(`${this.seed}:draft:${this.sprintsPlayed}:m1:${attempt}`),
        3,
        this.allowedCards ?? undefined,
        this.preferredCards,
      );
      next = candidate;
      if ([...candidate].sort().join('\0') !== previousKey) break;
    }
    this.budget -= DRAFT_MULLIGAN_COST;
    this.draftMulliganUsed = true;
    this.draft = next;
    if (this.applyImmediateLose()) return;
  }

  /** 進化ノードを解放する（加算系効果は即時反映。phase は evolution のまま）。 */
  unlockEvolution(id: string): void {
    if (this.phase !== 'evolution') return;
    if (!canUnlock(this.evolution, id)) return;
    const node = getEvolutionNodeEffects(id);
    if (node) this.applyCompanyBaseline(toEffects(node));
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
      // beat を経由し（RI-77: 編成 setup へ戻す）、次スプリント前に配置を問い直す。
      // 同期処理内の2段遷移なのでスナップショットが中間状態を観測することはない。
      this.setPhase('beat');
      this.setPhase('setup');
      return;
    }
    this.beat = { eventId: def.id, kind: effectiveKind(def) };
    this.setPhase('beat');
  }

  /**
   * 提示中ビートを解決する。判定は引数なし（hidden choice[0] を自動適用）、
   * 選択は choiceIndex。選択の `leadsTo` で setup(通常/高負荷スプリント前)/shop/rest/recruit へ分岐する。
   * sprint 系は RI-77 により必ず setup を経由する。
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
      this.flushCoarseIncidentCarry();
      this.status = 'lost';
      this.loseReason = res.forceLose;
      this.setPhase('lost');
      return;
    }
    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (lose) {
      this.flushCoarseIncidentCarry();
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
          this.flushCoarseIncidentCarry();
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
    // RI-77: スプリント直行せず編成へ戻し、AI 配布・配置を毎スプリント前に問い直す。
    // 遷移表の `beat.RESOLVE → setup` に合わせる（shop/rest/recruit 後と同じ入口）。
    this.setPhase('setup');
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
    const cardIds = drawDraft(rng, 3, this.allowedCards ?? undefined, this.preferredCards);
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
    const beforeLen = this.deck.length;
    this.addCard(defId, 1);
    // RI-78: 購入カードは次スプリントの手札へ優先して配る（投資が次スプで効くように）。
    if (this.deck.length > beforeLen) {
      this.pendingShopHandIndices.push(this.deck.length - 1);
      // 導入支援はショップ訪問あたり一度だけ（買い漁りで累積させない。RI-78）。
      if (!this.shop.introSupportGranted) {
        this.shop.introSupportGranted = true;
        this.pendingSprintModifiers = mergeModifiers(this.pendingSprintModifiers, {
          focusMaxAdd: 2,
          taskCountMul: 1.1,
        });
      }
    }
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
      this.pendingSprintModifiers = mergeModifiers(this.pendingSprintModifiers, {
        reworkRateAdd: REST_REPAY_REWORK_RATE,
      });
    } else if (option === 'upgrade' && this.deck.length > 0) {
      const upgraded = upgradeCardAt(this.deck, deckIndex ?? 0);
      if (upgraded !== this.deck) {
        this.deck = upgraded;
        this.pendingSprintModifiers = mergeModifiers(this.pendingSprintModifiers, {
          focusMaxAdd: REST_UPGRADE_FOCUS_MAX,
        });
      }
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

  /** 入り込み拘束中か（他チーム閲覧・切替の機会損失）。 */
  private isTeamEnterLocked(): boolean {
    return this.sprintsPlayed < this.teamLockUntilSprint;
  }

  /** 即時敗北条件を評価し、該当すれば lost へ遷移する。 */
  private applyImmediateLose(): boolean {
    const lose = evaluateLose(this.org, this.totals, this.budget);
    if (!lose) return false;
    // 終端前に粗粒度炎上累積を確定する（リザルト／リプレイの取りこぼし防止）。
    this.flushCoarseIncidentCarry();
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
    if (relic.effects) this.applyCompanyBaseline(toEffects(relic.effects));
  }

  /**
   * 全社加算効果（進化・レリック）を選択中 org と全チーム正本へ焼き込む。
   * 入り込み先でも効果が消えないようにする（RI-64）。
   */
  private applyCompanyBaseline(effects: CardEffects): void {
    applyDeckBaseline(this.org, effects);
    this.teams = this.teams.map((t) => {
      const next = {
        ...t,
        aiLiteracy: clamp(t.aiLiteracy + effects.aiLiteracyAdd, 0, 100),
        aiDependency: clamp(t.aiDependency + effects.aiDependencyAdd, 0, 100),
        quality: clamp(t.quality + effects.qualityAdd, 0, 100),
        testCoverage: clamp(t.testCoverage + effects.testCoverageAdd, 0, 100),
        securityLevel: clamp(
          (t.securityLevel ?? t.quality) + effects.securityAdd,
          PROCESS_BALANCE.securityLevelMinimum.value,
          PROCESS_BALANCE.securityLevelMaximum.value,
        ),
      };
      // 品質加算後すぐ障害傾向へ反映し、次の粗粒度ステップで取りこぼさない。
      return { ...next, ...deriveTeamCapacities(next) };
    });
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
    // 入り込み拘束中は他チームを見られない（上位ビューへの離脱を拒否）。
    if (this.isTeamEnterLocked() && level !== 'team') return;
    if (level === 'department' && !this.zoom.deptId) {
      this.zoom.deptId = DEPARTMENT_DEFS[0]?.id ?? null;
    }
    this.zoom = { ...this.zoom, level };
  }

  /** 部門をフォーカスして部署ビューへ（ドリルダウン）。 */
  focusDepartment(id: string): void {
    if (this.isTeamEnterLocked()) return;
    if (!DEPARTMENT_DEFS.some((d) => d.id === id)) return;
    this.zoom = { ...this.zoom, level: 'department', deptId: id };
  }

  /**
   * チームを状態確認する（第4.11 / RI-64）。
   * 選択中チームなら現場へ、それ以外は部署ビューへ寄せて指標を見せる（入り込みは enterTeam）。
   * 入り込み拘束中は非アクティブチームの閲覧も拒否する（機会損失）。
   */
  focusTeam(id: string): void {
    const team = this.teams.find((t) => t.id === id);
    if (!team) return;
    if (id === this.activeTeamId) {
      this.zoom = { ...this.zoom, level: 'team', teamId: id, deptId: team.deptId };
      return;
    }
    if (this.isTeamEnterLocked()) return;
    this.zoom = { ...this.zoom, level: 'department', deptId: team.deptId, teamId: id };
  }

  /**
   * 特定チームへ入り込み、詳細スプリント対象にする（RI-64）。
   * スプリント中・ロック中は拒否。切替時は集中力ペナルティと期間拘束を付与する。
   */
  enterTeam(id: string): boolean {
    if (this.phase === 'title' || this.phase === 'won' || this.phase === 'lost') return false;
    if (this.phase === 'sprint') return false;
    const team = this.teams.find((t) => t.id === id);
    if (!team) return false;
    if (id === this.activeTeamId) {
      this.zoom = { ...this.zoom, level: 'team', teamId: id, deptId: team.deptId };
      return true;
    }
    // 四半期レビュー中の切替は拒否（startNextQuarter が pendingSprintModifiers を消すため）。
    if (this.phase === 'quarterReview') return false;
    // ビート提示中の切替は拒否（適格性・重みは旧チーム、解決は新チームになってしまう）。
    if (this.phase === 'beat') return false;
    if (this.sprintsPlayed < this.teamLockUntilSprint) return false;

    this.flushActiveTeam();
    this.hydrateTeam(id);
    this.pendingSprintModifiers = mergeModifiers(this.pendingSprintModifiers, {
      focusMaxAdd: ENTER_TEAM_FOCUS_PENALTY,
    });
    this.teamLockUntilSprint = this.sprintsPlayed + ENTER_TEAM_LOCK_SPRINTS;
    this.zoom = { ...this.zoom, level: 'team', teamId: id, deptId: team.deptId };
    return true;
  }

  /** 選択中チームの org/roster を永続配列へ書き戻す。 */
  private syncActiveTeamFromOrg(): void {
    const idx = this.teams.findIndex((t) => t.id === this.activeTeamId);
    if (idx < 0) return;
    // 実行中スプリントの盤面だけを正とする。result 以降に残った盤面で施策効果を巻き戻さない。
    const sprintExtras =
      this.sprint && this.phase === 'sprint'
        ? {
            reviewQueue: this.sprint.tasks.filter((t) => t.lane === 'review').length,
            incidents: this.sprint.tasks.filter((t) => t.incident).length,
          }
        : {};
    // ロスター上限外の席は常時稼働として残し、7〜8 人チームを 6 人へ縮めない。
    const counts = engineersFromRoster(this.teams[idx]!, this.roster);
    this.teams[idx] = syncTeamFromOrg(this.teams[idx], this.org, {
      engineers: counts.engineers,
      headcount: counts.headcount,
      ...sprintExtras,
    });
    this.teamRosters[this.activeTeamId] = structuredClone(this.roster);
  }

  /**
   * 施策で下がった行列・炎上を実行中盤面にも反映する。
   * 盤面を触らないと直後の同期／俯瞰 activeLive が古い件数で上書きしてしまう。
   */
  private alignSprintBoardToTeam(team: { reviewQueue: number; incidents: number }): void {
    if (!this.sprint || this.phase !== 'sprint') return;
    // 行列削減は非炎上の Review を優先し、炎上を無料鎮火しない。
    const reviewCount = () => this.sprint!.tasks.filter((t) => t.lane === 'review').length;
    const calmReviews = this.sprint.tasks.filter((t) => t.lane === 'review' && !t.incident);
    const reviewCut = Math.max(0, reviewCount() - Math.max(0, team.reviewQueue));
    let removed = 0;
    for (const task of calmReviews) {
      if (removed >= reviewCut) break;
      // 施策一掃でも出荷集計の帳尻を合わせる（Done にして成果を消さない）。
      forceShipReviewTask(task, this.sprint, this.org);
      removed += 1;
    }
    const fires = this.sprint.tasks.filter((t) => t.incident);
    const fireCut = Math.max(0, fires.length - Math.max(0, team.incidents));
    for (let i = 0; i < fireCut; i += 1) {
      const task = fires[i];
      if (!task) break;
      task.incident = false;
      delete task.burnTicksLeft;
      if (task.lane === 'rework') {
        task.lane = 'review';
        task.progress = 0;
      }
      this.sprint.metrics.contained += 1;
    }
    // 炎上温存で切れなかった行列は、実際の盤面件数へ正本を合わせる。
    const idx = this.teams.findIndex((t) => t.id === this.activeTeamId);
    if (idx < 0) return;
    const reviewQueue = reviewCount();
    const incidents = this.sprint.tasks.filter((t) => t.incident).length;
    const aligned = { ...this.teams[idx], reviewQueue, incidents };
    this.teams[idx] = { ...aligned, ...deriveTeamCapacities(aligned) };
  }

  private flushActiveTeam(): void {
    this.syncActiveTeamFromOrg();
  }

  private hydrateTeam(id: string): void {
    const team = this.teams.find((t) => t.id === id);
    if (!team) return;
    this.activeTeamId = id;
    // 上位レバーは適用時に TeamRunState へ焼き込み済みなので、正本からそのまま復元する。
    this.org = orgFromTeam(team);
    // 切替直後から全社マップ／業界の組織タイプが新チーム指標と一致するようにする。
    this.diagnosis = diagnose(this.org, this.totals);
    const cached = this.teamRosters[id];
    this.roster = cached
      ? structuredClone(cached)
      : createTeamRoster(this.seed, id, team.engineers, team.aiDependency);
    this.teamRosters[id] = structuredClone(this.roster);
  }

  /**
   * 四半期末に粗粒度炎上の累積を KPI へ繰り入れる。
   * ステップごとの丸めで消さず四半期中に溜め、1 未満は四半期境界で破棄する。
   */
  private flushCoarseIncidentCarry(): void {
    const credited = Math.floor(this.coarseIncidentCarry + 1e-9);
    this.coarseIncidentCarry = 0;
    this.coarseSecurityTrustRaw = 0;
    this.coarseSecurityTrustCount = 0;
    this.coarseSecurityTrustAppliedDelta = 0;
    if (credited <= 0) return;
    this.totals.incidents += credited;
    this.quarterTotals.incidents += credited;
  }

  /** 粗粒度炎上の顧客信頼 raw を四半期内で繰り越し、しきい値を跨いだ分だけ適用する。 */
  private applyCoarseSecurityTrust(spreadRaw: number, spreadCount = 1): void {
    if (spreadCount <= 0) return;
    this.coarseSecurityTrustCount += spreadCount;
    this.coarseSecurityTrustRaw += spreadRaw;
    this.reconcileCoarseSecurityTrust();
  }

  /** 現在の最小件数を満たす未適用の信頼低下だけを顧客信頼へ反映する。 */
  private reconcileCoarseSecurityTrust(): void {
    if (this.coarseSecurityTrustCount < PROCESS_BALANCE.incidentTrustMinimumCount.value) return;
    const next = securityCustomerTrustFromRaw(this.coarseSecurityTrustRaw);
    // バランス更新で raw 閾値を上げても、すでに起きた信頼低下は戻さない。
    const delta = Math.min(0, next - this.coarseSecurityTrustAppliedDelta);
    if (delta !== 0) this.applyTrust({ customers: delta });
    this.coarseSecurityTrustAppliedDelta = Math.min(this.coarseSecurityTrustAppliedDelta, next);
  }

  /** 粗粒度進行用に、キャリーオーバー込みの係数を畳み込む（RI-83）。 */
  private coarseModifiersFromFold(fold: ReturnType<typeof foldRunEffects>): {
    incidentRateMul: number;
    shipMul: number;
    reviewMul: number;
    reviewCapacityMul: number;
    reworkRateAdd: number;
    seniorHpCostMul: number;
    aiDependencyDrift: number;
  } {
    const effects = applyGoalCarryoverToEffects(
      fold.effects,
      this.goalCarryoverId,
      this.goalCarryoverQuarter,
      this.quarterNumber,
    );
    // Rework はこれまで粗粒度未適用だったため、カード等のベース分は足さず
    // 目標修正キャリーオーバー差分だけを載せる（既存 seed / 勝率を壊さない）。
    // RI-103: シナリオの手戻りと定型速度だけは選択チームと揃え、非選択チームへも渡す。
    const scenarioFx = getScenario(this.scenario).globalEffects;
    const scenarioRework = scenarioFx?.reworkRateAdd ?? 0;
    const reworkRateAdd = effects.reworkRateAdd - fold.effects.reworkRateAdd + scenarioRework;
    // 粗粒度はタスク種別を持たないので、定型出現比 0.3（`sprint.ts` KIND_WEIGHTS）で混ぜる。
    const scenarioRoutine = scenarioFx?.routineSpeedMul ?? 1;
    const shipMul = effects.codingSpeedMul * (1 + (scenarioRoutine - 1) * 0.3);
    return {
      incidentRateMul: effects.incidentRateMul,
      shipMul,
      reviewMul: effects.reviewEfficiencyMul,
      reviewCapacityMul: effects.reviewCapacityMul,
      reworkRateAdd,
      // RI-73: 詳細 sim と同じ seniorHpCostMul を粗粒度の消耗にも載せる。
      seniorHpCostMul: effects.seniorHpCostMul,
      aiDependencyDrift: fold.aiDependencyDriftPerSprint,
    };
  }

  /** 粗粒度シニア負荷分散用に、保存済みロスターから配置人数マップを作る（RI-73）。 */
  private coarseRosterShareMaps(): {
    assignedByTeamId: Record<string, number>;
    reviewersByTeamId: Record<string, number>;
  } {
    const assignedByTeamId: Record<string, number> = {};
    const reviewersByTeamId: Record<string, number> = {};
    for (const [id, roster] of Object.entries(this.teamRosters)) {
      assignedByTeamId[id] = activeAssignedCount(roster);
      reviewersByTeamId[id] = activeReviewerCount(roster);
    }
    return { assignedByTeamId, reviewersByTeamId };
  }

  private advanceOtherTeams(stepKey: string): void {
    const before = this.teams;
    const fold = foldRunEffects({
      deck: this.deck,
      relics: this.relics,
      evolution: this.evolution,
      difficulty: this.difficulty,
      trials: this.trials,
      scenario: this.scenario,
    });
    const { assignedByTeamId, reviewersByTeamId } = this.coarseRosterShareMaps();
    const stepped = advanceCoarseTeams(this.teams, {
      seed: this.seed,
      stepKey,
      excludeId: this.activeTeamId,
      adjust: this.orgAdjust,
      modifiers: this.coarseModifiersFromFold(fold),
      assignedByTeamId,
      reviewersByTeamId,
    });
    this.teams = stepped.teams;
    // 粗粒度チームの出荷・炎上・完了・AI 支援をラン／四半期集計へ反映する。
    const delta = normalizeCoarseTotalsDelta(
      before,
      this.teams,
      this.activeTeamId,
      stepped.ignited,
      stepped.completed,
      stepped.aiAssisted,
      this.coarseIncidentCarry,
    );
    // RI-87: 非選択チームの炎上 raw を四半期内で繰り越し、0.5 未満をステップ丸めで消さない。
    this.applyCoarseSecurityTrust(stepped.securityTrustSpreadRaw, stepped.ignited);
    // 炎上は四半期末 flush まで raw 累積（ステップ丸めで 0 固定にしない）。
    this.coarseIncidentCarry = delta.incidents + delta.incidentCarry;
    this.totals.delivered += delta.delivered;
    this.quarterTotals.delivered += delta.delivered;
    this.totals.completed += delta.completed;
    this.quarterTotals.completed += delta.completed;
    this.totals.aiAssisted += delta.aiAssisted;
    this.quarterTotals.aiAssisted += delta.aiAssisted;
    // 非選択チームの行列ピークも勝敗・診断へ反映する（ステップ前後の最大を見る）。
    for (const team of before) {
      if (team.id === this.activeTeamId) continue;
      this.totals.reviewQueuePeak = Math.max(this.totals.reviewQueuePeak, team.reviewQueue);
      this.quarterTotals.reviewQueuePeak = Math.max(
        this.quarterTotals.reviewQueuePeak,
        team.reviewQueue,
      );
    }
    for (const team of this.teams) {
      if (team.id === this.activeTeamId) continue;
      this.totals.reviewQueuePeak = Math.max(this.totals.reviewQueuePeak, team.reviewQueue);
      this.quarterTotals.reviewQueuePeak = Math.max(
        this.quarterTotals.reviewQueuePeak,
        team.reviewQueue,
      );
    }
    // 訪問済みキャッシュのロスターもスプリント間回復を進める（戻ったときに休職が永久化しない）。
    for (const id of Object.keys(this.teamRosters)) {
      if (id === this.activeTeamId) continue;
      this.teamRosters[id] = recoverStamina(this.teamRosters[id], STAMINA_RECOVER_BETWEEN);
      // 復職で稼働人数が戻ったら粗粒度正本へも同期する（ロスター外席も維持）。
      const idx = this.teams.findIndex((t) => t.id === id);
      if (idx < 0) continue;
      const roster = this.teamRosters[id]!;
      const team = this.teams[idx]!;
      const counts = engineersFromRoster(team, roster);
      if (
        team.engineers === counts.engineers &&
        (team.headcount ?? team.engineers) === counts.headcount
      )
        continue;
      this.teams[idx] = {
        ...team,
        engineers: counts.engineers,
        headcount: counts.headcount,
        ...deriveTeamCapacities({
          engineers: counts.engineers,
          reviewQueue: team.reviewQueue,
          incidents: team.incidents,
          quality: team.quality,
          securityLevel: team.securityLevel,
        }),
      };
    }
  }

  /** 業界ランキングの種別タブを切り替える。 */
  setRankingKind(kind: RankingKind): void {
    this.rankingKind = kind;
  }

  /**
   * 全社 / 部門 / チームレバーを発動する（四半期予算を消費して下位制約を緩める。第4.7）。
   * 予算不足・スコープ不一致は何も起きない。返り値は適用できたか。
   */
  applyOrgLever(leverId: string, deptId?: string, teamId?: string): boolean {
    // ラン外（タイトル・終端）では発動しない（即時敗北判定が終端フェーズから再遷移しないように）。
    if (this.phase === 'title' || this.phase === 'won' || this.phase === 'lost') return false;
    // RI-75: minCompleteTick 待ち（時間調整だけのパディング）では組織レバーも拒否する。
    if (this.phase === 'sprint' && this.sprint && isAwaitingMinCompleteTick(this.sprint)) {
      return false;
    }
    const def = getLever(leverId);
    // チームレバーは存在確認してから予算を消費する（未知 ID で予算だけ減らないように）。
    if (def?.scope === 'team' && (!teamId || !this.teams.some((t) => t.id === teamId))) {
      return false;
    }
    // 入り込み拘束中は他チームへの施策も拒否する（閲覧抑止と一貫させる）。
    if (
      def?.scope === 'team' &&
      teamId &&
      teamId !== this.activeTeamId &&
      this.isTeamEnterLocked()
    ) {
      return false;
    }
    const res = applyLever(this.orgAdjust, this.budget, leverId, deptId, teamId);
    if (!res.changed || !def) return false;
    this.budget = res.budget;
    // スプリント中でもライブ org を正本へ先に同期し、焼き込み後の復元で巻き戻さない。
    this.syncActiveTeamFromOrg();
    if (res.extraTeamsAdded > 0) {
      const template =
        this.teams.find((t) => t.id === this.homeTeamId) ??
        this.teams[0] ??
        initTeamRunStates({
          seed: this.seed,
          org: this.org,
          homeEngineers: activeEngineerCount(this.roster),
        })[0];
      const productCount = this.teams.filter((t) => t.deptId === 'product').length;
      const beforeIds = new Set(this.teams.map((t) => t.id));
      this.teams = appendTeamsToDept(this.teams, {
        seed: this.seed,
        deptId: 'product',
        count: res.extraTeamsAdded,
        template,
        nextIndexStart: productCount,
      });
      // テンプレート指標はカード加算済みなので、新チーム ID にも適用済みレベルを継承する。
      const newIds = this.teams.filter((t) => !beforeIds.has(t.id)).map((t) => t.id);
      this.deck = inheritBaselineAppliedForTeams(this.deck, this.homeTeamId, newIds);
    }
    // 指標効果は対象チーム正本へ焼き込み、詳細スプリントと俯瞰表示を一致させる。
    // orgAdjust には infraBoost 等の非指標のみ残し、投影・粗粒度で二重適用しない。
    let activeTouched = false;
    if (def.scope === 'company') {
      this.teams = this.teams.map((t) => applyEffectToTeam(t, def.effect));
      const active = this.teams.find((t) => t.id === this.activeTeamId);
      if (active) {
        this.org = orgFromTeam(active);
        activeTouched = true;
      }
      this.orgAdjust = stripMetricAdjustments(res.adjust);
    } else if (def.scope === 'department' && deptId) {
      this.teams = this.teams.map((t) =>
        t.deptId === deptId ? applyEffectToTeam(t, def.effect) : t,
      );
      const active = this.teams.find((t) => t.id === this.activeTeamId);
      if (active && active.deptId === deptId) {
        this.org = orgFromTeam(active);
        activeTouched = true;
      }
      this.orgAdjust = stripMetricAdjustments(res.adjust);
    } else if (res.teamId) {
      this.teams = this.teams.map((t) =>
        t.id === res.teamId ? applyEffectToTeam(t, def.effect) : t,
      );
      if (res.teamId === this.activeTeamId) {
        const updated = this.teams.find((t) => t.id === res.teamId);
        if (updated) {
          this.org = orgFromTeam(updated);
          activeTouched = true;
        }
      }
      this.orgAdjust = res.adjust;
    } else {
      this.orgAdjust = res.adjust;
    }
    if (activeTouched) {
      const active = this.teams.find((t) => t.id === this.activeTeamId);
      if (active) this.alignSprintBoardToTeam(active);
    }
    this.applyImmediateLose();
    return true;
  }

  /** 現在の全社マップ集約を生成する（決定論。第4.8）。 */
  private buildOrgScale(): OrgScaleState {
    const activeTeam = this.teams.find((t) => t.id === this.activeTeamId);
    const liveEngineers = Math.max(activeTeam?.engineers ?? 0, activeEngineerCount(this.roster));
    // 実行中スプリントのみ盤面件数。result 以降は正本（施策焼き込み後）を使う。
    const liveBoard = !!this.sprint && this.phase === 'sprint';
    const reviewQueue = liveBoard
      ? this.sprint!.tasks.filter((t) => t.lane === 'review').length
      : (activeTeam?.reviewQueue ?? 0);
    const incidents = liveBoard
      ? this.sprint!.tasks.filter((t) => t.incident).length
      : (activeTeam?.incidents ?? 0);
    return projectOrgScale({
      seed: this.seed,
      teams: this.teams,
      homeTeamId: this.homeTeamId,
      activeTeamId: this.activeTeamId,
      activeLive: activeLiveFromOrg({
        org: this.org,
        engineers: liveEngineers,
        aiAssignedCount: aiAssignedCount(this.roster),
        reviewQueue,
        incidents,
      }),
      adjust: this.orgAdjust,
      diagnosis: this.diagnosis,
      budget: this.budget,
      // スプリント中の org 更新（ガイドライン等）を共通基盤へ即時反映する。
      infraBase: companyInfraFromTeams(
        this.teams.map((t) =>
          t.id === this.activeTeamId
            ? {
                ...t,
                aiLiteracy: this.org.aiLiteracy,
                testCoverage: this.org.testCoverage,
                documentation: this.org.documentation,
              }
            : t,
        ),
      ),
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
    // 選択中 org をチームへ同期してから他チーム依存度を渡す（RI-88 全社課金）。
    this.syncActiveTeamFromOrg();
    const activeTeam = this.teams.find((t) => t.id === this.activeTeamId);
    return {
      phase: this.phase,
      seed: this.seed,
      quarterNumber: this.quarterNumber,
      sprintIndexInQuarter: this.sprintIndexInQuarter,
      sprintsPerQuarter: this.sprintsPerQuarter,
      pendingSprintKind: this.pendingSprintKind,
      pendingSprintModifiers: { ...this.pendingSprintModifiers },
      deck: this.deck.map(cloneCardInstance),
      draft: this.draft ? [...this.draft] : null,
      roster: structuredClone(this.roster),
      org: structuredClone(this.org),
      budget: this.budget,
      totals: { ...this.totals },
      relics: [...this.relics],
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      difficulty: this.difficulty,
      trials: [...this.trials],
      scenario: this.scenario,
      bossId: this.bossId,
      goalCarryoverQuarter: this.goalCarryoverQuarter,
      goalCarryoverId: this.goalCarryoverId,
      pauseAiDebuffQuarter:
        this.goalCarryoverId === 'pause_ai_rollout' ? this.goalCarryoverQuarter : null,
      baseConfig: { ...this.baseConfig },
      // 入り込み先の滞留を試算でも本番 beginSprint と同じく載せる。
      teamReviewQueue: activeTeam?.reviewQueue ?? 0,
      teamIncidents: activeTeam?.incidents ?? 0,
      otherTeamAiDependencies: this.teams
        .filter((t) => t.id !== this.activeTeamId)
        .map((t) => t.aiDependency),
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

  /**
   * ラン途中セーブ用の永続スナップショット（RI-58）。
   * セーブ可能フェーズ以外、または playing 以外では null。
   * スプリント本体は肥大化と RNG 非シリアライズのため常に落とす。
   */
  exportPersistState(): RunPersistState | null {
    if (!isRunSavePhase(this.phase) || this.status !== 'playing') return null;
    return this.buildPersistFrame() as RunPersistState;
  }

  /**
   * リプレイキーフレーム用スナップショット（RI-61）。
   * setup / result / quarterReview / won / lost のみ。sprint は落とす。
   */
  exportReplayFrame(): RunReplayFrame | null {
    if (!isReplayFramePhase(this.phase)) return null;
    return this.buildPersistFrame();
  }

  /**
   * 反実仮想用の中間スナップショット（RI-101）。
   * sprint フェーズと RNG 消費位置を含める。プレイヤーセーブには使わない。
   */
  exportCounterfactualFrame(): CounterfactualFrame | null {
    if (this.status !== 'playing') return null;
    return {
      persist: this.buildPersistFrame() as CounterfactualFrame['persist'],
      sprint: this.sprint ? structuredClone(this.sprint) : null,
      sprintTick: this.sprintTick,
      accumulatorMs: this.accumulatorMs,
      sprintRngState: getRngState(this.sprintRng),
      sprintBaselineInput: this.sprintBaselineInput
        ? structuredClone(this.sprintBaselineInput)
        : null,
      sprintPassiveEffects: { ...this.sprintPassiveEffects },
      chargedInfraCost: this.chargedInfraCost,
      chargedInfraDependency: this.chargedInfraDependency,
      chargedInfraRate: this.chargedInfraRate,
      allowedCards: this.allowedCards ? [...this.allowedCards] : null,
      allowedRelics: this.allowedRelics ? [...this.allowedRelics] : null,
    };
  }

  /** 反実仮想フレームから同一乱数状態を復元する（RI-101）。 */
  hydrateCounterfactualFrame(frame: CounterfactualFrame): void {
    this.applyPersistFrame(frame.persist as RunReplayFrame, {
      migrateLegacyAiDependency: false,
      normalizeSecurityLevel: true,
      recomputeTeamCapacities: true,
      reconcileCoarseSecurityTrust: false,
    });
    this.sprint = frame.sprint ? structuredClone(frame.sprint) : null;
    this.sprintTick = frame.sprintTick;
    this.accumulatorMs = frame.accumulatorMs;
    this.sprintBaselineInput = frame.sprintBaselineInput
      ? structuredClone(frame.sprintBaselineInput)
      : null;
    this.sprintPassiveEffects = { ...frame.sprintPassiveEffects };
    this.sprintRng = createRngFromState(frame.sprintRngState);
    this.chargedInfraCost = frame.chargedInfraCost;
    this.chargedInfraDependency = frame.chargedInfraDependency;
    this.chargedInfraRate = frame.chargedInfraRate;
    this.allowedCards = frame.allowedCards == null ? null : new Set(frame.allowedCards);
    this.allowedRelics = frame.allowedRelics == null ? null : new Set(frame.allowedRelics);
    this.whatIfCache = null;
  }

  private buildPersistFrame(): RunReplayFrame {
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      trials: [...this.trials],
      scenario: this.scenario,
      runKind: this.runKind,
      dailyDate: this.dailyDate,
      phase: this.phase as RunReplayFrame['phase'],
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
      pendingShopHandIndices: [...this.pendingShopHandIndices],
      org: structuredClone(this.org),
      deck: this.deck.map(cloneCardInstance),
      relics: [...this.relics],
      bossRelicReward: this.bossRelicReward,
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      roster: structuredClone(this.roster),
      lastGrowth: this.lastGrowth ? structuredClone(this.lastGrowth) : null,
      budget: this.budget,
      currentSprintId: this.currentSprintId,
      sprint: null,
      sprintTick: 0,
      lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
      draft: this.draft ? [...this.draft] : null,
      draftMulliganUsed: this.draftMulliganUsed,
      whatIf: null,
      whatIfStatus: 'idle',
      shop: this.shop
        ? {
            cards: this.shop.cards.map((c) => ({ ...c })),
            relic: this.shop.relic ? { ...this.shop.relic } : undefined,
            recruit: this.shop.recruit ? { ...this.shop.recruit } : undefined,
            ...(this.shop.introSupportGranted ? { introSupportGranted: true } : {}),
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
      goalCarryoverQuarter: this.goalCarryoverQuarter,
      goalCarryoverId: this.goalCarryoverId,
      reviewHistory: [...this.reviewHistory],
      zoom: { ...this.zoom },
      rankingKind: this.rankingKind,
      orgScale: null,
      industry: null,
      extras: {
        baseConfig: { ...this.baseConfig },
        orgAdjust: structuredClone(this.orgAdjust),
        nextBudgetCap: this.nextBudgetCap,
        goalCarryoverQuarter: this.goalCarryoverQuarter,
        goalCarryoverId: this.goalCarryoverId,
        // 旧セーブ互換: pause_ai のときだけ legacy フィールドも書く。
        pauseAiDebuffQuarter:
          this.goalCarryoverId === 'pause_ai_rollout' ? this.goalCarryoverQuarter : null,
        winEvalOrg: this.winEvalOrg ? structuredClone(this.winEvalOrg) : null,
        allowedCards: this.allowedCards ? [...this.allowedCards] : [],
        allowedRelics: this.allowedRelics ? [...this.allowedRelics] : [],
        preferredCardIds: [...this.preferredCards],
        scenario: this.scenario,
        teams: structuredClone(this.teams),
        activeTeamId: this.activeTeamId,
        homeTeamId: this.homeTeamId,
        teamLockUntilSprint: this.teamLockUntilSprint,
        teamRosters: structuredClone(this.teamRosters),
        coarseIncidentCarry: this.coarseIncidentCarry,
        coarseSecurityTrustRaw: this.coarseSecurityTrustRaw,
        coarseSecurityTrustCount: this.coarseSecurityTrustCount,
        coarseSecurityTrustAppliedDelta: this.coarseSecurityTrustAppliedDelta,
        draftMulliganUsed: this.draftMulliganUsed,
      },
    };
  }

  /** 永続スナップショットからラン状態を復元する（RI-58）。 */
  hydratePersistState(state: RunPersistState): void {
    if (!isRunSavePhase(state.phase) || state.status !== 'playing') {
      throw new Error(`cannot hydrate run save in phase=${state.phase} status=${state.status}`);
    }
    this.applyPersistFrame(state, {
      migrateLegacyAiDependency: true,
      normalizeSecurityLevel: true,
      recomputeTeamCapacities: true,
      reconcileCoarseSecurityTrust: true,
    });
    // 現行スキーマでも診断式は変わりうる。保存済み diagnosis を現行ロジックで塗り替える。
    this.diagnosis = diagnose(this.org, this.totals);
  }

  /** リプレイキーフレームから閲覧用に復元する（RI-61。won/lost 可）。 */
  hydrateReplayFrame(frame: RunReplayFrame): void {
    if (!isReplayFramePhase(frame.phase)) {
      throw new Error(`cannot hydrate replay frame in phase=${frame.phase}`);
    }
    // リプレイは記録値の read-only 表示。旧セーブ移行は再開用 hydrate に限定する。
    this.applyPersistFrame(frame, {
      migrateLegacyAiDependency: false,
      normalizeSecurityLevel: false,
      recomputeTeamCapacities: false,
      reconcileCoarseSecurityTrust: false,
    });
  }

  private applyPersistFrame(
    state: RunReplayFrame,
    options: {
      migrateLegacyAiDependency: boolean;
      normalizeSecurityLevel: boolean;
      recomputeTeamCapacities: boolean;
      reconcileCoarseSecurityTrust: boolean;
    },
  ): void {
    const cloned = structuredClone(state);
    this.seed = cloned.seed;
    this.difficulty = cloned.difficulty;
    this.trials = [...cloned.trials];
    this.scenario = resolveScenarioId(cloned.extras.scenario ?? cloned.scenario);
    this.runKind = cloned.runKind;
    this.dailyDate = cloned.dailyDate;
    this.phase = cloned.phase;
    this.status = cloned.status;
    this.winType = cloned.winType;
    this.loseReason = cloned.loseReason;
    this.bossId = cloned.bossId;
    this.sprintsPerQuarter = cloned.sprintsPerQuarter;
    this.sprintIndexInQuarter = cloned.sprintIndexInQuarter;
    this.beat = cloned.beat;
    this.pendingSprintKind = cloned.pendingSprintKind;
    this.currentSprintKind = cloned.currentSprintKind;
    this.pendingSprintModifiers = { ...cloned.pendingSprintModifiers };
    this.pendingShopHandIndices = [...(cloned.pendingShopHandIndices ?? [])];
    this.org = cloned.org;
    // RI-87: 旧セーブに securityLevel が無い場合は品質を近似値として補完する。
    this.org.securityLevel = options.normalizeSecurityLevel
      ? clamp(
          typeof this.org.securityLevel === 'number' ? this.org.securityLevel : this.org.quality,
          PROCESS_BALANCE.securityLevelMinimum.value,
          PROCESS_BALANCE.securityLevelMaximum.value,
        )
      : typeof this.org.securityLevel === 'number'
        ? this.org.securityLevel
        : this.org.quality;
    this.deck = cloned.deck.map(cloneCardInstance);
    this.relics = [...cloned.relics];
    this.bossRelicReward = cloned.bossRelicReward;
    this.evolution = {
      points: cloned.evolution.points,
      unlocked: { ...cloned.evolution.unlocked },
    };
    this.roster = cloned.roster;
    this.lastGrowth = cloned.lastGrowth;
    this.budget = cloned.budget;
    this.currentSprintId = cloned.currentSprintId;
    this.sprint = null;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprintBaselineInput = null;
    this.sprintPassiveEffects = { ...IDENTITY_CARD_EFFECTS };
    this.sprintRng = createRng(`${cloned.seed}:hydrated`);
    this.lastResult = cloned.lastResult;
    this.draft = cloned.draft ? [...cloned.draft] : null;
    this.draftMulliganUsed =
      cloned.draftMulliganUsed === true || cloned.extras.draftMulliganUsed === true;
    this.shop = cloned.shop;
    this.diagnosis = cloned.diagnosis;
    this.sprintsPlayed = cloned.sprintsPlayed;
    this.totals = { ...cloned.totals };
    this.quarterTotals = { ...cloned.quarterTotals };
    this.usedHeavyActions = cloned.usedHeavyActions;
    this.quarterNumber = cloned.quarterNumber;
    this.quarterGoal = { ...cloned.quarterGoal };
    this.stakeholderTrust = { ...cloned.stakeholderTrust };
    this.quarterReview = cloned.quarterReview;
    this.goalAdjustmentsTaken = [...cloned.goalAdjustmentsTaken];
    this.reviewHistory = [...cloned.reviewHistory];
    this.zoom = { ...cloned.zoom };
    this.rankingKind = cloned.rankingKind;
    this.orgAdjust = structuredClone(cloned.extras.orgAdjust);
    if (!this.orgAdjust.byTeam) this.orgAdjust.byTeam = {};
    const legacyBaseConfig = cloned.extras.baseConfig;
    const hadAiDependencyPerTask = legacyBaseConfig.aiDependencyPerTask !== undefined;
    this.baseConfig = { ...legacyBaseConfig };
    // RI-74: 旧セーブ（係数未保存）も現行難易度定義の上昇量へ補完する。
    this.applyDifficultyAiDependencyPerTask();
    this.nextBudgetCap = cloned.extras.nextBudgetCap;
    // RI-83: 本体 → extras → legacy pauseAiDebuffQuarter の順で復元する。
    const topCarryoverQuarter = cloned.goalCarryoverQuarter ?? null;
    const topCarryoverId = cloned.goalCarryoverId ?? null;
    const extrasCarryoverQuarter = cloned.extras.goalCarryoverQuarter ?? null;
    const extrasCarryoverId = cloned.extras.goalCarryoverId ?? null;
    if (topCarryoverQuarter != null && topCarryoverId != null) {
      this.goalCarryoverQuarter = topCarryoverQuarter;
      this.goalCarryoverId = topCarryoverId;
    } else if (extrasCarryoverQuarter != null && extrasCarryoverId != null) {
      this.goalCarryoverQuarter = extrasCarryoverQuarter;
      this.goalCarryoverId = extrasCarryoverId;
    } else if (cloned.extras.pauseAiDebuffQuarter != null) {
      this.goalCarryoverQuarter = cloned.extras.pauseAiDebuffQuarter;
      this.goalCarryoverId = 'pause_ai_rollout';
    } else {
      this.goalCarryoverQuarter = null;
      this.goalCarryoverId = null;
    }
    this.winEvalOrg = cloned.extras.winEvalOrg ? structuredClone(cloned.extras.winEvalOrg) : null;
    if (this.winEvalOrg) {
      this.winEvalOrg.securityLevel = options.normalizeSecurityLevel
        ? clamp(
            typeof this.winEvalOrg.securityLevel === 'number'
              ? this.winEvalOrg.securityLevel
              : this.winEvalOrg.quality,
            PROCESS_BALANCE.securityLevelMinimum.value,
            PROCESS_BALANCE.securityLevelMaximum.value,
          )
        : typeof this.winEvalOrg.securityLevel === 'number'
          ? this.winEvalOrg.securityLevel
          : this.winEvalOrg.quality;
    }
    this.allowedCards = new Set(cloned.extras.allowedCards);
    this.allowedRelics = new Set(cloned.extras.allowedRelics);
    this.preferredCards = Array.isArray(cloned.extras.preferredCardIds)
      ? new Set(cloned.extras.preferredCardIds)
      : new Set();
    // RI-64: チーム状態（旧セーブは seed から補完）。
    if (Array.isArray(cloned.extras.teams) && cloned.extras.teams.length > 0) {
      this.teams = structuredClone(cloned.extras.teams);
      this.teams = this.teams.map((t) => {
        const next = {
          ...t,
          securityLevel: options.normalizeSecurityLevel
            ? clamp(
                typeof t.securityLevel === 'number' ? t.securityLevel : t.quality,
                PROCESS_BALANCE.securityLevelMinimum.value,
                PROCESS_BALANCE.securityLevelMaximum.value,
              )
            : typeof t.securityLevel === 'number'
              ? t.securityLevel
              : t.quality,
        };
        return options.recomputeTeamCapacities ? { ...next, ...deriveTeamCapacities(next) } : next;
      });
      this.activeTeamId = cloned.extras.activeTeamId ?? HOME_TEAM_ID;
      this.homeTeamId = cloned.extras.homeTeamId ?? HOME_TEAM_ID;
      this.teamLockUntilSprint = cloned.extras.teamLockUntilSprint ?? 0;
      this.teamRosters = cloned.extras.teamRosters
        ? structuredClone(cloned.extras.teamRosters)
        : { [this.activeTeamId]: structuredClone(this.roster) };
      // 四半期内の粗粒度炎上累積を復元（旧セーブ欠落時は 0）。
      this.coarseIncidentCarry = Math.max(0, cloned.extras.coarseIncidentCarry ?? 0);
      this.coarseSecurityTrustRaw = Math.max(0, cloned.extras.coarseSecurityTrustRaw ?? 0);
      this.coarseSecurityTrustCount = Math.max(0, cloned.extras.coarseSecurityTrustCount ?? 0);
      this.coarseSecurityTrustAppliedDelta =
        typeof cloned.extras.coarseSecurityTrustAppliedDelta === 'number'
          ? Math.min(0, cloned.extras.coarseSecurityTrustAppliedDelta)
          : typeof cloned.extras.coarseSecurityTrustAppliedRaw === 'number'
            ? legacySecurityCustomerTrustFromRaw(
                Math.min(
                  this.coarseSecurityTrustRaw,
                  Math.max(0, cloned.extras.coarseSecurityTrustAppliedRaw),
                ),
              )
            : legacySecurityCustomerTrustFromRaw(this.coarseSecurityTrustRaw);
      if (options.reconcileCoarseSecurityTrust) this.reconcileCoarseSecurityTrust();
    } else {
      // v1 セーブ: チーム配列が無いので初期化し、累積 orgAdjust を正本へ焼き込んでから strip。
      this.homeTeamId = HOME_TEAM_ID;
      this.activeTeamId = HOME_TEAM_ID;
      this.teamLockUntilSprint = 0;
      // 旧形式に現在行列は無い。ピーク累計をバックログへ昇格させると再開直後に
      // 処理済みの大量 Review が再投入されるため、行列は 0 から始める。
      // 未鎮火炎上（発生−鎮火）だけ初期圧力として引き継ぐ。
      this.teams = initTeamRunStates({
        seed: this.seed,
        org: this.org,
        homeEngineers: activeEngineerCount(this.roster),
        homeReviewQueue: 0,
        homeIncidents: Math.max(0, this.totals.incidents - this.totals.contained),
      });
      // v1 には粗粒度累積が無い。
      this.coarseIncidentCarry = 0;
      this.coarseSecurityTrustRaw = 0;
      this.coarseSecurityTrustCount = 0;
      this.coarseSecurityTrustAppliedDelta = 0;
      // v1 の出荷正本は org.deliveryScore。totals.delivered へ写経し報酬分岐を防ぐ。
      this.totals.delivered = Math.max(0, Math.round(this.org.deliveryScore));
      this.teamRosters = { [this.homeTeamId]: structuredClone(this.roster) };
      this.syncActiveTeamFromOrg();
      // レガシー baseline を既存チームへ先に移行してから追加チームを継承する。
      this.deck = migrateBaselineAppliedByTeam(
        this.deck,
        this.teams.map((t) => t.id),
      );
      // 購入済み extraTeams を永続配列へ復元（applyEffectToTeam は extraTeams を扱わない）。
      const extraTeams = Math.max(0, Math.round(this.orgAdjust.company.extraTeams));
      if (extraTeams > 0) {
        const template =
          this.teams.find((t) => t.id === this.homeTeamId) ??
          this.teams[0] ??
          initTeamRunStates({
            seed: this.seed,
            org: this.org,
            homeEngineers: activeEngineerCount(this.roster),
          })[0];
        const productCount = this.teams.filter((t) => t.deptId === 'product').length;
        const beforeIds = new Set(this.teams.map((t) => t.id));
        this.teams = appendTeamsToDept(this.teams, {
          seed: this.seed,
          deptId: 'product',
          count: extraTeams,
          template,
          nextIndexStart: productCount,
        });
        const newIds = this.teams.filter((t) => !beforeIds.has(t.id)).map((t) => t.id);
        this.deck = inheritBaselineAppliedForTeams(this.deck, this.homeTeamId, newIds);
      }
      this.teams = this.teams.map((t) => {
        const deptAdj = mergeAdjust(
          this.orgAdjust.company,
          this.orgAdjust.byDept[t.deptId] ?? emptyAdjust(),
        );
        return applyEffectToTeam(t, deptAdj);
      });
      const active = this.teams.find((t) => t.id === this.activeTeamId);
      if (active) this.org = orgFromTeam(active);
      this.orgAdjust = stripMetricAdjustments(this.orgAdjust);
    }
    // マップ無しのレガシー baseline だけ全チームへ移行する（部分マップは欠損補完しない）。
    this.deck = migrateBaselineAppliedByTeam(
      this.deck,
      this.teams.map((t) => t.id),
    );
    // RI-74: 未プレイの旧 Nightmare セーブ（初期依存 55）を現行初期値へ寄せる。
    // リプレイキーフレームでは記録値を改変しない。
    if (options.migrateLegacyAiDependency && !hadAiDependencyPerTask) {
      this.migrateLegacyNightmareAiDependencyBase();
    }
    this.whatIfCache = null;
  }

  /** 難易度定義の `aiDependencyPerTask` を baseConfig へ同期する（RI-74）。 */
  private applyDifficultyAiDependencyPerTask(): void {
    const perTask = getDifficulty(this.difficulty).aiDependencyPerTask;
    if (perTask !== undefined) {
      this.baseConfig.aiDependencyPerTask = perTask;
      return;
    }
    if ('aiDependencyPerTask' in this.baseConfig) {
      delete this.baseConfig.aiDependencyPerTask;
    }
  }

  /**
   * 旧 Nightmare 初期依存度（55）の未プレイセーブを現行初期値へ移行する（RI-74）。
   * 呼び出し側で係数欠落を確認済み。ホーム等値は見ない（setup 中のレバー焼き込みや
   * rival 進入で org / ホームが 55 以外になり得るため）。旧→新ベース差分を全チームへ適用し、
   * ライバルは旧 ±25 の高依存側だけを現行の低リテラシー上限へ抑える（下限は付けない。
   * レバー焼き込み済みの低依存を引き上げて施策効果を消さないため）。
   * 進行中ランは触らない。
   */
  private migrateLegacyNightmareAiDependencyBase(): void {
    if (this.difficulty !== 'nightmare') return;
    if (this.sprintsPlayed !== 0) return;
    if (this.phase !== 'setup') return;
    const nextBase = getDifficulty('nightmare').org.aiDependencyBase;
    const legacyBase = 55;
    const delta = nextBase - legacyBase;
    const rivalMax = nextBase + RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY;
    this.teams = this.teams.map((team) => {
      let aiDependency = Math.max(0, Math.min(100, team.aiDependency + delta));
      if (team.id !== this.homeTeamId) {
        aiDependency = Math.min(rivalMax, aiDependency);
      }
      return { ...team, aiDependency };
    });
    const active = this.teams.find((team) => team.id === this.activeTeamId);
    if (active) this.org = orgFromTeam(active);
  }

  /**
   * 実行中スプリント完了時点の全社 KPI 投影（盤面非破壊 / RI-89）。
   * 選択中チームは live org＋sprint metrics、非選択は `advanceOtherTeams` 相当の粗粒度進行を合成する。
   */
  previewLiveQuarterKpi(): { org: OrgState; totals: RunTotals } | null {
    if (this.phase !== 'sprint' || !this.sprint || !this.currentSprintId) return null;

    const before = this.teams;
    const fold = foldRunEffects({
      deck: this.deck,
      relics: this.relics,
      evolution: this.evolution,
      difficulty: this.difficulty,
      trials: this.trials,
      scenario: this.scenario,
    });
    const { assignedByTeamId, reviewersByTeamId } = this.coarseRosterShareMaps();
    const stepped = advanceCoarseTeams(this.teams, {
      seed: this.seed,
      stepKey: `sprint:${this.currentSprintId}`,
      excludeId: this.activeTeamId,
      adjust: this.orgAdjust,
      modifiers: this.coarseModifiersFromFold(fold),
      assignedByTeamId,
      reviewersByTeamId,
    });
    const delta = normalizeCoarseTotalsDelta(
      before,
      stepped.teams,
      this.activeTeamId,
      stepped.ignited,
      stepped.completed,
      stepped.aiAssisted,
      this.coarseIncidentCarry,
    );

    const projectedTeams = stepped.teams.map((t) =>
      t.id !== this.activeTeamId
        ? t
        : {
            ...t,
            quality: this.org.quality,
            techDebt: this.org.techDebt,
            aiDependency: this.org.aiDependency,
            aiLiteracy: this.org.aiLiteracy,
            testCoverage: this.org.testCoverage,
            documentation: this.org.documentation,
            securityLevel: this.org.securityLevel,
            morale: this.org.morale,
            seniorHp: this.org.seniorHp,
            aiEnabled: this.org.aiEnabled,
            shipping: this.org.deliveryScore,
          },
    );
    const org = companyOrgFromTeams(projectedTeams, this.org);
    const m = this.sprint.metrics;
    let reviewQueuePeak = Math.max(this.quarterTotals.reviewQueuePeak, m.reviewQueueMax);
    for (const team of before) {
      if (team.id === this.activeTeamId) continue;
      reviewQueuePeak = Math.max(reviewQueuePeak, team.reviewQueue);
    }
    for (const team of stepped.teams) {
      if (team.id === this.activeTeamId) continue;
      reviewQueuePeak = Math.max(reviewQueuePeak, team.reviewQueue);
    }
    const totals: RunTotals = {
      ...this.quarterTotals,
      delivered: this.quarterTotals.delivered + m.delivered + delta.delivered,
      done: this.quarterTotals.done + m.doneCount,
      rework: this.quarterTotals.rework + m.reworkCount,
      incidents: this.quarterTotals.incidents + m.incidentCount + delta.incidents,
      contained: this.quarterTotals.contained + m.contained,
      spread: this.quarterTotals.spread + m.spread,
      aiAssisted: this.quarterTotals.aiAssisted + m.aiAssistedCompleted + delta.aiAssisted,
      completed: this.quarterTotals.completed + m.completedCount + delta.completed,
      reviewQueuePeak,
      maxCombo: Math.max(this.quarterTotals.maxCombo, m.maxCombo),
    };
    return { org, totals };
  }

  /** スナップショット（独立コピー）。レンダラ・E2E はこれを読む。 */
  snapshot(): RunState {
    const orgScale = this.orgScaleForSnapshot();
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      trials: [...this.trials],
      scenario: this.scenario,
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
      pendingShopHandIndices: [...this.pendingShopHandIndices],
      org: structuredClone(this.org),
      deck: this.deck.map(cloneCardInstance),
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
      draftMulliganUsed: this.draftMulliganUsed,
      // 重い seed 掃引は whatIfPreview() / game.getState() 側で必要時のみ行う。
      whatIf: null,
      whatIfStatus: 'idle',
      shop: this.shop
        ? {
            cards: this.shop.cards.map((c) => ({ ...c })),
            relic: this.shop.relic ? { ...this.shop.relic } : undefined,
            recruit: this.shop.recruit ? { ...this.shop.recruit } : undefined,
            ...(this.shop.introSupportGranted ? { introSupportGranted: true } : {}),
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
      goalCarryoverQuarter: this.goalCarryoverQuarter,
      goalCarryoverId: this.goalCarryoverId,
      reviewHistory: [...this.reviewHistory],
      zoom: { ...this.zoom },
      rankingKind: this.rankingKind,
      orgScale,
      industry: this.industryForSnapshot(orgScale),
      teams: structuredClone(this.teams),
      activeTeamId: this.activeTeamId,
      homeTeamId: this.homeTeamId,
      teamLockUntilSprint: this.teamLockUntilSprint,
    };
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
