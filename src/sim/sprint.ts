/**
 * スプリントシミュレーション本体（SPEC 第3章のスプリント / 第4.1 / 第4.6）。
 *
 * Backlog → Coding → Review → Rework → Done をタスク粒が流れる固定タイムステップの
 * 状態機械。描画を一切知らず、乱数は引数の seed付きPRNG からのみ消費する（第22.3）。
 */
import { SPRINT_BALANCE, SPRINT_TASK_KIND_WEIGHTS } from '../data/balance';
import {
  AI_ADOPTION,
  AI_DEP_PER_TASK,
  BURNING_REGEN_MUL,
  BURNING_REVIEW_SLOWDOWN,
  BURN_TICKS,
  DEBT_PER_SPREAD,
  IDENTITY_CARD_EFFECTS,
  INCIDENT_HP_COST,
  MAX_REWORK,
  OVERTIME_CODING_MUL,
  OVERTIME_REVIEW_MUL,
  REVIEW_HP_COST,
  REVIEW_HP_REGEN,
  SPREAD_MORALE_COST,
  STABILITY_HIGH_VALUE_COMBO_THRESHOLD,
  STABILITY_HIGH_VALUE_MUL,
  STABILITY_REWORK_MUL,
  aiDeliveryValueMul,
  codingProgressPerTick,
  deliveryComboMultiplier,
  decideAiAssisted,
  incidentProbability,
  reviewPerTick,
  securityCustomerTrustSpreadRaw,
  securityFragility,
  securitySpreadMul,
  reworkProbability,
  reworkProgressPerTick,
  taskValue,
} from './model';
import type { Rng } from './rng';
import { getScenario } from './scenarios';
import { appendSprintEvent } from './sprintEvents';
import type {
  ActionId,
  CardEffects,
  IgniteSource,
  Lane,
  OrgState,
  ScenarioId,
  SprintConfig,
  SprintMetrics,
  SprintResult,
  SprintState,
  Task,
  TaskKind,
  TimelineSample,
} from './types';
import { clamp } from './clamp';

/** タスク規模の出現分布。抽選の累積判定順は `taskKindDistribution.entries` と同じ。 */
function taskKindForWeightId(id: string): TaskKind {
  if (id === SPRINT_TASK_KIND_WEIGHTS.routine.id) return 'routine';
  if (id === SPRINT_TASK_KIND_WEIGHTS.normal.id) return 'normal';
  if (id === SPRINT_TASK_KIND_WEIGHTS.complex.id) return 'complex';
  throw new Error(`未知のタスク種別重み ID: ${id}`);
}

const KIND_WEIGHTS: { kind: TaskKind; weight: number }[] =
  SPRINT_BALANCE.taskKindDistribution.entries.map((entry) => ({
    kind: taskKindForWeightId(entry.id),
    weight: entry.value,
  }));

/** 高価値タスクの出現率。 */
const HIGH_VALUE_RATE = SPRINT_BALANCE.highValueRate.value;

function rollKind(rng: Rng): TaskKind {
  const r = rng();
  let acc = 0;
  for (const { kind, weight } of KIND_WEIGHTS) {
    acc += weight;
    if (r < acc) return kind;
  }
  return 'normal';
}

function newTask(id: number, rng: Rng): Task {
  return {
    id,
    kind: rollKind(rng),
    highValue: rng() < HIGH_VALUE_RATE,
    aiAssisted: false,
    lane: 'backlog',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
  };
}

/** シナリオからスプリント構成を取り出す（個別上書きも可）。 */
export function resolveSprintConfig(
  scenario: ScenarioId,
  override?: Partial<SprintConfig>,
): SprintConfig {
  return { ...getScenario(scenario).sprint, ...override };
}

/**
 * 新しいスプリント状態を生成する（全タスクは Backlog から開始）。
 * `cardEffects` はデッキを畳み込んだ係数で、未指定（＝デッキ無し）なら
 * 無効果になる。集中力は満タンで開始する（第6.2）。
 * `aiAdoptionShare` は編成由来の実AI採用率の倍率（0..1）。未指定なら1。
 * `aiMasteryNorm` は AI 配布コーダーの平均習熟。Rework の W に使う。
 */
