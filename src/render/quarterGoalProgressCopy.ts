/**
 * スプリント結果の四半期目標進捗1行（#1014）。
 * 評価値は `measureGoalProgress` の出力だけを使う。
 */
import type { GoalKpiProgress } from '../sim/run/types';

/** プレイヤー向けの短い KPI 名。measureGoalProgress の id と対応する。 */
const KPI_SHORT_LABELS: Record<string, string> = {
  delivery: '出荷',
  quality: '品質',
  techDebt: '負債',
  morale: '士気',
  incident: 'インシデント',
  aiAdoption: 'AI利用率',
};

const LIMIT_KPI_IDS = new Set(['incident', 'techDebt']);

export interface QuarterGoalProgressLine {
  show: true;
  text: string;
  tone: 'neutral' | 'danger';
  /** 大きいほど危険（#1011 凍結行との優先比較用）。 */
  severity: number;
}

export type QuarterGoalProgressPlan = QuarterGoalProgressLine | { show: false };

function formatKpiSegment(kpi: GoalKpiProgress): string {
  const label = KPI_SHORT_LABELS[kpi.id] ?? kpi.label;
  const limitWord = LIMIT_KPI_IDS.has(kpi.id) ? '上限 ' : '';
  const suffix = kpi.id === 'aiAdoption' ? '%' : '';
  return `${label} ${kpi.actual}${suffix} / ${limitWord}${kpi.target}${suffix}`;
}

function quarterGoalLineSeverity(progress: readonly GoalKpiProgress[]): number {
  const missed = progress.filter((kpi) => kpi.status === 'missed');
  if (missed.length === 0) return 0;
  let severity = 40 + missed.length * 15;
  for (const kpi of missed) {
    if (kpi.id === 'incident') severity += 60;
    else if (kpi.id === 'delivery') severity += 35;
  }
  return severity;
}

/** 四半期1〜5のスプリント結果用。ボス直前を含む通常スプリントだけ。 */
export function planQuarterGoalProgressLine(input: {
  quarterNumber: number;
  sprintIndexInQuarter: number;
  sprintsPerQuarter: number;
  progress: readonly GoalKpiProgress[];
}): QuarterGoalProgressPlan {
  const bossIndex = input.sprintsPerQuarter;
  if (input.sprintIndexInQuarter <= 0 || input.sprintIndexInQuarter >= bossIndex) {
    return { show: false };
  }
  const remaining = bossIndex - input.sprintIndexInQuarter;
  const segments = input.progress.map(formatKpiSegment);
  const text = `Q${input.quarterNumber} ${segments.join('・')}（残り${remaining}スプリント）`;
  const severity = quarterGoalLineSeverity(input.progress);
  return {
    show: true,
    text,
    tone: severity > 0 ? 'danger' : 'neutral',
    severity,
  };
}
