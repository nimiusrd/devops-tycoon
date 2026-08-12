/**
 * 基本ステータス表示の導出（SPEC 第4.2）。
 *
 * OrgState とスプリントの現況から、画面上部に出す
 * グレード（開発速度・レビュー耐性・品質）と炎上リスクを導出する純関数。
 */
import { getGoalAdjustment } from '../data/goalAdjustments';
import {
  ANDON_STABILITY_REVIEW_MIN,
  FIREFIGHT_STABILITY_BURN_TICKS,
  FIREFIGHT_STABILITY_MIN_BURNING,
} from '../sim/actions';
import { REVIEW_FREEZE_PEAK } from '../sim/outcome';
import type { OrgScaleState } from '../sim/orgscale/types';
import { resolveNextQuarterEffects } from '../sim/run/quarterReview';
import type { GoalAdjustmentId, StakeholderTrust } from '../sim/run/types';
import type { OrgState, SimState, Task } from '../sim/types';

/** `review-freeze` イベント抽選の資格帯（seniorHpLow >= 0.55 ⇔ HP <= 45）。 */
export const REVIEW_FREEZE_EVENT_HP = 45;
/** HUD「凍結注意」のキューピーク閾値（敗北ピークの 75%・playtest 危険域と揃える）。 */
export const REVIEW_FREEZE_WATCH_PEAK = Math.round(REVIEW_FREEZE_PEAK * 0.75);
/** HUD「PR凍結危険」のキューピーク閾値。 */
export const REVIEW_FREEZE_DANGER_PEAK = REVIEW_FREEZE_PEAK - 4;

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type RiskLevel = 'LOW' | 'MED' | 'HIGH';
export type StatusMetricId =
  | 'delivery'
  | 'devSpeed'
  | 'reviewCapacity'
  | 'quality'
  | 'security'
  | 'seniorHp'
  | 'aiDependency'
  | 'techDebt'
  | 'morale';
export type StatusMetricDirection = 'higher-better' | 'lower-better';
export type StatusMetricTone = 'good' | 'watch' | 'danger';

export interface StatusView {
  /** 出荷ポイント。 */
  deliveryScore: number;
  /** 開発速度。 */
  devSpeed: Grade;
  /** レビュー耐性。 */
  reviewCapacity: Grade;
  /** 品質。 */
  quality: Grade;
  /** セキュリティ水準 0..100（RI-87）。 */
  securityLevel: number;
  /** シニア体力（%）。 */
  seniorHpPct: number;
  /** AI依存度（%）。 */
  aiDependencyPct: number;
  /** 技術的負債。 */
  techDebt: number;
  /** 士気。 */
  morale: number;
  /** 炎上リスク。 */
  risk: RiskLevel;
}

export interface StatusMetricView {
  id: StatusMetricId;
  feedbackKey?: HudMetricKey;
  label: string;
  icon: string;
  value: number | Grade;
  unit?: string;
  direction: StatusMetricDirection;
  directionLabel: string;
  tone: StatusMetricTone;
  detail: string;
  help: string;
  barPct?: number;
  fillClass?: string;
  risk?: RiskLevel;
  /** 炎上リスクと混同しない燃え尽き向けの短い警告（RI-67）。 */
  warningChip?: string;
}

/** シニア体力 HUD の help（RI-67）。 */
export const SENIOR_HP_HELP =
  'メンバー個別のスタミナとは別の抽象値です。炎上は複数炎上やタイマーが短いときだけ緊急対応で消し、余裕のある先消しは避けます。アンドンは流入を止めてキューを捌く猶予を作り、AIスロットルはAI由来の点火・手戻りを下げ、休息で戻します。';

/** AI依存度 HUD の help（RI-74）。 */
export const AI_DEPENDENCY_HELP =
  'AI任せが強いほどレビュー負荷と手戻りリスクが上がります。リテラシーが30以下のまま依存度が95に達すると敗北します。ペアレビューでリテラシーを上げるか、AI利用ガイドライン（カード）や全社／部門／チームのAIレバーで依存度を下げてください。介入バーのAIスロットルは新規流入を抑えるだけで、既に上がった依存度は下げません。';

