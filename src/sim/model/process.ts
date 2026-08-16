/**
 * 工程モデル（coding / review / rework / incident）の確率・レート計算（SPEC 第2章 / 第22.3）。
 *
 * すべて `OrgState` と `Task` から値を返す純関数で、乱数は呼び出し側から
 * 引数で受け取る（seed付き決定論を壊さない）。本作のコア因果——
 * 「AI を入れると Coding は速くなるが Review が詰まり、雑な AI 利用は Rework を増やす」——
 * をここで一元的に表現する。
 */
import type { CardEffects, OrgState, Task, TaskKind } from '../types';
import type { Rng } from '../rng';
import { clamp } from '../clamp';
import { PROCESS_BALANCE } from '../../data/balance';

/**
 * 無効果のカード効果。すべての確率モデル関数はこれを既定値に取り、
 * デッキがないときはカード補正を加えない。
 */
export const IDENTITY_CARD_EFFECTS: CardEffects = {
  codingSpeedMul: 1,
  routineSpeedMul: 1,
  reviewEfficiencyMul: 1,
  reviewCapacityMul: 1,
  seniorHpCostMul: 1,
  reviewHpCostMul: 1,
  reworkRateAdd: 0,
  incidentRateMul: 1,
  aiLiteracyAdd: 0,
  aiDependencyAdd: 0,
  qualityAdd: 0,
  testCoverageAdd: 0,
  securityAdd: 0,
  infraCostMul: 1,
};

/** タスク規模ごとの所要倍率（複雑なほど時間がかかる）。 */
export const SIZE_FACTOR: Record<TaskKind, number> = {
  routine: 0.7,
  normal: 1,
  complex: 1.7,
};

/** タスク規模ごとの基礎出荷ポイント。 */
export const TASK_BASE_VALUE: Record<TaskKind, number> = {
  routine: 3,
  normal: 5,
  complex: 8,
};

/** 高価値タスクの出荷ポイント倍率。 */
export const HIGH_VALUE_MULTIPLIER = 3;

/** Coding の基礎所要 tick（標準規模・AIなし）。 */
export const CODING_BASE_TICKS = PROCESS_BALANCE.codingBaseTicks.value;
/** AI 利用時の Coding 高速化倍率（コア因果: AI で実装が速くなる）。 */
export const AI_CODING_SPEEDUP = PROCESS_BALANCE.aiCodingSpeedup.value;

/** AI 導入時、各タスクが AI を使う確率。 */
export const AI_ADOPTION = PROCESS_BALANCE.aiAdoption.value;
/** AI タスク 1 件ごとに上がる AI依存度。 */
export const AI_DEP_PER_TASK = 2.2;

/** Review の満HP時スループット（PR/tick）。 */
export const REVIEW_BASE_PER_TICK = 0.9;
/** Review 1 件で消費するシニア体力。 */
export const REVIEW_HP_COST = 1.6;
/** 1 tick あたりのシニア体力回復。 */
export const REVIEW_HP_REGEN = 0.7;

/**
 * 障害 1 件の自動鎮火（タイマー切れをシニアが総出で消す）に要するシニア体力。
 * 緊急対応（⚡1 + HP2）で先手を打つより大幅に高くつく＝放置の代償（第6.3）。
 */
export const INCIDENT_HP_COST = 12;
/** これ未満の体力でタイマーが切れると鎮火できず延焼する閾値。 */
export const INCIDENT_CONTAIN_HP = 12;
/** 延焼 1 件で増える技術的負債。 */
export const DEBT_PER_SPREAD = 6;
/**
 * 炎上タイマー: 点火から自動鎮火/延焼までの猶予 tick（第6.3）。
 * この間に緊急対応（firefight）で鎮火すれば、安く済みコンボも守られる。
 */
export const BURN_TICKS = 35;
/** 延焼時の士気低下。 */
export const SPREAD_MORALE_COST = 5;
/**
 * 火が燃えている間の Review スループット倍率（シニアが火事対応に気を取られる）。
 * 放置すると渋滞が育つため、「今すぐ消すか、レビューを止めるか」の即時判断を生む。
 */
export const BURNING_REVIEW_SLOWDOWN = 0.65;
/** 火が燃えている間のシニア体力自然回復の倍率（気が休まらない）。 */
export const BURNING_REGEN_MUL = 0.5;