export function createSprint(
  config: SprintConfig,
  org: OrgState,
  rng: Rng,
  cardEffects: CardEffects = IDENTITY_CARD_EFFECTS,
  aiAdoptionShare = 1,
  aiMasteryNorm = 0,
): SprintState {
  const tasks: Task[] = [];
  for (let i = 0; i < config.taskCount; i += 1) {
    tasks.push(newTask(i, rng));
  }
  return {
    config,
    tasks,
    metrics: {
      delivered: 0,
      doneCount: 0,
      reworkCount: 0,
      incidentCount: 0,
      contained: 0,
      autoContainCount: 0,
      spread: 0,
      aiAssistedCompleted: 0,
      completedCount: 0,
      reviewQueueMax: 0,
      combo: 0,
      maxCombo: 0,
      seniorHpStart: org.seniorHp,
      interventionsUsed: 0,
      focusSpent: 0,
      actionCounts: {},
      stabilizingGrants: 0,
    },
    reviewAccumulator: 0,
    nextTaskId: config.taskCount,
    complete: false,
    focus: config.focusMax,
    cooldowns: {},
    modifiers: {
      andonUntilTick: 0,
      overtimeUntilTick: 0,
      throttleUntilTick: 0,
      stabilityUntilTick: 0,
    },
    comboGauge: 0,
    cardEffects,
    cardPiles: { drawOrder: [], hand: [], discard: [], played: [] },
    aiAdoption: clamp(AI_ADOPTION * aiAdoptionShare, 0, 1),
    aiMasteryNorm,
    events: [],
    interventionEvents: [],
    fireEvents: [],
    timeline: [],
  };
}

/** 現在の盤面からタイムライン 1 サンプルを作る（RI-53）。 */
function sampleTimeline(sprint: SprintState, org: OrgState, tick: number): TimelineSample {
  return {
    tick,
    reviewQueue: countLane(sprint.tasks, 'review'),
    burningCount: sprint.tasks.filter((t) => t.lane === 'rework' && t.incident).length,
    combo: sprint.metrics.combo,
    seniorHp: org.seniorHp,
  };
}

/** タイムラインへ 1 サンプルを append する。 */
function appendTimelineSample(sprint: SprintState, org: OrgState, tick: number): void {
  sprint.timeline.push(sampleTimeline(sprint, org, tick));
}

function countLane(tasks: Task[], lane: Lane): number {
  let n = 0;
  for (const t of tasks) if (t.lane === lane) n += 1;
  return n;
}

/** 残業号令が発動中か。 */
function isOvertime(sprint: SprintState, tick: number): boolean {
  return tick < sprint.modifiers.overtimeUntilTick;
}

/**
 * 介入後の短い安定期間か。安全側の介入だけが作るため、残業号令のような
 * 速度優先の手では乱数の下振れを打ち消さない。
 */
function isStabilized(sprint: SprintState, tick: number | undefined): boolean {
  return tick !== undefined && tick < sprint.modifiers.stabilityUntilTick;
}

/**
 * Backlog から Coding へ、WIP 上限まで引き込む。
 * アンドン発動中は流入を止め、AIスロットル発動中は AI を割り当てない（第6.1）。
 */
function intake(sprint: SprintState, org: OrgState, rng: Rng, tick: number): void {
  if (tick < sprint.modifiers.andonUntilTick) return;
  const throttled = tick < sprint.modifiers.throttleUntilTick;
  let coding = countLane(sprint.tasks, 'coding');
  for (const task of sprint.tasks) {
    if (coding >= sprint.config.codingSlots) break;
    if (task.lane !== 'backlog') continue;
    task.lane = 'coding';
    task.progress = 0;
    task.aiAssisted = throttled ? false : decideAiAssisted(org, rng, sprint.aiAdoption);
    if (task.aiAssisted) {
      const gain = sprint.config.aiDependencyPerTask ?? AI_DEP_PER_TASK;
      org.aiDependency = clamp(org.aiDependency + gain, 0, 100);
    }
    coding += 1;
  }
}