/** シニア体力の詳細・警告チップ文言（RI-67）。緊急の炎上だけ緊急対応へ誘導する（RI-73）。 */
export function seniorHpHudCopy(
  seniorHpPct: number,
  opts: { firefightUrgent: boolean; reviewCongested: boolean },
): {
  detail: string;
  warningChip?: string;
} {
  const guard = opts.reviewCongested ? 'アンドンや休息で守る' : 'AIスロットルや休息で守る';
  if (seniorHpPct < 25) {
    return {
      detail: opts.firefightUrgent ? '燃え尽き寸前・緊急対応で鎮火' : `燃え尽き寸前・${guard}`,
      warningChip: '燃え尽き危険',
    };
  }
  if (seniorHpPct < 50) {
    return {
      detail: opts.firefightUrgent ? '低下中・緊急の炎上は緊急対応で' : `低下中・${guard}`,
      warningChip: '体力注意',
    };
  }
  return { detail: '25%未満は危険' };
}

export interface AiDependencyHudCopyOptions {
  /**
   * 全社集約など、依存度と Literacy のスコープが一致しない表示。
   * true のときは敗北条件チップを出さず、過信域の一般警告だけにする（RI-74）。
   */
  suppressLoseWarning?: boolean;
}

/**
 * AI依存度の詳細・警告チップ文言（RI-74）。
 * 低リテラシーかつ依存度が注意帯以上なら、数スプリント前から予兆を出す。
 */
export function aiDependencyHudCopy(
  aiDependencyPct: number,
  aiLiteracy: number,
  options: AiDependencyHudCopyOptions = {},
): {
  detail: string;
  warningChip?: string;
} {
  if (options.suppressLoseWarning) {
    if (aiDependencyPct >= 75) return { detail: '75%以上は過信域' };
    if (aiDependencyPct >= 50) return { detail: '50%以上は注意帯' };
    return { detail: '75%以上は過信域' };
  }
  const literacy = Math.round(aiLiteracy);
  const detail = `Literacy ${literacy}・95%かつLiteracy≤30で敗北`;
  if (literacy <= 30 && aiDependencyPct >= 50) {
    return {
      detail,
      warningChip: '依存危険・ペアかガイド',
    };
  }
  if (aiDependencyPct >= 75) {
    return { detail: `${detail}・過信域` };
  }
  return { detail };
}

export type HudMetricKey =
  | 'deliveryScore'
  | 'seniorHpPct'
  | 'aiDependencyPct'
  | 'techDebt'
  | 'morale'
  | 'securityLevel';

export type HudFeedbackTone = 'positive' | 'negative';

export type HudMetricSnapshot = Record<HudMetricKey, number>;

export interface HudMetricDelta {
  key: HudMetricKey;
  label: string;
  delta: number;
  tone: HudFeedbackTone;
}

export type RunMetricKey = 'budget' | 'trustManagement' | 'trustCustomers' | 'trustTeam';

export type RunMetricSnapshot = Record<RunMetricKey, number>;

export interface RunMetricDelta {
  key: RunMetricKey;
  label: string;
  shortLabel: string;
  delta: number;
  tone: HudFeedbackTone;
}

const HUD_METRIC_LABELS: Record<HudMetricKey, string> = {
  deliveryScore: '出荷ポイント',
  seniorHpPct: 'シニア体力',
  aiDependencyPct: 'AI依存度',
  techDebt: '技術的負債',
  morale: '士気',
  securityLevel: 'セキュリティ',
};

/** 値が増えるほど悪化する HUD 指標。 */
const INVERSE_HUD_METRICS = new Set<HudMetricKey>(['aiDependencyPct', 'techDebt']);

const RUN_METRIC_LABELS: Record<RunMetricKey, { label: string; shortLabel: string }> = {
  budget: { label: '予算', shortLabel: '予算' },
  trustManagement: { label: '経営信頼', shortLabel: '経営' },
  trustCustomers: { label: '顧客信頼', shortLabel: '顧客' },
  trustTeam: { label: 'チーム信頼', shortLabel: 'チーム' },
};

/** 0..100 の値を閾値でグレード化する（高いほど良い指標向け）。 */
function gradeOf(value: number): Grade {
  if (value >= 85) return 'S';
  if (value >= 70) return 'A';
  if (value >= 55) return 'B';
  if (value >= 40) return 'C';
  if (value >= 20) return 'D';
  return 'E';
}

