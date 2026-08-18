/**
 * 全社マップの診断・KPI時系列表示（RI-128）。
 *
 * `trendHistory` を読むだけの純関数。Recharts は使わない（第22.2）。
 * レビュー結果履歴（RI-126）と部門現在値比較（RI-125）は扱わない。
 * 全社系列の正本は保存した `kpis`（四半期レビュー実績）である。
 */
import { DEPARTMENT_DEFS } from '../data/departments';
import { KPI_STATUS_LABELS } from './reviewHistoryView';
import { diagnosisView } from '../sim/diagnosis';
import type { DiagnosisType, GoalKpiProgress, QuarterTrendSnapshot } from '../sim/run/types';

export type CompanyTrendSeriesKey =
  | 'delivery'
  | 'quality'
  | 'techDebt'
  | 'morale'
  | 'incident'
  | 'aiAdoption';
export type DeptTrendSeriesKey = 'aiDependency' | 'techDebt' | 'morale';
export type TrendSeriesKey = CompanyTrendSeriesKey | DeptTrendSeriesKey;

export interface TrendSeriesPath {
  key: TrendSeriesKey;
  label: string;
  d: string;
  tone: 'ship' | 'quality' | 'debt' | 'morale' | 'fire' | 'ai';
  last: number;
  lastStatus?: GoalKpiProgress['status'];
  lastStatusLabel?: string;
}

export interface TrendDiagnosisCell {
  quarterNumber: number;
  diagnosis: DiagnosisType;
  label: string;
}

export interface TrendDeptSeries {
  deptId: string;
  name: string;
  series: TrendSeriesPath[];
}

export interface TrendHistoryView {
  empty: boolean;
  width: number;
  height: number;
  quarters: TrendDiagnosisCell[];
  series: TrendSeriesPath[];
  departments: TrendDeptSeries[];
}

const COMPANY_KPI_SERIES: readonly {
  key: CompanyTrendSeriesKey;
  fallbackLabel: string;
  tone: TrendSeriesPath['tone'];
}[] = [
  { key: 'delivery', fallbackLabel: '出荷', tone: 'ship' },
  { key: 'quality', fallbackLabel: '品質', tone: 'quality' },
  { key: 'techDebt', fallbackLabel: '負債', tone: 'debt' },
  { key: 'morale', fallbackLabel: '士気', tone: 'morale' },
  { key: 'incident', fallbackLabel: '炎上', tone: 'fire' },
  { key: 'aiAdoption', fallbackLabel: 'AI導入', tone: 'ai' },
];

const DEPT_SERIES: readonly {
  key: DeptTrendSeriesKey;
  label: string;
  tone: TrendSeriesPath['tone'];
}[] = [
  { key: 'aiDependency', label: 'AI依存', tone: 'ai' },
  { key: 'techDebt', label: '負債', tone: 'debt' },
  { key: 'morale', label: '士気', tone: 'morale' },
];

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 36;
const PAD = { left: 4, right: 4, top: 4, bottom: 4 };

function deptName(deptId: string, names?: Readonly<Record<string, string>>): string {
  if (names?.[deptId]) return names[deptId];
  return DEPARTMENT_DEFS.find((def) => def.id === deptId)?.name ?? deptId;
}

function polyline(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const yOf = (value: number): number =>
    span === 0 ? PAD.top + innerH / 2 : PAD.top + innerH - ((value - min) / span) * innerH;
  if (values.length === 1) {
    const y = yOf(values[0]!);
    const x = PAD.left + innerW / 2;
    return `M ${(x - 4).toFixed(2)},${y.toFixed(2)} L ${(x + 4).toFixed(2)},${y.toFixed(2)}`;
  }
  const xSpan = values.length - 1;
  const points = values.map((value, index) => {
    const x = PAD.left + (index / xSpan) * innerW;
    return `${x.toFixed(2)},${yOf(value).toFixed(2)}`;
  });
  return `M ${points.join(' L ')}`;
}

function seriesFrom(
  values: readonly number[],
  def: { key: TrendSeriesKey; label: string; tone: TrendSeriesPath['tone'] },
  width: number,
  height: number,
  lastKpi?: GoalKpiProgress,
): TrendSeriesPath {
  return {
    key: def.key,
    label: lastKpi?.label ?? def.label,
    d: polyline(values, width, height),
    tone: def.tone,
    last: values[values.length - 1] ?? 0,
    ...(lastKpi
      ? { lastStatus: lastKpi.status, lastStatusLabel: KPI_STATUS_LABELS[lastKpi.status] }
      : {}),
  };
}

function kpiOf(
  entry: QuarterTrendSnapshot,
  id: CompanyTrendSeriesKey,
): GoalKpiProgress | undefined {
  return entry.kpis.find((kpi) => kpi.id === id);
}

export interface PlanTrendHistoryOptions {
  width?: number;
  height?: number;
  departmentNames?: Readonly<Record<string, string>>;
}

/** 完了四半期の履歴からスパークライン計画を導出する。 */
export function planTrendHistory(
  history: readonly QuarterTrendSnapshot[],
  options: PlanTrendHistoryOptions = {},
): TrendHistoryView {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  if (history.length === 0) {
    return { empty: true, width, height, quarters: [], series: [], departments: [] };
  }

  const quarters = history.map((entry) => ({
    quarterNumber: entry.quarterNumber,
    diagnosis: entry.diagnosis,
    label: diagnosisView(entry.diagnosis).label,
  }));

  const series = COMPANY_KPI_SERIES.flatMap((def) => {
    const recorded = history
      .map((entry) => kpiOf(entry, def.key))
      .filter((kpi): kpi is GoalKpiProgress => kpi !== undefined);
    if (recorded.length === 0) return [];
    return [
      seriesFrom(
        recorded.map((kpi) => kpi.actual),
        { key: def.key, label: def.fallbackLabel, tone: def.tone },
        width,
        height,
        recorded[recorded.length - 1],
      ),
    ];
  });

  const deptIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of history) {
    for (const dept of entry.departments) {
      if (seen.has(dept.deptId)) continue;
      seen.add(dept.deptId);
      deptIds.push(dept.deptId);
    }
  }

  const departments = deptIds.map((deptId) => ({
    deptId,
    name: deptName(deptId, options.departmentNames),
    series: DEPT_SERIES.map((def) =>
      seriesFrom(
        history.map(
          (entry) => entry.departments.find((dept) => dept.deptId === deptId)?.[def.key] ?? 0,
        ),
        def,
        width,
        height,
      ),
    ),
  }));

  return { empty: false, width, height, quarters, series, departments };
}