/** Coding を進め、完了したものを Review へ送る（残業中は加速）。 */
function advanceCoding(sprint: SprintState, tick: number): void {
  const boost = isOvertime(sprint, tick) ? OVERTIME_CODING_MUL : 1;
  for (const task of sprint.tasks) {
    if (task.lane !== 'coding') continue;
    task.progress += codingProgressPerTick(task, sprint.cardEffects) * boost;
    if (task.progress >= 1) {
      task.lane = 'review';
      task.progress = 0;
    }
  }
}

/**
 * タスクに点火する（炎上タイマー始動。第6.3）。
 * 燃えている間は Rework が進まず、タイマーが切れる前に緊急対応で鎮火するか、
 * 切れた時点で自動鎮火（シニアHP大量消費）/延焼のどちらかへ解決される。
 * Review 落ちの障害化と、延焼の連鎖（隣の PR への燃え移り）の両方から呼ばれる。
 * `tick` はイベントログ用（省略時は記録しない＝後方互換の単体テスト向け）。
 * `source` は「なぜ燃えたか」区別用（RI-34′。省略時は review）。
 */
export function igniteTask(
  task: Task,
  sprint: SprintState,
  tick?: number,
  source: IgniteSource = 'review',
): void {
  sprint.metrics.incidentCount += 1;
  task.incident = true;
  task.burnTicksLeft = BURN_TICKS;
  task.reworkAttempts += 1;
  task.lane = 'rework';
  task.progress = 0;
  if (tick !== undefined) {
    appendSprintEvent(sprint, { tick, kind: 'ignite', taskId: task.id, source });
  }
}

/**
 * Review を 1 件処理し、Done / Rework / Incident（点火）に振り分ける。
 * 介入アクション（割り込みレビュー等）からも呼ばれる（第6.1）。
 * 点火の時点ではコンボは途切れない——延焼または自動鎮火まで悪化したときに途切れる。
 * 「コンボを守るために今すぐ鎮火するか」という即時判断を作るため（第6.2 / 6.3）。
 * `tick` はイベントログ用（省略時は記録しない）。
 */
export function reviewOne(
  task: Task,
  sprint: SprintState,
  org: OrgState,
  rng: Rng,
  tick?: number,
): void {
  const m = sprint.metrics;
  // RI-73 / F-1: 難易度の seniorHpCostMul に加え、レビュアー人数由来の reviewHpCostMul を掛ける。
  const hpCostMul = sprint.cardEffects.seniorHpCostMul * sprint.cardEffects.reviewHpCostMul;
  org.seniorHp = clamp(org.seniorHp - REVIEW_HP_COST * hpCostMul, 0, 100);

  // 1) 障害（Incident）判定: 即決着ではなく点火し、猶予内の対応をプレイヤーに委ねる。
  const stabilized = isStabilized(sprint, tick);
  const reworkMul = stabilized ? STABILITY_REWORK_MUL : 1;
  if (rng() < incidentProbability(org, task, sprint.cardEffects)) {
    igniteTask(task, sprint, tick, 'review');
    return;
  }

  // 2) 手戻り判定（共有リスク + ワークフロー不足 / 工程ずれ。RI-134）
  if (
    task.reworkAttempts < MAX_REWORK &&
    rng() < reworkProbability(org, task, sprint.cardEffects, sprint.aiMasteryNorm) * reworkMul
  ) {
    m.reworkCount += 1;
    m.combo = 0;
    task.wasReworked = true;
    task.reworkAttempts += 1;
    task.lane = 'rework';
    task.progress = 0;
    if (tick !== undefined) {
      appendSprintEvent(sprint, {
        tick,
        kind: 'combo-break',
        reason: 'rework',
        taskId: task.id,
      });
    }
    return;
  }

  // 3) 出荷（Done）。コンボ（連続 Done）に応じた出荷倍率が掛かる（第6.2）。
  task.lane = 'done';
  task.incident = false;
  m.doneCount += 1;
  m.completedCount += 1;
  m.combo += 1;
  if (m.combo > m.maxCombo) m.maxCombo = m.combo;
  // 安定運用は大きな連続出荷ボーナスを積み上げず、着実な流れを選ぶ。
  // コンボ自体は維持し、出荷の上乗せだけを抑えることで安全側の介入が
  // スコアの上振れを増やすだけにならないようにする。
  const stableValue = stabilized
    ? taskValue(task) *
      (task.highValue && m.combo > STABILITY_HIGH_VALUE_COMBO_THRESHOLD
        ? STABILITY_HIGH_VALUE_MUL
        : 1)
    : taskValue(task);
  const value = Math.round(
    stableValue * deliveryComboMultiplier(m.combo, stabilized) * aiDeliveryValueMul(org, task),
  );
  m.delivered += value;
  org.deliveryScore += value;
  if (task.aiAssisted) m.aiAssistedCompleted += 1;
  org.morale = clamp(org.morale + SPRINT_BALANCE.completionMoraleGain.value, 0, 100);
}

