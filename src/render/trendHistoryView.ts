/**
 * 全社マップの診断・KPI時系列表示（RI-128）。
 *
 * `trendHistory` を読むだけの純関数。Recharts は使わない（第22.2）。
 * レビュー結果履歴（RI-126）と部門現在値比較（RI-125）は扱わない。
 */
import { DEPARTMENT_DEFS } from '../data/departments';
import { diagnosisView } from '../sim/diagnosis';
import type { DiagnosisType, QuarterTrendSnapshot } from '../sim/run/types';

export type TrendSeriesKey = 'shipping' | 'aiDependency' | 'techDebt' | 'morale';
export type DeptTrendSeriesKey = Exclude<TrendSeriesKey, 'shipping'>;

export interface TrendSeriesPath {
  key: TrendSeriesKey;
  label: string;
  d: string;
  tone: 'ship' | 'ai' | 'debt' | 'morale';
  last: number;
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

const COMPANY_SERIES: readonly {
  key: TrendSeriesKey;
  label: string;
  tone: TrendSeriesPath['tone'];
}[] = [
  { key: 'shipping', label: '出荷', tone: 'ship' },
  { key: 'aiDependency', label: 'AI依存', tone: 'ai' },
  { key: 'techDebt', label: '負債', tone: 'debt' },
  { key: 'morale', label: '士気', tone: 'morale' },
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
  const xSpan = Math.max(1, values.length - 1);
  const points = values.map((value, index) => {
    const x = PAD.left + (index / xSpan) * innerW;
    const y =
      span === 0 ? PAD.top + innerH / 2 : PAD.top + innerH - ((value - min) / span) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M ${points.join(' L ')}`;
}

function seriesFrom(
  values: readonly number[],
  def: { key: TrendSeriesKey; label: string; tone: TrendSeriesPath['tone'] },
  width: number,
  height: number,
): TrendSeriesPath {
  return {
    key: def.key,
    label: def.label,
    d: polyline(values, width, height),
    tone: def.tone,
    last: values[values.length - 1] ?? 0,
  };
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

  const series = COMPANY_SERIES.map((def) =>
    seriesFrom(
      history.map((entry) => entry.company[def.key]),
      def,
      width,
      height,
    ),
  );

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
