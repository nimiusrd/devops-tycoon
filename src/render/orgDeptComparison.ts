/**
 * 全社マップの部門／チーム横断比較（RI-125 / RI-135）。
 *
 * `DepartmentState` の現在スナップショットを読むだけの純関数。
 * 初期値の部門比較は RI-125 の4指標を保ち、RI-135 でチーム単位と指標切替を足す。
 */
import type { DepartmentState, Team, TeamHealth } from '../sim/orgscale/types';
import { HEALTH_LABEL } from './orgView';

export type OrgComparisonUnit = 'department' | 'team';
export type OrgDeptCompareMetric = 'aiDependency' | 'techDebt' | 'morale' | 'health';
export type OrgTeamCompareMetric = 'shipping' | 'reviewQueue' | 'incidents' | OrgDeptCompareMetric;
export type OrgCompareMetric = OrgTeamCompareMetric;
export type OrgCompareMetricSelection = 'all' | OrgCompareMetric;

export type OrgDeptCompareTone = 'good' | 'warn' | 'bad';

export interface OrgDeptCompareColumn {
  key: OrgCompareMetric;
  label: string;
}

export interface OrgDeptCompareCell {
  key: OrgCompareMetric;
  value: string;
  tone?: OrgDeptCompareTone;
  health?: TeamHealth;
}

export interface OrgDeptCompareRow {
  unit: OrgComparisonUnit;
  /** 部門行の対象ID、またはチームが所属する部門ID。 */
  deptId: string;
  /** チーム行だけが持つ対象ID。 */
  teamId?: string;
  name: string;
  /** チーム行で所属先を補足する表示名。 */
  groupLabel?: string;
  color: string;
  cells: OrgDeptCompareCell[];
}

export interface OrgDeptCompareView {
  unit: OrgComparisonUnit;
  metric: OrgCompareMetricSelection;
  columns: OrgDeptCompareColumn[];
  rows: OrgDeptCompareRow[];
}

export interface PlanOrgDeptComparisonOptions {
  unit?: OrgComparisonUnit;
  metric?: OrgCompareMetricSelection;
}

/** 比較表の部門列（既存チップに無い指標だけ）。 */
export const ORG_DEPT_COMPARE_COLUMNS: readonly OrgDeptCompareColumn[] = [
  { key: 'aiDependency', label: 'AI依存度' },
  { key: 'techDebt', label: '技術的負債' },
  { key: 'morale', label: '士気' },
  { key: 'health', label: '健全度' },
];

/** チームを横断診断する列。部門順・部門内チーム順は入力順を維持する。 */
export const ORG_TEAM_COMPARE_COLUMNS: readonly OrgDeptCompareColumn[] = [
  { key: 'shipping', label: '出荷' },
  { key: 'reviewQueue', label: 'レビュー待ち' },
  { key: 'incidents', label: '炎上' },
  ...ORG_DEPT_COMPARE_COLUMNS,
];

export const ORG_COMPARISON_UNIT_LABELS: Readonly<Record<OrgComparisonUnit, string>> = {
  department: '部門',
  team: 'チーム',
};

function healthTone(health: TeamHealth): OrgDeptCompareTone {
  if (health === 'reviewHell') return 'bad';
  if (health === 'congested') return 'warn';
  return 'good';
}

export function orgCompareColumns(unit: OrgComparisonUnit): readonly OrgDeptCompareColumn[] {
  return unit === 'team' ? ORG_TEAM_COMPARE_COLUMNS : ORG_DEPT_COMPARE_COLUMNS;
}

/** 単位に無い指標は「すべて」へ戻す。UIと純関数で同じ契約を使う。 */
export function normalizeOrgCompareMetric(
  unit: OrgComparisonUnit,
  metric: OrgCompareMetricSelection,
): OrgCompareMetricSelection {
  if (metric === 'all') return metric;
  return orgCompareColumns(unit).some((column) => column.key === metric) ? metric : 'all';
}

function commonCells(input: {
  aiDependency: number;
  techDebt: number;
  morale: number;
  health: TeamHealth;
}): OrgDeptCompareCell[] {
  return [
    {
      key: 'aiDependency',
      value: String(input.aiDependency),
      tone: input.aiDependency >= 70 ? 'warn' : undefined,
    },
    { key: 'techDebt', value: String(input.techDebt) },
    { key: 'morale', value: String(input.morale) },
    {
      key: 'health',
      value: HEALTH_LABEL[input.health],
      tone: healthTone(input.health),
      health: input.health,
    },
  ];
}

function departmentRows(departments: readonly DepartmentState[]): OrgDeptCompareRow[] {
  return departments.map((dept) => ({
    unit: 'department',
    deptId: dept.def.id,
    name: dept.def.name,
    color: dept.def.color,
    cells: commonCells(dept),
  }));
}

function teamCells(team: Team): OrgDeptCompareCell[] {
  return [
    { key: 'shipping', value: String(team.shipping) },
    { key: 'reviewQueue', value: String(team.reviewQueue) },
    {
      key: 'incidents',
      value: String(team.incidents),
      tone: team.incidents > 0 ? 'bad' : 'good',
    },
    ...commonCells(team),
  ];
}

function teamRows(departments: readonly DepartmentState[]): OrgDeptCompareRow[] {
  return departments.flatMap((dept) =>
    dept.teams.map((team) => ({
      unit: 'team' as const,
      deptId: dept.def.id,
      teamId: team.id,
      name: team.name,
      groupLabel: dept.def.name,
      color: dept.def.color,
      cells: teamCells(team),
    })),
  );
}

/** 現在スナップショットから比較表を導出する。値の丸め直しや並べ替えはしない。 */
export function planOrgDeptComparison(
  departments: readonly DepartmentState[],
  options: PlanOrgDeptComparisonOptions = {},
): OrgDeptCompareView {
  const unit = options.unit ?? 'department';
  const metric = normalizeOrgCompareMetric(unit, options.metric ?? 'all');
  const columns = orgCompareColumns(unit).filter(
    (column) => metric === 'all' || column.key === metric,
  );
  const rows = unit === 'team' ? teamRows(departments) : departmentRows(departments);
  const visibleKeys = new Set(columns.map((column) => column.key));
  return {
    unit,
    metric,
    columns: [...columns],
    rows: rows.map((row) => ({
      ...row,
      cells: row.cells.filter((cell) => visibleKeys.has(cell.key)),
    })),
  };
}