/**
 * 施策などで Review を確実に出荷する（点火・手戻り判定なし）。
 * シニアHPは消費せず、コンボも伸ばさない（組織支援による一掃）。
 */
export function forceShipReviewTask(task: Task, sprint: SprintState, org: OrgState): void {
  if (task.lane !== 'review') return;
  const m = sprint.metrics;
  task.lane = 'done';
  task.incident = false;
  delete task.burnTicksLeft;
  m.doneCount += 1;
  m.completedCount += 1;
  const value = Math.round(taskValue(task) * aiDeliveryValueMul(org, task));
  m.delivered += value;
  org.deliveryScore += value;
  if (task.aiAssisted) m.aiAssistedCompleted += 1;
}

/**
 * Review をシニア体力に応じたスループットで処理する（残業中は加速）。
 * 火が燃えている間はシニアが火事対応に気を取られ、スループットが落ちる（第6.3）。
 */
function advanceReview(sprint: SprintState, org: OrgState, rng: Rng, tick: number): void {
  const boost = isOvertime(sprint, tick) ? OVERTIME_REVIEW_MUL : 1;
  const burning = sprint.tasks.some((t) => t.lane === 'rework' && t.incident);
  const distraction = burning ? BURNING_REVIEW_SLOWDOWN : 1;
  sprint.reviewAccumulator += reviewPerTick(org, sprint.cardEffects) * boost * distraction;
  while (sprint.reviewAccumulator >= 1) {
    const task = sprint.tasks.find((t) => t.lane === 'review');
    if (!task) {
      sprint.reviewAccumulator = 0;
      break;
    }
    sprint.reviewAccumulator -= 1;
    reviewOne(task, sprint, org, rng, tick);
  }
}

/**
 * 燃焼中タスクの炎上タイマーを進め、時間切れを解決する（第6.3）。
 * 猶予内に緊急対応しなかった火の後始末は高くつく:
 * - シニアに余力があれば自動鎮火（HP を大量消費し、コンボも途切れる）
 * - 余力がなければ延焼（負債・士気に波及し、Review 待ちの隣の PR へ燃え移る）
 */
