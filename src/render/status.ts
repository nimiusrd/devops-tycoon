/**
 * 基本ステータス表示の導出（SPEC 第4.2）。
 *
 * OrgState とスプリントの現況から、画面上部に出す
 * グレード（開発速度・レビュー耐性・品質）と炎上リスクを導出する純関数。
 */
import type { OrgScaleState } from '../sim/orgscale/types';
import type { StakeholderTrust } from '../sim/run/types';
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
  /** 炎上リスクと混同しない燃え尽き向けの短い警告（RI-67）。 */
  warningChip?: string;
}

/** シニア体力 HUD の help（RI-67）。 */
export const SENIOR_HP_HELP =
  'メンバー個別のスタミナとは別の抽象値です。炎上があるときは自動鎮火の前に緊急対応で消すのが最大の守りです。アンドンは流入を止めてキューを捌く猶予を作り、AIスロットルはAI由来の点火・手戻りを下げ、休息で戻します。';

/** シニア体力の詳細・警告チップ文言（RI-67）。炎上があるときだけ緊急対応へ誘導する。 */
export function seniorHpHudCopy(
  seniorHpPct: number,
  hasBurning: boolean,
): {
  detail: string;
  warningChip?: string;
} {
  if (seniorHpPct < 25) {
    return {
      detail: hasBurning ? '燃え尽き寸前・緊急対応で鎮火' : '燃え尽き寸前・アンドンや休息で守る',
      warningChip: '燃え尽き危険',
    };
  }
  if (seniorHpPct < 50) {
    return {
      detail: hasBurning ? '低下中・炎上は緊急対応で' : '低下中・アンドンや休息で守る',
      warningChip: '体力注意',
    };
  }
  return { detail: '25%未満は危険' };
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
  const hasBurning = tasks.some((task) => task.incident);
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
      ...seniorHpHudCopy(s.seniorHpPct, hasBurning),
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
