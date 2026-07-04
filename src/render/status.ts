/**
 * 基本ステータス表示の導出（SPEC 第4.2）。
 *
 * OrgState とスプリントの現況から、画面上部に出す
 * グレード（開発速度・レビュー耐性・品質）と炎上リスクを導出する純関数。
 */
import type { OrgScaleState } from '../sim/orgscale/types';
import type { OrgState, SimState, Task } from '../sim/types';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type RiskLevel = 'LOW' | 'MED' | 'HIGH';
export type StatusMetricId =
  | 'delivery'
  | 'devSpeed'
  | 'reviewCapacity'
  | 'quality'
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
}

export type HudMetricKey =
  | 'deliveryScore'
  | 'seniorHpPct'
  | 'aiDependencyPct'
  | 'techDebt'
  | 'morale';

export type HudFeedbackTone = 'positive' | 'negative';

export type HudMetricSnapshot = Record<HudMetricKey, number>;

export interface HudMetricDelta {
  key: HudMetricKey;
  label: string;
  delta: number;
  tone: HudFeedbackTone;
}

const HUD_METRIC_LABELS: Record<HudMetricKey, string> = {
  deliveryScore: '出荷ポイント',
  seniorHpPct: 'シニア体力',
  aiDependencyPct: 'AI依存度',
  techDebt: '技術的負債',
  morale: '士気',
};

/** 値が増えるほど悪化する HUD 指標。 */
const INVERSE_HUD_METRICS = new Set<HudMetricKey>(['aiDependencyPct', 'techDebt']);

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
  };
}

/** HUD の表示メタデータを、既存のステータス導出値から組み立てる。 */
export function deriveHudMetrics(
  org: OrgState,
  tasks: Task[],
  orgScale?: OrgScaleState | null,
): StatusMetricView[] {
  const s = deriveHudStatusParts(org, tasks, orgScale);
  const queue = reviewQueueLength(tasks);
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
      tone: gradeTone(s.reviewCapacity),
      detail: `Review待ち ${queue}`,
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
      id: 'seniorHp',
      feedbackKey: 'seniorHpPct',
      label: 'シニア体力',
      icon: '💪',
      value: s.seniorHpPct,
      unit: '%',
      direction: 'higher-better',
      directionLabel: HIGHER_BETTER,
      tone: higherBetterTone(s.seniorHpPct, 50, 25),
      detail: '25%未満は危険',
      help: 'レビュー・火消しを支える余力です。休憩や負荷軽減で回復します。',
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
      detail: '75%以上は過信域',
      help: 'AI任せが強いほどレビュー負荷と手戻りリスクが上がります。',
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

/** SimState から表示用ステータスを導出する（Phase 1/2 互換）。 */
export function deriveStatus(state: SimState): StatusView {
  return deriveStatusParts(state.org, state.sprint.tasks);
}
