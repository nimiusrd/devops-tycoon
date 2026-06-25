/**
 * ラン（1四半期）オーケストレーター（SPEC 第3章 / 第4.4〜4.6 / 第8〜17章）。
 *
 * Phase 2 のスプリント純関数（createSprint/stepSprint/applyAction/summarizeSprint）を
 * 再利用し、その上にローグライクの入れ子——マップ → スプリント → リザルト →
 * ドラフト → 進化——とイベント/ショップ/休息/ボス/勝敗/診断を載せた決定論エンジン。
 * 乱数はノード単位で派生 seed から引くため、辿る順に依らずノード内容が安定する（第22.3）。
 * `org` はラン中を通じて持続し、各スプリントの消耗が次へ引き継がれる。
 */
import { BOSS_DEFS, getBoss } from '../../data/bosses';
import { getCard } from '../../data/cards';
import { DEPARTMENT_DEFS } from '../../data/departments';
import { getDifficulty, getTrial } from '../../data/difficulties';
import { EVENT_DEFS, getEvent } from '../../data/events';
import { getEvolutionNode } from '../../data/evolution';
import { RELIC_DEFS, getRelic } from '../../data/relics';
import { applyAction } from '../actions';
import { applyDeckBaseline, combineEffects, drawDraft, scaleEffects, upgradeCard } from '../cards';
import { diagnose } from '../diagnosis';
import {
  applySprintGrowth,
  assignMember,
  canRecruit,
  createInitialRoster,
  foldFormationEffects,
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
import { resolveSprintConfig, createSprint, stepSprint, summarizeSprint } from '../sprint';
import type {
  ActionId,
  CardEffects,
  InterventionOutcome,
  OrgState,
  SprintConfig,
  SprintResult,
  SprintState,
} from '../types';
import { applyLever, emptyAdjustState, generateIndustry, generateOrgScale } from '../orgscale';
import type {
  IndustryState,
  OrgAdjustState,
  OrgScaleState,
  RankingKind,
  ZoomLevel,
  ZoomState,
} from '../orgscale/types';
import { foldPassives, foldRunEffects, toEffects, withBossEffects } from './effects';
import { applyEventOutcome } from './events';
import { canUnlock, unlockNode } from './evolution';
import { firstColumnNodes, generateRunMap, nodeById } from './map';
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
import type {
  DifficultyId,
  EvolutionState,
  GoalAdjustmentId,
  LoseReason,
  MapNode,
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunMap,
  RunState,
  RunStatus,
  RunTotals,
  RunKind,
  ShopOffer,
  StakeholderTrust,
  StartRunOptions,
  WinType,
} from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 高負荷（elite）スプリントのタスク量倍率。 */
const ELITE_TASK_MUL = 1.6;
/**
 * スプリント間のギャップでシニア体力が回復する割合（満タンまでの差分に対して）。
 * 1 回の過負荷は尾を引くが、持続的な過負荷だけが燃え尽きへ至るようにする緩衝。
 */
const BETWEEN_SPRINT_RECOVERY = 0.5;
/** 休息（heal）でのシニア体力回復量。 */
const REST_HEAL = 40;
/** 休息（repay）での技術的負債返済量。 */
const REST_REPAY = 30;
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
  };
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

  private map!: RunMap;
  private bossId!: string;
  private baseConfig!: SprintConfig;

  private org!: OrgState;
  private deck: { defId: string; level: number }[] = [];
  private relics: string[] = [];
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

  private position: string | null = null;
  private visited: string[] = [];
  private available: string[] = [];

  private activeNodeId: string | null = null;
  private sprint: SprintState | null = null;
  private sprintRng = createRng('init');
  private sprintTick = 0;
  private accumulatorMs = 0;
  private lastResult: SprintResult | null = null;
  private draft: string[] | null = null;
  private eventId: string | null = null;
  private shop: ShopOffer | null = null;

  private diagnosis: RunState['diagnosis'] = 'healthyAcceleration';
  private sprintsPlayed = 0;
  private totals: RunTotals = emptyTotals();
  private usedHeavyActions = false;

  // 組織スケール（MVP5 / 第4.7〜4.11）。ズーム状態とレバー蓄積を持つ。
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
  private pauseAiDebuff = false;

  constructor(init: RunEngineInit = {}) {
    this.seed = init.seed ?? DEFAULT_SEED;
    this.difficulty = init.difficulty ?? 'normal';
    this.trials = init.trials ?? [];
    this.allowedCards = init.allowedCards ?? null;
    this.allowedRelics = init.allowedRelics ?? null;
    this.initRun();
    this.phase = 'title';
  }

  /** ラン開始時点の解放プールを設定する（ラン中は固定）。 */
  setUnlockedContent(cards: ReadonlySet<string>, relics: ReadonlySet<string>): void {
    this.allowedCards = cards;
    this.allowedRelics = relics;
  }

  /** タイトルで選んだ難易度・試練でランを開始する（phase=map）。 */
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
    this.phase = 'map';
  }

  /** タイトル画面へ戻る（新しいランの難易度選択へ）。 */
  toTitle(seed?: string): void {
    if (seed !== undefined) this.seed = seed;
    this.initRun();
    this.phase = 'title';
  }

  /** 内部状態をランの初期状態へ戻す（マップ・組織・予算・進化を作り直す）。 */
  private initRun(): void {
    this.quarterNumber = 1;
    this.map = generateRunMap(createRng(`${this.seed}:map:q1`));
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
    this.pauseAiDebuff = false;
    this.position = null;
    this.visited = [];
    this.available = firstColumnNodes(this.map);
    this.activeNodeId = null;
    this.sprint = null;
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.lastResult = null;
    this.draft = null;
    this.eventId = null;
    this.shop = null;
    this.diagnosis = 'healthyAcceleration';
    this.sprintsPlayed = 0;
    this.totals = emptyTotals();
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

  /** マップ上のノードへ進入する。種別に応じてスプリント/イベント/ショップ/休息へ。 */
  enterNode(id: string): void {
    if (this.phase !== 'map') return;
    if (!this.available.includes(id)) return;
    const node = nodeById(this.map, id);
    if (!node) return;
    this.position = id;
    this.visited.push(id);
    switch (node.type) {
      case 'normal':
      case 'elite':
      case 'boss':
        this.beginSprint(node);
        break;
      case 'event':
        this.eventId = this.pickEvent(node);
        this.phase = 'event';
        break;
      case 'shop':
        this.shop = this.buildShop(node);
        this.phase = 'shop';
        break;
      case 'rest':
        this.phase = 'rest';
        break;
    }
  }

  private beginSprint(node: MapNode): void {
    // スプリント間のギャップでシニア体力が一部回復する（持続的な過負荷のみ燃え尽きへ）。
    this.org.seniorHp = clamp(
      this.org.seniorHp + (100 - this.org.seniorHp) * BETWEEN_SPRINT_RECOVERY,
      0,
      100,
    );
    const isBoss = node.type === 'boss';
    const fold = foldRunEffects({
      deck: this.deck,
      relics: this.relics,
      evolution: this.evolution,
      difficulty: this.difficulty,
      trials: this.trials,
    });
    // 編成（個体メンバーのレーン配置・AI 配布）を係数へ畳み込み、デッキ等と合成する。
    const formation = foldFormationEffects(this.roster);
    let effects = combineEffects(fold.effects, toEffects(formation.effects));
    if (isBoss) effects = withBossEffects(effects, this.bossId);
    if (this.pauseAiDebuff) {
      effects = {
        ...effects,
        codingSpeedMul: effects.codingSpeedMul * 0.85,
        routineSpeedMul: effects.routineSpeedMul * 0.85,
      };
    }
    const mul =
      node.type === 'elite'
        ? ELITE_TASK_MUL
        : isBoss
          ? (getBoss(this.bossId)?.taskCountMul ?? 1)
          : 1;
    const config: SprintConfig = {
      ...this.baseConfig,
      taskCount: Math.max(4, Math.round(this.baseConfig.taskCount * mul)),
      focusMax: Math.max(1, this.baseConfig.focusMax + fold.focusBonus + formation.focusBonus),
      // コーダー不在（formation が大きな負値を返す）なら 0 枠まで落とし、流入を止める。
      codingSlots: Math.max(
        0,
        this.baseConfig.codingSlots + fold.codingSlotBonus + formation.codingSlotBonus,
      ),
    };
    this.sprintRng = createRng(`${this.seed}:sprint:${node.id}`);
    this.sprintTick = 0;
    this.accumulatorMs = 0;
    this.sprint = createSprint(
      config,
      this.org,
      this.sprintRng,
      effects,
      formation.aiAdoptionShare,
    );
    this.activeNodeId = node.id;
    this.phase = 'sprint';
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
  dispatch(id: ActionId): InterventionOutcome {
    if (this.phase !== 'sprint' || !this.sprint) return { ok: false, reason: 'complete' };
    const outcome = applyAction(id, this.sprint, this.org, this.sprintRng, this.sprintTick);
    if (outcome.ok && (id === 'overtime' || id === 'andon')) this.usedHeavyActions = true;
    return outcome;
  }

  /** スプリント完了時の集計・診断・勝敗判定・進化ポイント付与。 */
  private resolveSprint(): void {
    if (!this.sprint || !this.activeNodeId) return;
    const result = summarizeSprint(this.sprint, this.org);
    this.lastResult = result;
    this.sprintsPlayed += 1;
    this.accumulateTotals(result);
    this.applyGrowth(result);
    // スプリント終了時に個体スタミナを一部回復する（休職者は復帰しうる）。
    // ここで回復させることで、続くマップ／編成ウィンドウで復帰メンバーをすぐ再配置できる
    // （beginSprint で回復すると次スプリント開始後＝編成ロック後になり 1 スプリント遅れる）。
    // ただし、このスプリントで休職入りした直後の者は除外し、即復帰させない（休職に実コストを残す）。
    const justLeft = new Set((this.lastGrowth?.wentOnLeave ?? []).map((w) => w.id));
    this.roster = recoverStamina(this.roster, STAMINA_RECOVER_BETWEEN, justLeft);
    this.diagnosis = diagnose(this.org, this.totals);

    const node = nodeById(this.map, this.activeNodeId);
    if (node?.type === 'boss') {
      const boss = getBoss(this.bossId);
      const bossTargetMul = getDifficulty(this.difficulty).bossTargetMul;
      const cleared =
        !!boss &&
        evaluateBoss({
          boss,
          result,
          org: this.org,
          bossTargetMul,
        });
      this.quarterReview = buildQuarterReview({
        goal: this.quarterGoal,
        bossCleared: cleared,
        org: this.org,
        totals: this.totals,
        trust: this.stakeholderTrust,
        budget: this.budget,
        quarterNumber: this.quarterNumber,
        lastResult: result,
      });
      this.reviewHistory = [...this.reviewHistory, this.quarterReview.outcome];
      this.phase = 'quarterReview';
      return;
    }

    const lose = evaluateLose(this.org, this.totals);
    if (lose) {
      this.status = 'lost';
      this.loseReason = lose;
      this.phase = 'lost';
      return;
    }

    this.evolution = {
      ...this.evolution,
      points: this.evolution.points + this.evoPointsFor(node, result),
    };
    this.phase = 'result';
  }

  private accumulateTotals(result: SprintResult): void {
    if (!this.sprint) return;
    const m = this.sprint.metrics;
    const t = this.totals;
    t.delivered += result.delivered;
    t.done += result.done;
    t.rework += result.rework;
    t.incidents += result.incidents;
    t.contained += result.contained;
    t.spread += result.spread;
    t.aiAssisted += m.aiAssistedCompleted;
    t.completed += m.completedCount;
    t.reviewQueuePeak = Math.max(t.reviewQueuePeak, result.reviewQueueMax);
    t.maxCombo = Math.max(t.maxCombo, result.maxCombo);
  }

  /**
   * スプリント後の個体成長・消耗・離脱を適用する（第12.2）。
   * 配置された稼働メンバーが経験値を得て昇格し、スタミナを消費して休職しうる。
   * ドキュメント魔などが積んだドキュメントを組織へ反映する。乱数はノード単位で派生。
   */
  private applyGrowth(result: SprintResult): void {
    if (!this.sprint || !this.activeNodeId) return;
    const rng = createRng(`${this.seed}:growth:${this.activeNodeId}`);
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

  private evoPointsFor(node: MapNode | undefined, result: SprintResult): number {
    const base = 1 + Math.floor(result.delivered / 40);
    return node?.type === 'elite' ? base + 1 : base;
  }

  /** 四半期レビューを承認する（達成→won / 継続不能→lost）。 */
  acknowledgeQuarterReview(): void {
    if (this.phase !== 'quarterReview' || !this.quarterReview) return;
    const { outcome } = this.quarterReview;
    if (canAcknowledgeWin(outcome)) {
      this.status = 'won';
      this.winType = evaluateWinType({
        org: this.org,
        totals: this.totals,
        budget: this.budget,
        usedHeavyActions: this.usedHeavyActions,
      });
      this.phase = 'won';
      return;
    }
    if (isTerminalFailure(outcome)) {
      this.status = 'lost';
      this.loseReason = loseReasonForOutcome(outcome);
      this.phase = 'lost';
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
    if (applied.pauseAiDebuff) this.pauseAiDebuff = true;

    if (id === 'reorg_teams') {
      this.applyReorgDeparture();
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

  /** 次四半期を開始する（マップ再生成・組織状態は引き継ぎ）。 */
  private startNextQuarter(): void {
    this.quarterNumber += 1;
    this.map = generateRunMap(createRng(`${this.seed}:map:q${this.quarterNumber}`));
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
    }
    if (this.goalAdjustmentsTaken.includes('cut_scope')) {
      this.quarterGoal.deliveryTarget = Math.max(
        15,
        Math.round(this.quarterGoal.deliveryTarget * 0.9),
      );
    }

    this.position = null;
    this.visited = [];
    this.available = firstColumnNodes(this.map);
    this.activeNodeId = null;
    this.sprint = null;
    this.lastResult = null;
    this.draft = null;
    this.eventId = null;
    this.shop = null;
    this.quarterReview = null;
    this.zoom = { level: 'team', deptId: null, teamId: null };
    this.phase = 'map';
  }

  /** リザルトを確認してドラフトへ進む。 */
  acknowledgeResult(): void {
    if (this.phase !== 'result') return;
    this.draft = drawDraft(
      createRng(`${this.seed}:draft:${this.sprintsPlayed}`),
      3,
      this.allowedCards ?? undefined,
    );
    this.phase = 'draft';
  }

  /** ドラフトでカードを選びデッキに加える（加算系の効果は即時に組織へ反映）。 */
  chooseCard(defId: string): void {
    if (this.phase !== 'draft') return;
    this.addCard(defId, 1);
    this.draft = null;
    this.phase = 'evolution';
  }

  /** ドラフトをスキップする。 */
  skipDraft(): void {
    if (this.phase !== 'draft') return;
    this.draft = null;
    this.phase = 'evolution';
  }

  /** 進化ノードを解放する（加算系効果は即時反映。phase は evolution のまま）。 */
  unlockEvolution(id: string): void {
    if (this.phase !== 'evolution') return;
    if (!canUnlock(this.evolution, id)) return;
    const node = getEvolutionNodeEffects(id);
    if (node) applyDeckBaseline(this.org, toEffects(node));
    this.evolution = unlockNode(this.evolution, id);
  }

  /** 進化フェーズを終え、マップへ戻る（次の分岐を提示）。 */
  finishEvolution(): void {
    if (this.phase !== 'evolution') return;
    this.advanceMap();
  }

  // --- イベント ---

  private pickEvent(node: MapNode): string {
    const rng = createRng(`${this.seed}:event:${node.id}`);
    const list = eventIds();
    return list[Math.floor(rng() * list.length)];
  }

  /** イベントの選択肢を選び、効果を適用してマップへ戻る。 */
  chooseEvent(choiceIndex: number): void {
    if (this.phase !== 'event' || !this.eventId) return;
    const ev = getEvent(this.eventId);
    const choice = ev?.choices[choiceIndex];
    if (!ev || !choice) return;
    const res = applyEventOutcome(choice.outcome, this.org, foldPassives(this.relics));
    this.budget = Math.max(0, this.budget + res.budgetDelta);
    if (res.grantRelic) this.grantRelic(res.grantRelic);
    if (res.grantCard) this.addCard(res.grantCard, 1);
    this.eventId = null;
    const lose = evaluateLose(this.org, this.totals);
    if (lose) {
      this.status = 'lost';
      this.loseReason = lose;
      this.phase = 'lost';
      return;
    }
    this.advanceMap();
  }

  // --- ショップ ---

  private buildShop(node: MapNode): ShopOffer {
    const rng = createRng(`${this.seed}:shop:${node.id}`);
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
    return { cards, relic };
  }

  /** 未所持レリックを 1 つ提示（無ければ undefined）。 */
  private offerRelic(rng: () => number): string | undefined {
    const pool = relicIds().filter(
      (id) => !this.relics.includes(id) && (!this.allowedRelics || this.allowedRelics.has(id)),
    );
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
  }

  /** ショップでレリックを購入する。 */
  buyShopRelic(): void {
    if (this.phase !== 'shop' || !this.shop?.relic || this.shop.relic.bought) return;
    const relic = this.shop.relic;
    if (this.budget < relic.cost) return;
    this.budget -= relic.cost;
    relic.bought = true;
    this.grantRelic(relic.id);
  }

  /** ショップを出てマップへ戻る。 */
  leaveShop(): void {
    if (this.phase !== 'shop') return;
    this.shop = null;
    this.advanceMap();
  }

  // --- 休息 ---

  /**
   * 休息の選択（heal: シニア+個体スタミナ回復 / repay: 負債返済 /
   * upgrade: カード強化 / recruit: 採用）。
   */
  restChoose(option: 'heal' | 'repay' | 'upgrade' | 'recruit'): void {
    if (this.phase !== 'rest') return;
    if (option === 'heal') {
      const bonus = foldPassives(this.relics).restHealBonus;
      this.org.seniorHp = clamp(this.org.seniorHp + REST_HEAL + bonus, 0, 100);
      this.org.morale = clamp(this.org.morale + 10, 0, 100);
      // 個体メンバーのスタミナも大きく回復し、休職者は復帰しやすくなる。
      this.roster = recoverStamina(this.roster, REST_STAMINA_RECOVER);
    } else if (option === 'repay') {
      this.org.techDebt = Math.max(0, this.org.techDebt - REST_REPAY);
    } else if (option === 'upgrade' && this.deck.length > 0) {
      this.deck = upgradeCard(this.deck, this.deck[0].defId);
    } else if (option === 'recruit') {
      // 採用は予算を消費する（ラン経済。SPEC 第4.4）。空き枠と予算が揃ったときのみ。
      if (canRecruit(this.roster) && this.budget >= RECRUIT_COST) {
        const rng = createRng(`${this.seed}:recruit:${this.position ?? 'rest'}`);
        const next = recruitMember(this.roster, pickRecruitArchetype(rng), rng);
        if (next !== this.roster) {
          this.roster = next;
          this.budget -= RECRUIT_COST;
        }
      }
    }
    this.advanceMap();
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

  /** カードをデッキへ加え、加算系（baseline）効果を即時に組織へ反映する。 */
  private addCard(defId: string, level: number): void {
    const def = getCard(defId);
    if (!def) return;
    this.deck.push({ defId, level });
    applyDeckBaseline(this.org, scaleEffects(def.base, level));
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

  /** 現在ノードの分岐を available に設定し、マップへ戻る。 */
  private advanceMap(): void {
    const node = this.position ? nodeById(this.map, this.position) : undefined;
    this.available = node ? node.next : [];
    this.activeNodeId = null;
    this.sprint = null;
    this.phase = 'map';
  }

  // --- 組織スケール / ズーム階層（MVP5 / 第4.7〜4.11） ---

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
    const res = applyLever(this.orgAdjust, this.budget, leverId, deptId);
    if (!res.changed) return false;
    this.orgAdjust = res.adjust;
    this.budget = res.budget;
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
      playerEngineers: this.roster.members.length,
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
      map: this.map,
      bossId: this.bossId,
      position: this.position,
      visited: [...this.visited],
      available: [...this.available],
      org: structuredClone(this.org),
      deck: this.deck.map((c) => ({ ...c })),
      relics: [...this.relics],
      evolution: { points: this.evolution.points, unlocked: { ...this.evolution.unlocked } },
      roster: structuredClone(this.roster),
      lastGrowth: this.lastGrowth ? structuredClone(this.lastGrowth) : null,
      budget: this.budget,
      activeNodeId: this.activeNodeId,
      sprint: this.sprint ? structuredClone(this.sprint) : null,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
      draft: this.draft ? [...this.draft] : null,
      eventId: this.eventId,
      shop: this.shop
        ? {
            cards: this.shop.cards.map((c) => ({ ...c })),
            relic: this.shop.relic ? { ...this.shop.relic } : undefined,
          }
        : null,
      diagnosis: this.diagnosis,
      sprintsPlayed: this.sprintsPlayed,
      totals: { ...this.totals },
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
}

export function createRunEngine(init?: RunEngineInit): RunEngine {
  return new RunEngine(init);
}

function eventIds(): string[] {
  return EVENT_DEFS.map((e) => e.id);
}
function relicIds(): string[] {
  return RELIC_DEFS.map((r) => r.id);
}
function getEvolutionNodeEffects(id: string): Partial<CardEffects> | undefined {
  return getEvolutionNode(id)?.effects;
}