/** 安全側の介入で工程が落ち着く期間（RI-84 / F-5）。 */
export const STABILITY_TICKS = 180;
/** 安定した運用中に掛ける手戻り率倍率（RI-84 / F-5）。 */
export const STABILITY_REWORK_MUL = 0.4;
/** 安定中に許す連続出荷ボーナスの最大段数（RI-84 / F-5）。 */
export const STABILITY_COMBO_CAP = 8;
/** 安定中に上限を超えたコンボ上振れを残す割合（急な平均落ち込みを避ける）。 */
export const STABILITY_COMBO_TAIL_MUL = 0.5;
/** 安定中に高価値タスクの上振れを抑え始めるコンボ閾値（RI-84 / F-5）。 */
export const STABILITY_HIGH_VALUE_COMBO_THRESHOLD = 8;
/** 閾値超過時の高価値タスク倍率。安定運用では通常タスクを優先して分散を抑える。 */
export const STABILITY_HIGH_VALUE_MUL = 0.7;
/** Rework の所要 tick。 */
export const REWORK_TICKS = 4;
/** タスク 1 件あたりの手戻り上限（これを超えると強制的に通す）。 */
export const MAX_REWORK = 3;

/** PR分割/タスク差配で「捌きやすく」した際の手戻り率の低下量（第6.1）。 */
export const SPLIT_REWORK_REDUCTION = 0.16;

/** 残業号令の発動中に掛かる Coding / Review のスループット倍率（第6.1）。 */
export const OVERTIME_CODING_MUL = 1.4;
export const OVERTIME_REVIEW_MUL = 1.6;

/** コンボ 1 段ごとの出荷倍率の伸び（第6.2 / 第18.2 の COMBO 演出）。 */
export const COMBO_BONUS_PER = 0.1;
/** コンボ倍率の上乗せ上限（最大 1 + これ 倍）。 */
export const COMBO_BONUS_CAP = 1.5;

/**
 * コンボ（連続 Done 数）に応じた出荷ポイント倍率（第6.2）。
 * `combo=0` で 1.0、以降 1 段ごとに伸び、上限で頭打ち。
 * 「攻めて出荷を伸ばす」インセンティブを与える純関数。
 */
export function comboMultiplier(combo: number): number {
  return 1 + Math.min(COMBO_BONUS_CAP, Math.max(0, combo) * COMBO_BONUS_PER);
}

/**
 * 現在の運用状態で実出荷へ適用するコンボ倍率。
 * 安定中は連続出荷ボーナスの基準段数を揃え、上限超過分は一部だけ残す。
 * 表示と計上で同じ倍率を使い、安定化が平均出荷を急落させないようにする。
 */
export function deliveryComboMultiplier(combo: number, stabilized: boolean): number {
  const raw = comboMultiplier(combo);
  if (!stabilized || combo <= STABILITY_COMBO_CAP) return raw;
  const cap = comboMultiplier(STABILITY_COMBO_CAP);
  return cap + (raw - cap) * STABILITY_COMBO_TAIL_MUL;
}

/**
 * Coding の所要 tick（規模・AI利用・カード効果で変化）。
 * カードの Coding 速度倍率（定型はさらに上乗せ）で所要 tick が短くなる。
 */
export function codingTicks(task: Task, effects: CardEffects = IDENTITY_CARD_EFFECTS): number {
  const base = CODING_BASE_TICKS * SIZE_FACTOR[task.kind];
  const aiAdjusted = task.aiAssisted ? base / AI_CODING_SPEEDUP : base;
  const routineMul = task.kind === 'routine' ? effects.routineSpeedMul : 1;
  return aiAdjusted / (effects.codingSpeedMul * routineMul);
}

/** Coding の 1 tick あたり進捗（0..1）。 */
export function codingProgressPerTick(
  task: Task,
  effects: CardEffects = IDENTITY_CARD_EFFECTS,
): number {
  return 1 / codingTicks(task, effects);
}

/** Rework の 1 tick あたり進捗（0..1）。 */
export function reworkProgressPerTick(): number {
  return 1 / REWORK_TICKS;
}

/**
 * Review の 1 tick あたり処理可能 PR 数。
 * シニア体力が低いほど落ちる（過労 → レビュー渋滞の悪循環。第2章）。
 * 体力 0 でも完全停止はせず、最低限のスループットを残す。
 */
export function reviewPerTick(org: OrgState, effects: CardEffects = IDENTITY_CARD_EFFECTS): number {
  const efficiency = 0.3 + 0.7 * (org.seniorHp / 100);
  return (
    REVIEW_BASE_PER_TICK * efficiency * effects.reviewEfficiencyMul * effects.reviewCapacityMul
  );
}

/**
 * Review 済みタスクが手戻りになる確率。
 * **AI依存度が上がるほど増える**（第22.5 の代表的不変条件）。
 * 品質・AIリテラシーが高いほど下がる。手戻り回数が増えると収束させる。
 */