/** 現在 Review 待ちのタスク数（渋滞の指標）。 */
export function reviewQueueLength(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) if (t.lane === 'review') n += 1;
  return n;
}

/** 炎上リスクを Review 渋滞とシニア体力から判定する。 */
export function riskLevel(reviewQueue: number, seniorHp: number): RiskLevel {
  if (reviewQueue >= 12 || seniorHp < 25) return 'HIGH';
  if (reviewQueue >= 6 || seniorHp < 50) return 'MED';
  return 'LOW';
}

/** 組織状態と現在のタスク群から表示用ステータスを導出する。 */
export function deriveStatusParts(org: OrgState, tasks: Task[]): StatusView {
  const queue = reviewQueueLength(tasks);
  return {
    deliveryScore: org.deliveryScore,
    // AI 導入で開発速度は上がるが、その分レビューに皺寄せがいく（第2章）。
    devSpeed: org.aiEnabled ? 'S' : 'B',
    reviewCapacity: gradeOf(org.seniorHp),
    quality: gradeOf(org.quality),
    securityLevel: Math.round(org.securityLevel),
    seniorHpPct: Math.round(org.seniorHp),
    aiDependencyPct: Math.round(org.aiDependency),
    techDebt: org.techDebt,
    morale: Math.round(org.morale),
    risk: riskLevel(queue, org.seniorHp),
  };
}

function gradeTone(grade: Grade): StatusMetricTone {
  if (grade === 'S' || grade === 'A' || grade === 'B') return 'good';
  if (grade === 'C' || grade === 'D') return 'watch';
  return 'danger';
}

function higherBetterTone(
  value: number,
  watchBelow: number,
  dangerBelow: number,
): StatusMetricTone {
  if (value < dangerBelow) return 'danger';
  if (value < watchBelow) return 'watch';
  return 'good';
}

function lowerBetterTone(value: number, watchAt: number, dangerAt: number): StatusMetricTone {
  if (value >= dangerAt) return 'danger';
  if (value >= watchAt) return 'watch';
  return 'good';
}

function toneFromRisk(risk: RiskLevel): StatusMetricTone {
  if (risk === 'HIGH') return 'danger';
  if (risk === 'MED') return 'watch';
  return 'good';
}

const HIGHER_BETTER = '高いほど良い';
const LOWER_BETTER = '低いほど安全';

/** HUD 表示用ステータス。俯瞰中は全社集約値を優先し、レバー効果も差分対象に含める。 */
export function deriveHudStatusParts(
  org: OrgState,
  tasks: Task[],
  orgScale?: OrgScaleState | null,
): StatusView {
  const status = deriveStatusParts(org, tasks);
  if (!orgScale) return status;
  return {
    ...status,
    deliveryScore: orgScale.shipping,
    aiDependencyPct: orgScale.aiDependency,
    techDebt: orgScale.techDebt,
    morale: orgScale.morale,
    securityLevel: orgScale.securityLevel,
  };
}

/**
 * HUD 凍結予兆用のライブピーク。
 * 進行中スプリントのピークと全チームの現在キューを畳み込む（通算 peak は使わない）。
 */
export function reviewFreezeWarningPeak(
  sprintReviewQueueMax: number,
  teamReviewQueues: readonly number[],
): number {
  let peak = Math.max(0, sprintReviewQueueMax);
  for (const q of teamReviewQueues) peak = Math.max(peak, q);
  return peak;
}

/**
 * レビュー凍結（RI-85）の詳細・警告チップ。
 * 敗北経路はキューピークのみなので、予兆もライブピークだけで出す（低HPは燃え尽き側）。
 */
export function reviewFreezeHudCopy(reviewQueuePeak: number): {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
} {
  const peakWatch = reviewQueuePeak >= REVIEW_FREEZE_WATCH_PEAK;
  const peakDanger = reviewQueuePeak >= REVIEW_FREEZE_DANGER_PEAK;
  if (!peakWatch) {
    return { tone: 'good', detail: `Review待ちピーク ${Math.round(reviewQueuePeak)}` };
  }
  if (peakDanger) {
    return {
      tone: 'danger',
      detail: '凍結危険・AIスロットルやPR分割でピークを下げる',
      warningChip: 'PR凍結危険',
    };
  }
  return {
    tone: 'watch',
    detail: '凍結注意・渋滞ピークが限界に近い',
    warningChip: '凍結注意',
  };
}

