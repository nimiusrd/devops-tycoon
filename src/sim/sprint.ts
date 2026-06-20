/**
 * スプリントシミュレーション本体（SPEC 第3章のスプリント / 第4.1 / 第4.6）。
 *
 * Backlog → Coding → Review → Rework → Done をタスク粒が流れる固定タイムステップの
 * 状態機械。描画を一切知らず、乱数は引数の seed付きPRNG からのみ消費する（第22.3）。
 */
import {
  AI_ADOPTION,
  AI_DEP_PER_TASK,
  DEBT_PER_SPREAD,
  IDENTITY_CARD_EFFECTS,
  INCIDENT_CONTAIN_HP,
  INCIDENT_HP_COST,
  MAX_REWORK,
  OVERTIME_CODING_MUL,
  OVERTIME_REVIEW_MUL,
  REVIEW_HP_COST,
  REVIEW_HP_REGEN,
  codingProgressPerTick,
  comboMultiplier,
  decideAiAssisted,
  incidentProbability,
  reviewPerTick,
  reworkProbability,
  reworkProgressPerTick,
  taskValue,
} from './model';
import type { Rng } from './rng';
import { getScenario } from './scenarios';
import type {
  ActionId,
  CardEffects,
  Lane,
  OrgState,
  ScenarioId,
  SprintConfig,
  SprintMetrics,
  SprintResult,
  SprintState,
  Task,
  TaskKind,
} from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** タスク規模の出現分布（合計 1）。 */
const KIND_WEIGHTS: { kind: TaskKind; weight: number }[] = [
  { kind: 'routine', weight: 0.3 },
  { kind: 'normal', weight: 0.45 },
  { kind: 'complex', weight: 0.25 },
];

/** 高価値タスクの出現率。 */
const HIGH_VALUE_RATE = 0.12;

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
 * Phase 1 と完全に同一の数値挙動になる。集中力は満タンで開始する（第6.2）。
 * `aiAdoptionShare` は編成由来の実 AI 採用率の倍率（0..1）。未指定なら 1（＝従来の
 * 全社的な既定採用率）で、Phase 1〜3 と完全に同一の数値挙動になる（後方互換）。
 */
export function createSprint(
  config: SprintConfig,
  org: OrgState,
  rng: Rng,
  cardEffects: CardEffects = IDENTITY_CARD_EFFECTS,
  aiAdoptionShare = 1,
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
      spread: 0,
      aiAssistedCompleted: 0,
      completedCount: 0,
      reviewQueueMax: 0,
      combo: 0,
      maxCombo: 0,
      seniorHpStart: org.seniorHp,
      interventionsUsed: 0,
      focusSpent: 0,
    },
    reviewAccumulator: 0,
    nextTaskId: config.taskCount,
    complete: false,
    focus: config.focusMax,
    cooldowns: {},
    modifiers: { andonUntilTick: 0, overtimeUntilTick: 0, throttleUntilTick: 0 },
    comboGauge: 0,
    cardEffects,
    aiAdoption: clamp(AI_ADOPTION * aiAdoptionShare, 0, 1),
  };
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
      org.aiDependency = clamp(org.aiDependency + AI_DEP_PER_TASK, 0, 100);
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
 * Review を 1 件処理し、Done / Rework / Incident に振り分ける。
 * 介入アクション（割り込みレビュー等）からも呼ばれる（第6.1）。
 */
export function reviewOne(task: Task, sprint: SprintState, org: OrgState, rng: Rng): void {
  const m = sprint.metrics;
  org.seniorHp = clamp(org.seniorHp - REVIEW_HP_COST, 0, 100);

  // 1) 障害（Incident）判定
  if (rng() < incidentProbability(org, task, sprint.cardEffects)) {
    m.incidentCount += 1;
    m.combo = 0;
    task.incident = true;
    task.reworkAttempts += 1;
    task.lane = 'rework';
    task.progress = 0;
    if (org.seniorHp >= INCIDENT_CONTAIN_HP) {
      m.contained += 1;
      org.seniorHp = clamp(org.seniorHp - INCIDENT_HP_COST, 0, 100);
    } else {
      // 鎮火する体力がなく延焼。負債と士気に波及する。
      m.spread += 1;
      task.debt = true;
      org.techDebt += DEBT_PER_SPREAD;
      org.morale = clamp(org.morale - 5, 0, 100);
    }
    return;
  }

  // 2) 手戻り判定（AI依存度が高いほど増える。第22.5 の不変条件）
  if (
    task.reworkAttempts < MAX_REWORK &&
    rng() < reworkProbability(org, task, sprint.cardEffects)
  ) {
    m.reworkCount += 1;
    m.combo = 0;
    task.wasReworked = true;
    task.reworkAttempts += 1;
    task.lane = 'rework';
    task.progress = 0;
    return;
  }

  // 3) 出荷（Done）。コンボ（連続 Done）に応じた出荷倍率が掛かる（第6.2）。
  task.lane = 'done';
  task.incident = false;
  m.doneCount += 1;
  m.completedCount += 1;
  m.combo += 1;
  if (m.combo > m.maxCombo) m.maxCombo = m.combo;
  const value = Math.round(taskValue(task) * comboMultiplier(m.combo));
  m.delivered += value;
  org.deliveryScore += value;
  if (task.aiAssisted) m.aiAssistedCompleted += 1;
  org.morale = clamp(org.morale + 0.5, 0, 100);
}