function advanceBurning(sprint: SprintState, org: OrgState, tick: number): void {
  const m = sprint.metrics;
  // 先にタイマーだけ進めて時間切れを確定する（連鎖着火した火はこの tick では減らない）。
  const expired: Task[] = [];
  for (const task of sprint.tasks) {
    if (task.lane !== 'rework' || !task.incident || task.burnTicksLeft === undefined) continue;
    task.burnTicksLeft -= 1;
    if (task.burnTicksLeft <= 0) expired.push(task);
  }
  for (const task of expired) {
    task.incident = false;
    delete task.burnTicksLeft;
    const stabilized = isStabilized(sprint, tick);
    m.combo = 0;
    // 安定中は既知の復旧手順で延焼を止める。炎上時間と通常の手戻りは残すため、
    // 出荷を直接増やさずに下振れの連鎖だけを抑える。
    // RI-73: 鎮火可否は割引後コストと揃える（変更前は CONTAIN_HP == HP_COST == 12）。
    const incidentHpCost = INCIDENT_HP_COST * sprint.cardEffects.seniorHpCostMul;
    if (org.seniorHp >= incidentHpCost || stabilized) {
      // 自動鎮火: シニアが総出で消す。緊急対応より大幅に高くつく受動対応。
      m.contained += 1;
      m.autoContainCount += 1;
      const hpBefore = org.seniorHp;
      org.seniorHp = clamp(org.seniorHp - incidentHpCost, 0, 100);
      const hpCost = hpBefore - org.seniorHp;
      appendSprintEvent(sprint, {
        tick,
        kind: 'auto-contain',
        taskId: task.id,
        hpCost,
      });
      appendSprintEvent(sprint, {
        tick,
        kind: 'combo-break',
        reason: 'auto-contain',
        taskId: task.id,
      });
      continue;
    }
    // 延焼: 負債と士気に波及し、Review 待ちの先頭 PR へ燃え移る（延焼の連鎖。第18.2）。
    // RI-87: セキュリティ水準が低いほど延焼コストが増える。
    m.spread += 1;
    m.securityTrustSpreadRaw =
      (m.securityTrustSpreadRaw ?? 0) + securityCustomerTrustSpreadRaw(org.securityLevel);
    if (m.securityTrustIncidentFragility === undefined) {
      m.securityTrustIncidentFragility = securityFragility(org.securityLevel);
    }
    task.debt = true;
    const spreadMul = securitySpreadMul(org.securityLevel);
    org.techDebt += Math.ceil(DEBT_PER_SPREAD * spreadMul);
    org.morale = clamp(org.morale - Math.ceil(SPREAD_MORALE_COST * spreadMul), 0, 100);
    const next = sprint.tasks.find((t) => t.lane === 'review');
    appendSprintEvent(sprint, {
      tick,
      kind: 'spread',
      taskId: task.id,
      ...(next ? { spreadToTaskId: next.id } : {}),
    });
    appendSprintEvent(sprint, {
      tick,
      kind: 'combo-break',
      reason: 'spread',
      taskId: task.id,
    });
    if (next) igniteTask(next, sprint, tick, 'spread');
  }
}

/** Rework を進め、修正できたものを Review へ戻す。燃えている間は手が付けられない。 */
function advanceRework(sprint: SprintState): void {
  for (const task of sprint.tasks) {
    if (task.lane !== 'rework' || task.incident) continue;
    task.progress += reworkProgressPerTick();
    if (task.progress >= 1) {
      task.lane = 'review';
      task.progress = 0;
    }
  }
}

function isDrained(sprint: SprintState): boolean {
  return !sprint.tasks.some((t) => t.lane !== 'done');
}

/**
 * RI-75: minCompleteTick 待ち（盤面枯渇後のパディング）か。
 * 介入・カード・組織レバーは時間調整だけの区間で結果を書き換えない。
 * minCompleteTick 未設定の合成盤面では false（単体テスト互換）。
 */
export function isAwaitingMinCompleteTick(sprint: SprintState): boolean {
  if (sprint.complete) return false;
  const minTick = sprint.config.minCompleteTick ?? 0;
  if (minTick <= 0) return false;
  return isDrained(sprint);
}

/**
 * これ以上は永遠に進まない状態か。流入枠が 0（コーダー不在）で、稼働中の工程
 * （coding/review/rework）にタスクが 1 件も無ければ、Backlog は二度と流れない。
 */
function isStalled(sprint: SprintState): boolean {
  if (sprint.config.codingSlots > 0) return false;
  return !sprint.tasks.some(
    (t) => t.lane === 'coding' || t.lane === 'review' || t.lane === 'rework',
  );
}

function completeDrainedSprint(sprint: SprintState): void {
  if (sprint.complete) return;
  sprint.complete = true;
}

/**
 * stalled / maxTicks 到達時、未完了タスクを盤面から畳む。
 * 出荷・完了数は計上しない（未着手のまま畳む／時間切れの水増しを防ぐ。RI-75）。
 * 炎上中のタスクは鎮火扱い（autoContain）して畳む。
 */