/** HUD の表示メタデータを、既存のステータス導出値から組み立てる。 */
export function deriveHudMetrics(
  org: OrgState,
  tasks: Task[],
  orgScale?: OrgScaleState | null,
  reviewQueuePeak = 0,
): StatusMetricView[] {
  const s = deriveHudStatusParts(org, tasks, orgScale);
  const queue = reviewQueueLength(tasks);
  const livePeak = Math.max(reviewQueuePeak, queue);
  const freezeCopy = reviewFreezeHudCopy(livePeak);
  const burning = tasks.filter((task) => task.incident);
  const minBurnTicksLeft = burning.reduce(
    (min, task) => Math.min(min, task.burnTicksLeft ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
  const firefightUrgent =
    burning.length >= FIREFIGHT_STABILITY_MIN_BURNING ||
    (burning.length >= 1 && minBurnTicksLeft <= FIREFIGHT_STABILITY_BURN_TICKS);
  const reviewCongested = queue >= ANDON_STABILITY_REVIEW_MIN;
  const devSpeedDetail = org.aiEnabled ? 'AI支援で高速' : '通常速度';

  return [
    {
      id: 'delivery',
      feedbackKey: 'deliveryScore',
      label: '出荷ポイント',
      icon: '📦',
      value: s.deliveryScore,
      unit: 'pt',
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: 'good',
      detail: '勝利条件の進捗',
      help: 'ラン全体の出荷成果です。スプリント完了と品質維持で伸びます。',
    },
    {
      id: 'devSpeed',
      label: '開発速度',
      icon: '⚡',
      value: s.devSpeed,
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: gradeTone(s.devSpeed),
      detail: devSpeedDetail,
      help: '開発レーンの押し出し力です。AI支援で上がりますが、レビュー負荷も増えます。',
    },
    {
      id: 'reviewCapacity',
      label: 'レビュー耐性',
      icon: '🛡',
      value: s.reviewCapacity,
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: freezeCopy.warningChip ? freezeCopy.tone : gradeTone(s.reviewCapacity),
      detail: freezeCopy.warningChip ? freezeCopy.detail : `Review待ち ${queue}`,
      warningChip: freezeCopy.warningChip,
      help: 'レビュー詰まりへの耐性です。シニア体力が落ちるほど悪化します。',
    },
    {
      id: 'quality',
      label: '品質',
      icon: '✅',
      value: s.quality,
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: gradeTone(s.quality),
      detail: '手戻りを抑える力',
      help: '品質が高いほど手戻りや障害が起きにくくなります。',
    },
    {
      id: 'security',
      feedbackKey: 'securityLevel',
      label: 'セキュリティ',
      icon: '🔐',
      value: s.securityLevel,
      unit: '',
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: higherBetterTone(s.securityLevel, 50, 25),
      detail:
        s.securityLevel < 50
          ? '危険帯・事故規模と顧客信頼の下振れが増える'
          : '無効果帯・検証投資で下振れを抑える',
      warningChip:
        s.securityLevel < 25
          ? 'セキュリティ危険'
          : s.securityLevel < 50
            ? 'セキュリティ注意'
            : undefined,
      help: 'セキュリティ水準が50を下回ると事故率・延焼コスト・顧客信頼の下振れが増えます。自動テストや品質進化で上げ、速度偏重で下がります。',
    },
    {
      id: 'seniorHp',
      feedbackKey: 'seniorHpPct',
      label: 'シニア体力',
      icon: '💪',
      value: s.seniorHpPct,
      unit: '%',
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: higherBetterTone(s.seniorHpPct, 50, 25),
      ...seniorHpHudCopy(s.seniorHpPct, { firefightUrgent, reviewCongested }),
      help: SENIOR_HP_HELP,
      barPct: s.seniorHpPct,
      fillClass: 'fill-hp',
    },
    {
      id: 'aiDependency',
      feedbackKey: 'aiDependencyPct',
      label: 'AI依存度',
      icon: '🤖',
      value: s.aiDependencyPct,
      unit: '%',
      direction: 'lower-better',
      directionLabel: LOWER_BETTER,
      tone: lowerBetterTone(s.aiDependencyPct, 50, 75),
      ...aiDependencyHudCopy(s.aiDependencyPct, org.aiLiteracy, {
        // 俯瞰中は依存度が全社集約、Literacy は選択中チームのままなので混ぜない。
        suppressLoseWarning: !!orgScale,
      }),
      help: AI_DEPENDENCY_HELP,
      barPct: s.aiDependencyPct,
      fillClass: 'fill-ai',
    },
    {
      id: 'techDebt',
      feedbackKey: 'techDebt',
      label: '技術的負債',
      icon: '🧱',
      value: s.techDebt,
      direction: 'lower-better',
      directionLabel: LOWER_BETTER,
      tone: lowerBetterTone(s.techDebt, 45, 80),
      detail: '80以上は危険',
      help: '負債が高いほど開発と品質に悪影響が出ます。返済や品質投資で下げられます。',
    },
    {
      id: 'morale',
      feedbackKey: 'morale',
      label: '士気',
      icon: '🔥',
      value: s.morale,
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone:
        toneFromRisk(s.risk) === 'good' ? higherBetterTone(s.morale, 60, 35) : toneFromRisk(s.risk),
      detail: '炎上リスク連動',
      help: 'チームの粘り強さです。低下やレビュー渋滞は炎上リスクを上げます。',
      barPct: s.morale,
      fillClass: 'fill-mor',
      risk: s.risk,
    },
  ];
}

/** HUD の差分検出に使う数値指標だけを抜き出す。 */
export function hudMetricSnapshot(status: StatusView): HudMetricSnapshot {
  return {
    deliveryScore: status.deliveryScore,
    seniorHpPct: status.seniorHpPct,
    aiDependencyPct: status.aiDependencyPct,
    techDebt: status.techDebt,
    morale: status.morale,
    securityLevel: status.securityLevel,
  };
}

/** 前回/今回の HUD 数値差分を、改善/悪化 tone 付きで返す。 */
export function diffHudMetricSnapshots(
  previous: HudMetricSnapshot,
  current: HudMetricSnapshot,
): HudMetricDelta[] {
  const deltas: HudMetricDelta[] = [];
  for (const key of Object.keys(current) as HudMetricKey[]) {
    const delta = current[key] - previous[key];
    if (delta === 0) continue;

    const improved = INVERSE_HUD_METRICS.has(key) ? delta < 0 : delta > 0;
    deltas.push({
      key,
      label: HUD_METRIC_LABELS[key],
      delta,
      tone: improved ? 'positive' : 'negative',
    });
  }
  return deltas;
}

/**
 * 予算の詳細・警告チップ（RI-79）。
 * 四半期危機（budget<=5 / shutdown の budget<=0）の手前から予兆する。
 * budget<=5 は missed_crisis 以上が確定するため追加申請（request_budget）は
 * 提示せず支出抑制のみを案内する。
 */
export function budgetHudCopy(budget: number): {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
} {
  if (budget <= 5) {
    return {
      tone: 'danger',
      detail: '予算危機・支出抑制で残高を守る',
      warningChip: '予算危険',
    };
  }
  if (budget <= 15) {
    return {
      tone: 'watch',
      detail: '予算注意・追加申請や買い物抑制を検討',
      warningChip: '予算注意',
    };
  }
  return { tone: 'good', detail: '15以下で注意' };
}

/**
 * ステークホルダー信頼の詳細・警告チップ（RI-79）。
 * missed_crisis（minTrust<=15）/ shutdown（<=10）の手前から予兆する。
 */
export function trustHudCopy(trust: StakeholderTrust): {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
  minTrust: number;
} {
  const minTrust = Math.min(trust.management, trust.customers, trust.team);
  if (minTrust <= 15) {
    return {
      tone: 'danger',
      detail: '信頼危機・ケアや未達回避で延命',
      warningChip: '信頼危険',
      minTrust,
    };
  }
  if (minTrust <= 25) {
    return {
      tone: 'watch',
      detail: '信頼注意・削る選択を避けて立て直す',
      warningChip: '信頼注意',
      minTrust,
    };
  }
  return { tone: 'good', detail: '25以下で注意', minTrust };
}

/**
 * 目標修正の次四半期キャリーオーバー表示（RI-83）。
 * 有効四半期でのみチップを出し、選んだ代償が追跡できるようにする。
 */
export function goalCarryoverHudCopy(input: {
  goalCarryoverId: GoalAdjustmentId | null;
  goalCarryoverQuarter: number | null;
  quarterNumber: number;
}): {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
} {
  const { goalCarryoverId, goalCarryoverQuarter, quarterNumber } = input;
  if (
    goalCarryoverId === null ||
    goalCarryoverQuarter === null ||
    goalCarryoverQuarter !== quarterNumber
  ) {
    return { tone: 'good', detail: '持ち越し代償なし' };
  }
  const def = getGoalAdjustment(goalCarryoverId);
  if (!def) return { tone: 'good', detail: '持ち越し代償なし' };
  const effects = resolveNextQuarterEffects(def);
  const parts: string[] = [];
  if (effects.codingSpeedMul !== undefined && effects.codingSpeedMul !== 1) {
    const pct = Math.round((effects.codingSpeedMul - 1) * 100);
    parts.push(`出荷${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.reviewEfficiencyMul !== undefined && effects.reviewEfficiencyMul !== 1) {
    const pct = Math.round((effects.reviewEfficiencyMul - 1) * 100);
    parts.push(`レビュー${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.reviewCapacityMul !== undefined && effects.reviewCapacityMul !== 1) {
    const pct = Math.round((effects.reviewCapacityMul - 1) * 100);
    parts.push(`容量${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.incidentRateMul !== undefined && effects.incidentRateMul !== 1) {
    const pct = Math.round((effects.incidentRateMul - 1) * 100);
    parts.push(`障害${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.reworkRateAdd !== undefined && effects.reworkRateAdd !== 0) {
    const pct = Math.round(effects.reworkRateAdd * 100);
    parts.push(`Rework${pct >= 0 ? '+' : ''}${pct}`);
  }
  if (effects.qualityAdd !== undefined && effects.qualityAdd !== 0) {
    parts.push(`品質${effects.qualityAdd >= 0 ? '+' : ''}${effects.qualityAdd}/S`);
  }
  if (effects.techDebtDelta !== undefined && effects.techDebtDelta !== 0) {
    parts.push(`負債${effects.techDebtDelta >= 0 ? '+' : ''}${effects.techDebtDelta}/S`);
  }
  if (effects.seniorHpDelta !== undefined && effects.seniorHpDelta !== 0) {
    parts.push(`シニア${effects.seniorHpDelta >= 0 ? '+' : ''}${effects.seniorHpDelta}/S`);
  }
  const summary = parts.length > 0 ? parts.join(' / ') : '効果適用中';
  const shipDown = (effects.codingSpeedMul ?? 1) < 1;
  return {
    tone: shipDown ? 'watch' : 'good',
    detail: `${def.label}の持ち越し: ${summary}`,
    warningChip: def.label,
  };
}

/** RunBar の差分検出に使うラン横断指標だけを抜き出す。 */
export function runMetricSnapshot(input: {
  budget: number;
  stakeholderTrust: StakeholderTrust;
}): RunMetricSnapshot {
  return {
    budget: input.budget,
    trustManagement: input.stakeholderTrust.management,
    trustCustomers: input.stakeholderTrust.customers,
    trustTeam: input.stakeholderTrust.team,
  };
}

/** 予算・信頼の差分を、改善/悪化 tone 付きで返す。 */
export function diffRunMetricSnapshots(
  previous: RunMetricSnapshot,
  current: RunMetricSnapshot,
): RunMetricDelta[] {
  const deltas: RunMetricDelta[] = [];
  for (const key of Object.keys(current) as RunMetricKey[]) {
    const delta = current[key] - previous[key];
    if (delta === 0) continue;

    const labels = RUN_METRIC_LABELS[key];
    deltas.push({
      key,
      label: labels.label,
      shortLabel: labels.shortLabel,
      delta,
      tone: delta > 0 ? 'positive' : 'negative',
    });
  }
  return deltas;
}

/** SimStateから表示用ステータスを導出する。 */
export function deriveStatus(state: SimState): StatusView {
  return deriveStatusParts(state.org, state.sprint.tasks);
}