/** Review をシニア体力に応じたスループットで処理する（残業中は加速）。 */
function advanceReview(sprint: SprintState, org: OrgState, rng: Rng, tick: number): void {
  const boost = isOvertime(sprint, tick) ? OVERTIME_REVIEW_MUL : 1;
  sprint.reviewAccumulator += reviewPerTick(org, sprint.cardEffects) * boost;
  while (sprint.reviewAccumulator >= 1) {
    const task = sprint.tasks.find((t) => t.lane === 'review');
    if (!task) {
      sprint.reviewAccumulator = 0;
      break;
    }
    sprint.reviewAccumulator -= 1;
    reviewOne(task, sprint, org, rng);
  }
}

/** Rework を進め、修正できたものを Review へ戻す。 */
function advanceRework(sprint: SprintState): void {
  for (const task of sprint.tasks) {
    if (task.lane !== 'rework') continue;
    task.progress += reworkProgressPerTick();
    if (task.progress >= 1) {
      task.lane = 'review';
      task.progress = 0;
      task.incident = false;
    }
  }
}

function isDrained(sprint: SprintState): boolean {
  return !sprint.tasks.some((t) => t.lane !== 'done');
}

/** 上限到達時、捌け残ったタスクを強制的に Done へ流す。 */
function forceDrain(sprint: SprintState, org: OrgState): void {
  const m = sprint.metrics;
  for (const task of sprint.tasks) {
    if (task.lane === 'done') continue;
    task.lane = 'done';
    task.incident = false;
    m.doneCount += 1;
    m.completedCount += 1;
    m.delivered += taskValue(task);
    org.deliveryScore += taskValue(task);
    if (task.aiAssisted) m.aiAssistedCompleted += 1;
  }
}

/**
 * スプリントを 1 固定ステップ進める。`sprint` と `org` を破壊的に更新する。
 * `tick` は無限ループ防止の上限判定にのみ使う。
 */
export function stepSprint(sprint: SprintState, org: OrgState, rng: Rng, tick: number): void {
  if (sprint.complete) return;

  intake(sprint, org, rng, tick);
  advanceCoding(sprint, tick);

  // 渋滞の指標: Review 待ち行列の最大長を記録（処理前に計測）。
  const reviewQueue = countLane(sprint.tasks, 'review');
  if (reviewQueue > sprint.metrics.reviewQueueMax) {
    sprint.metrics.reviewQueueMax = reviewQueue;
  }

  advanceReview(sprint, org, rng, tick);
  advanceRework(sprint);

  // シニア体力の自然回復。
  org.seniorHp = clamp(org.seniorHp + REVIEW_HP_REGEN, 0, 100);

  // 介入アクションのクールダウンを 1 tick 進める（第6.1）。
  tickCooldowns(sprint);

  if (isDrained(sprint)) {
    sprint.complete = true;
  } else if (tick >= sprint.config.maxTicks) {
    forceDrain(sprint, org);
    sprint.complete = true;
  }
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

/**
 * 評価（S/A/B/C/D）。出荷量を母数に、手戻り・障害・延焼・シニア消耗の
 * ペナルティを差し引いた「健全比」で段階化する。AI を雑に入れて渋滞・手戻りが
 * 増えると、出荷量が同じでも評価が下がる（本作のメッセージ。第2章）。
 */
export function computeGrade(sprint: SprintState, org: OrgState): string {
  const m = sprint.metrics;
  const hpLoss = m.seniorHpStart - org.seniorHp;
  const penalties =
    m.reworkCount * 5 + m.incidentCount * 6 + m.spread * 10 + Math.max(0, hpLoss - 20) * 0.7;
  const base = Math.max(1, m.delivered);
  const ratio = (m.delivered - penalties) / base;
  if (ratio >= 0.92) return 'S';
  if (ratio >= 0.8) return 'A';
  if (ratio >= 0.62) return 'B';
  if (ratio >= 0.4) return 'C';
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

  // 重い崩壊から順に判定する。
  if (m.spread >= 2) {
    return {
      title: '静かな崩壊',
      diagnosis: '障害が鎮火しきれず延焼し、技術的負債として積み上がっています。',
    };
  }
  if (hpLoss >= 55) {
    return {
      title: 'シニア過労メーカー',
      diagnosis: 'レビュー負荷がシニアに集中しています。体力が尽きる前に分散を。',
    };
  }
  if (m.reviewQueueMax >= 12 && pct >= 50) {
    return {
      title: 'PRを増やす者',
      diagnosis: 'AIによって実装量は増えましたが、レビュー工程が限界を超えています。',
    };
  }
  if (reworkRatio >= 0.35) {
    return {
      title: 'Rework職人',
      diagnosis: '手戻りが多すぎます。AIの使い方とレビュー品質を見直しましょう。',
    };
  }
  if (org.aiEnabled && m.incidentCount >= 3) {
    return {
      title: '爆速だが不安定',
      diagnosis: '実装は進みましたが、テストが追いつかず障害が頻発しています。',
    };
  }
  if (org.aiEnabled && m.reworkCount <= 2 && m.incidentCount <= 1) {
    return {
      title: '健全な加速者',
      diagnosis: 'AIの加速を、レビューと品質が受け止められています。理想的な導入です。',
    };
  }
  if (m.maxCombo >= 15 && reworkRatio < 0.15) {
    return {
      title: 'コンボ職人',
      diagnosis: '途切れない出荷でコンボを積み上げました。流れを支配しています。',
    };
  }
  if (!org.aiEnabled && hpLoss < 35 && reworkRatio < 0.2 && m.incidentCount <= 2) {
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
    grade: computeGrade(sprint, org),
    title,
    diagnosis,
  };
}