function abandonInFlight(sprint: SprintState, tick: number): void {
  const m = sprint.metrics;
  for (const task of sprint.tasks) {
    if (task.lane === 'done') continue;
    if (task.incident) {
      m.contained += 1;
      m.autoContainCount += 1;
      delete task.burnTicksLeft;
      appendSprintEvent(sprint, {
        tick,
        kind: 'auto-contain',
        taskId: task.id,
        hpCost: 0,
      });
    }
    task.lane = 'done';
    task.incident = false;
  }
}

/**
 * スプリントを 1 固定ステップ進める。`sprint` と `org` を破壊的に更新する。
 * `tick` は無限ループ防止の上限判定にのみ使う。
 */
export function stepSprint(sprint: SprintState, org: OrgState, rng: Rng, tick: number): void {
  if (sprint.complete) return;

  // RI-75: 早期ドレイン後の下限待ちでは盤面副作用を止める（HP回復・工程進行など）。
  if (isDrained(sprint)) {
    const minTick = sprint.config.minCompleteTick ?? 0;
    if (tick >= minTick) completeDrainedSprint(sprint);
    appendTimelineSample(sprint, org, tick);
    return;
  }

  // 進行不能（コーダー不在で流入枠 0・稼働中タスクも無し）なら完了させる。
  // そうしないと Backlog が流れず isDrained も成立せず、maxTicks まで何も起きない画面を待つ。
  // RI-75: ただし絶対下限 tick 未満なら待機（空回り）し、短尺スプリントを防ぐ。
  if (isStalled(sprint)) {
    abandonInFlight(sprint, tick);
    const minTick = sprint.config.minCompleteTick ?? 0;
    if (tick >= minTick) sprint.complete = true;
    appendTimelineSample(sprint, org, tick);
    return;
  }

  intake(sprint, org, rng, tick);
  advanceCoding(sprint, tick);

  // 渋滞の指標: Review 待ち行列の最大長を記録（処理前に計測）。
  const reviewQueue = countLane(sprint.tasks, 'review');
  if (reviewQueue > sprint.metrics.reviewQueueMax) {
    sprint.metrics.reviewQueueMax = reviewQueue;
  }

  advanceReview(sprint, org, rng, tick);
  advanceBurning(sprint, org, tick);
  advanceRework(sprint);

  // シニア体力の自然回復。火が燃えている間は気が休まらず回復が鈍る（第6.3）。
  const anyBurning = sprint.tasks.some((t) => t.lane === 'rework' && t.incident);
  const regen = REVIEW_HP_REGEN * (anyBurning ? BURNING_REGEN_MUL : 1);
  org.seniorHp = clamp(org.seniorHp + regen, 0, 100);

  // 介入アクションのクールダウンを 1 tick 進める（第6.1）。
  tickCooldowns(sprint);

  if (isDrained(sprint)) {
    // RI-75: 早期ドレインでも §3.1 絶対下限（表示 tick）を下回らないよう待機する。
    const minTick = sprint.config.minCompleteTick ?? 0;
    if (tick >= minTick) completeDrainedSprint(sprint);
  } else if (tick >= sprint.config.maxTicks) {
    // RI-75: 時間切れは出荷なしで畳み、打ち切り印を付けてボス突破を失敗させる。
    abandonInFlight(sprint, tick);
    sprint.metrics.timedOut = true;
    sprint.complete = true;
  }

  appendTimelineSample(sprint, org, tick);
}

/** アクションごとの残りクールダウンを 1 tick 減らす（0 で Ready）。 */
function tickCooldowns(sprint: SprintState): void {
  for (const key of Object.keys(sprint.cooldowns) as ActionId[]) {
    const remaining = sprint.cooldowns[key] ?? 0;
    if (remaining > 0) sprint.cooldowns[key] = remaining - 1;
  }
}

/** AI 利用率（0..100）。 */
export function aiAssistedPct(metrics: SprintMetrics): number {
  if (metrics.completedCount === 0) return 0;
  return Math.round((metrics.aiAssistedCompleted / metrics.completedCount) * 100);
}

