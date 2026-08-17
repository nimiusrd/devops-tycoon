/**
 * 全社マップの部門横並び比較（RI-125）。
 *
 * `DepartmentState` の現在スナップショットを読むだけの純関数。
 * 出荷・炎上・レビュー耐性は既存チップの正とし、ここでは複製しない。
 */
import type { DepartmentState, TeamHealth } from '../sim/orgscale/types';
import { HEALTH_LABEL } from './orgView';

export type OrgDeptCompareMetric = 'aiDependency' | 'techDebt' | 'morale' | 'health';

export type OrgDeptCompareTone = 'good' | 'warn' | 'bad';

export interface OrgDeptCompareColumn {
  key: OrgDeptCompareMetric;
  label: string;
}

export interface OrgDeptCompareCell {
  key: OrgDeptCompareMetric;
  value: string;
  tone?: OrgDeptCompareTone;
  health?: TeamHealth;
}

export interface OrgDeptCompareRow {
  deptId: string;
  name: string;
  color: string;
  cells: OrgDeptCompareCell[];
}

export interface OrgDeptCompareView {
  columns: OrgDeptCompareColumn[];
  rows: OrgDeptCompareRow[];
}

/** 比較表の列（チップに無い指標だけ）。 */
export const ORG_DEPT_COMPARE_COLUMNS: readonly OrgDeptCompareColumn[] = [
  { key: 'aiDependency', label: 'AI依存度' },
  { key: 'techDebt', label: '技術的負債' },
  { key: 'morale', label: '士気' },
  { key: 'health', label: '健全度' },
];

function healthTone(health: TeamHealth): OrgDeptCompareTone {
  if (health === 'reviewHell') return 'bad';
  if (health === 'congested') return 'warn';
  return 'good';
}

/** 部門スナップショットから比較表の行を導出する。値は丸め直さない。 */
export function planOrgDeptComparison(departments: readonly DepartmentState[]): OrgDeptCompareView {
  return {
    columns: [...ORG_DEPT_COMPARE_COLUMNS],
    rows: departments.map((dept) => ({
      deptId: dept.def.id,
      name: dept.def.name,
      color: dept.def.color,
      cells: [
        {
          key: 'aiDependency',
          value: String(dept.aiDependency),
          tone: dept.aiDependency >= 70 ? 'warn' : undefined,
        },
        {
          key: 'techDebt',
          value: String(dept.techDebt),
        },
        {
          key: 'morale',
          value: String(dept.morale),
        },
        {
          key: 'health',
          value: HEALTH_LABEL[dept.health],
          tone: healthTone(dept.health),
          health: dept.health,
        },
      ],
    })),
  };
}