export function reworkProbability(
  org: OrgState,
  task: Task,
  effects: CardEffects = IDENTITY_CARD_EFFECTS,
): number {
  // RI-77: AI タスク固有の手戻り上乗せは小さく保ち、依存度・編成側の代償を主因にする。
  // Review 渋滞・Rework 増のコア因果（RI-41）は維持する。
  const p =
    0.05 +
    0.32 * (org.aiDependency / 100) +
    (task.aiAssisted ? 0.05 : 0) -
    0.18 * (org.aiLiteracy / 100) -
    0.14 * (org.quality / 100) +
    effects.reworkRateAdd -
    (task.split ? SPLIT_REWORK_REDUCTION : 0);
  // 再修正済みのタスクは通りやすくする（収束保証）。
  const damped = p * Math.pow(0.5, task.reworkAttempts);
  return clamp(damped, 0.02, 0.75);
}

/**
 * セキュリティ水準の脆弱度 0..1（RI-87）。
 * 50 以上は実質無効果にし、既存バランス帯を壊さず軽視ビルド側で効かせる。
 */
export function securityFragility(securityLevel: number): number {
  return clamp((50 - clamp(securityLevel, 0, 100)) / 50, 0, 1);
}

/**
 * セキュリティ水準が低いほど Incident 基礎率へ加わるボーナス（RI-87）。
 * testCoverage 項と二重すぎないよう係数は控えめ。
 */
export function securityIncidentRateBonus(securityLevel: number): number {
  return 0.05 * securityFragility(securityLevel);
}

/**
 * 延焼コスト倍率（RI-87）。securityLevel 50+ で 1、0 で 1.6。
 */
export function securitySpreadMul(securityLevel: number): number {
  return 1 + 0.6 * securityFragility(securityLevel);
}

/**
 * 延焼に伴う顧客信頼の変化量（RI-87。負が低下）。
 * 鎮火できた事故だけでは下げず、延焼（規模の顕在化）で下振れする。
 * 水準が高いほど下振れを抑える。
 */
/** 延焼1件ぶんの顧客信頼 raw（発生時点の水準で積む。RI-87）。 */
export function securityCustomerTrustSpreadRaw(securityLevel: number): number {
  return 2 * securityFragility(securityLevel);
}

/** 蓄積 raw を顧客信頼デルタへ確定する（負が低下）。 */
export function securityCustomerTrustFromRaw(raw: number): number {
  if (raw < 0.5) return 0;
  return -Math.ceil(raw);
}

export function securityCustomerTrustDelta(
  securityLevel: number,
  incidents: number,
  spread: number,
): number {
  if (spread <= 0) return 0;
  const exposure = Math.max(0, spread) * 2 + Math.max(0, incidents) * 0.5;
  return securityCustomerTrustFromRaw(exposure * securityFragility(securityLevel));
}

/**
 * Review 済みタスクが障害（Incident）になる確率。
 * テストカバレッジが低いほど増える。AI 利用かつ低リテラシーで上乗せ。
 * セキュリティ水準が低いほど基礎率が増える（RI-87）。
 */
export function incidentProbability(
  org: OrgState,
  task: Task,
  effects: CardEffects = IDENTITY_CARD_EFFECTS,
): number {
  const p =
    (0.02 +
      0.1 * (1 - org.testCoverage / 100) +
      securityIncidentRateBonus(org.securityLevel) +
      (task.aiAssisted ? 0.05 * (1 - org.aiLiteracy / 100) : 0)) *
    effects.incidentRateMul;
  return clamp(p, 0.01, 0.4);
}

/** タスクの出荷ポイント。 */
export function taskValue(task: Task): number {
  const base = TASK_BASE_VALUE[task.kind];
  return task.highValue ? base * HIGH_VALUE_MULTIPLIER : base;
}

/**
 * AI 支援タスクの出荷価値倍率（RI-77）。
 * リテラシーが高いほど「そのまま使える」割合が増え、既定の部分配布でも純出荷が正側へ届く。
 */
export function aiDeliveryValueMul(org: OrgState, task: Task): number {
  if (!task.aiAssisted) return 1;
  return 1 + 0.85 * (org.aiLiteracy / 100);
}

/**
 * Coding に入る際、そのタスクが AI を使うか判定する（要乱数）。
 * AI 未導入なら常に false。`adoption` は編成（AIを配ったコーダーの割合）で
 * 変動する実採用率で、未指定なら従来どおり全社的な既定採用率を使う（後方互換）。
 */
export function decideAiAssisted(org: OrgState, rng: Rng, adoption: number = AI_ADOPTION): boolean {
  if (!org.aiEnabled) return false;
  return rng() < adoption;
}