/** 健全比から評価ランクへ変換する境界（RI-80）。 */
const GRADE_THRESHOLDS = {
  S: SPRINT_BALANCE.gradeThresholdS.value,
  A: SPRINT_BALANCE.gradeThresholdA.value,
  B: SPRINT_BALANCE.gradeThresholdB.value,
  C: SPRINT_BALANCE.gradeThresholdC.value,
} as const;

/** 実際に運用安定を付与した介入1回あたりの運用判断ボーナス（RI-80）。 */
const STABILIZING_ACTION_BONUS = SPRINT_BALANCE.stabilizingBonusPerGrant.value;
/** 介入の連打だけでSにならないための上限。 */
const MAX_STABILIZING_ACTION_BONUS = SPRINT_BALANCE.stabilizingBonusCap.value;

/**
 * 評価（S/A/B/C/D）。出荷量を母数に、手戻り・障害・延焼・シニア消耗の
 * ペナルティを差し引いた「健全比」で段階化する。AI を雑に入れて渋滞・手戻りが
 * 増えると、出荷量が同じでも評価が下がる（本作のメッセージ。第2章）。
 */
export function computeGrade(sprint: SprintState, org: OrgState): string {
  const m = sprint.metrics;
  const hpLoss = m.seniorHpStart - org.seniorHp;
  const penalties =
    m.reworkCount * SPRINT_BALANCE.gradePenaltyRework.value +
    m.incidentCount * SPRINT_BALANCE.gradePenaltyIncident.value +
    m.spread * SPRINT_BALANCE.gradePenaltySpread.value +
    Math.max(0, hpLoss - SPRINT_BALANCE.gradePenaltyHpLossFree.value) *
      SPRINT_BALANCE.gradePenaltyHpLossMultiplier.value;
  const base = Math.max(1, m.delivered);
  const outcomeRatio = (m.delivered - penalties) / base;
  // 実際に運用安定を付与した介入だけを加点する（条件未成立の firefight/andon は除外。RI-73）。
  // 残業号令は速度優先の危険な手なので安定を付けず対象外。上限も設ける。
  const managementBonus = Math.min(
    MAX_STABILIZING_ACTION_BONUS,
    m.stabilizingGrants * STABILIZING_ACTION_BONUS,
  );
  const ratio = outcomeRatio + managementBonus;
  if (ratio >= GRADE_THRESHOLDS.S) return 'S';
  if (ratio >= GRADE_THRESHOLDS.A) return 'A';
  if (ratio >= GRADE_THRESHOLDS.B) return 'B';
  if (ratio >= GRADE_THRESHOLDS.C) return 'C';
  return 'D';
}

