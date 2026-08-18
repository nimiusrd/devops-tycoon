/**
 * 全社マップの部門比較表（RI-125）。
 *
 * チップに無い AI依存・負債・士気・健全度を横並びにする。行の部門名から部署ビューへ寄る。
 * 数値導出は `planOrgDeptComparison` に任せ、状態は読むだけ（第22.2）。
 */
import { useMemo } from 'react';
import { planOrgDeptComparison } from '../render/orgDeptComparison';
import type { DepartmentState } from '../sim/orgscale/types';

export interface OrgDeptComparisonProps {
  departments: readonly DepartmentState[];
  onFocusDept: (id: string) => void;
}

export function OrgDeptComparison({ departments, onFocusDept }: OrgDeptComparisonProps) {
  const view = useMemo(() => planOrgDeptComparison(departments), [departments]);

  return (
    <section className="org-dept-compare-section" aria-labelledby="org-dept-compare-heading">
      <h3 id="org-dept-compare-heading">部門比較</h3>
      <div className="org-dept-compare-scroll">
        <table className="org-dept-compare" data-testid="org-dept-compare">
          <thead>
            <tr>
              <th>部門</th>
              {view.columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.deptId} data-testid={`org-dept-row-${row.deptId}`}>
                <th scope="row">
                  <button
                    type="button"
                    className="org-dept-compare-name"
                    data-testid={`org-dept-focus-${row.deptId}`}
                    style={{ borderColor: row.color }}
                    onClick={() => onFocusDept(row.deptId)}
                    title="部署ビューへ寄る"
                  >
                    {row.name}
                  </button>
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.key}
                    className={cell.tone ? `tone-${cell.tone}` : undefined}
                    data-testid={`org-dept-${row.deptId}-${cell.key}`}
                    data-health={cell.health}
                  >
                    {cell.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