/** 称号と診断（SPEC 第4.6 の例から、結果メトリクスで分岐）。 */
export function computeTitleAndDiagnosis(
  sprint: SprintState,
  org: OrgState,
): { title: string; diagnosis: string } {
  const m = sprint.metrics;
  const hpLoss = m.seniorHpStart - org.seniorHp;
  const reworkRatio = m.completedCount > 0 ? m.reworkCount / m.completedCount : 0;
  const pct = aiAssistedPct(m);
  // 「AI を実際に使ったか」。編成で全コーダーの AI を外すと aiEnabled でも採用 0% になり、
  // その場合は AI 系の称号（健全な加速者 等）を出さない（診断が実態と逆にならないように）。
  const aiUsed = org.aiEnabled && pct > 0;

  // 重い崩壊から順に判定する。
  if (m.spread >= SPRINT_BALANCE.titleSpreadMinimum.value) {
    return {
      title: '静かな崩壊',
      diagnosis: '障害が鎮火しきれず延焼し、技術的負債として積み上がっています。',
    };
  }
  if (hpLoss >= SPRINT_BALANCE.titleSeniorBurnoutHpLoss.value) {
    return {
      title: 'シニア過労メーカー',
      diagnosis: 'レビュー負荷がシニアに集中しています。体力が尽きる前に分散を。',
    };
  }
  if (
    m.reviewQueueMax >= SPRINT_BALANCE.titleReviewHellQueueMax.value &&
    pct >= SPRINT_BALANCE.titleReviewHellAiPct.value
  ) {
    return {
      title: 'PRを増やす者',
      diagnosis: 'AIによって実装量は増えましたが、レビュー工程が限界を超えています。',
    };
  }
  if (reworkRatio >= SPRINT_BALANCE.titleReworkArtisanRatio.value) {
    return {
      title: 'Rework職人',
      diagnosis: '手戻りが多すぎます。AIの使い方とレビュー品質を見直しましょう。',
    };
  }
  // RI-73: 余裕のある先消し（brokeCombo）は危機対応に数えない。
  const urgentFirefights = sprint.fireEvents.filter(
    (e) => e.kind === 'contain' && !e.brokeCombo,
  ).length;
  if (
    urgentFirefights >= SPRINT_BALANCE.titleFirefighterContains.value &&
    m.incidentCount >= SPRINT_BALANCE.titleFirefighterIncidents.value &&
    m.spread === 0
  ) {
    return {
      title: '火消しの達人',
      diagnosis: '連続する炎上を、延焼する前にすべて自らの手で鎮火しました。見事な危機対応です。',
    };
  }
  if (aiUsed && m.incidentCount >= SPRINT_BALANCE.titleUnstableIncidents.value) {
    return {
      title: '爆速だが不安定',
      diagnosis: '実装は進みましたが、テストが追いつかず障害が頻発しています。',
    };
  }
  if (
    aiUsed &&
    m.reworkCount <= SPRINT_BALANCE.titleHealthyReworkMax.value &&
    m.incidentCount <= SPRINT_BALANCE.titleHealthyIncidentMax.value
  ) {
    return {
      title: '健全な加速者',
      diagnosis: 'AIの加速を、レビューと品質が受け止められています。理想的な導入です。',
    };
  }
  if (
    m.maxCombo >= SPRINT_BALANCE.titleComboMasterMin.value &&
    reworkRatio < SPRINT_BALANCE.titleComboMasterReworkMax.value
  ) {
    return {
      title: 'コンボ職人',
      diagnosis: '途切れない出荷でコンボを積み上げました。流れを支配しています。',
    };
  }
  if (
    !aiUsed &&
    hpLoss < SPRINT_BALANCE.titleNoOvertimeHpLossMax.value &&
    reworkRatio < SPRINT_BALANCE.titleNoOvertimeReworkMax.value &&
    m.incidentCount <= SPRINT_BALANCE.titleNoOvertimeIncidentMax.value
  ) {
    return {
      title: 'ノー残業の勇者',
      diagnosis: '無理のないペースで安定して出荷できています。',
    };
  }
  return {
    title: '見かけ上の生産性王',
    diagnosis: '数字は出ていますが、負債や手戻りが静かに積み上がっています。',
  };
}

/** スプリント状態から最終リザルトを集計する（途中経過の表示にも使える）。 */
export function summarizeSprint(sprint: SprintState, org: OrgState): SprintResult {
  const m = sprint.metrics;
  const { title, diagnosis } = computeTitleAndDiagnosis(sprint, org);
  return {
    done: m.doneCount,
    delivered: m.delivered,
    maxCombo: m.maxCombo,
    aiAssistedPct: aiAssistedPct(m),
    reviewQueueMax: m.reviewQueueMax,
    rework: m.reworkCount,
    incidents: m.incidentCount,
    contained: m.contained,
    spread: m.spread,
    seniorHpDelta: Math.round(org.seniorHp - m.seniorHpStart),
    actionCounts: { ...m.actionCounts },
    grade: computeGrade(sprint, org),
    title,
    diagnosis,
    timeline: sprint.timeline.map((s) => ({ ...s })),
    events: sprint.interventionEvents.map((e) => ({ ...e, effect: { ...e.effect } })),
    fireEvents: sprint.fireEvents.map((e) => ({ ...e })),
    focusRemaining: sprint.focus,
    focusMax: sprint.config.focusMax,
    autoContainCount: m.autoContainCount,
    ...(m.timedOut ? { timedOut: true as const } : {}),
  };
}
