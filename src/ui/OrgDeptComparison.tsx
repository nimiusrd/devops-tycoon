/**
 * 全社マップの部門／チーム比較表（RI-125 / RI-135）。
 *
 * 単位・指標の選択は表示ローカル状態に留め、値の導出は純関数へ任せる。
 */
import { useMemo, useState } from 'react';
import {
  normalizeOrgCompareMetric,
  ORG_COMPARISON_UNIT_LABELS,
  orgCompareColumns,
  planOrgDeptComparison,
  type OrgCompareMetricSelection,
  type OrgComparisonUnit,
} from '../render/orgDeptComparison';
import type { DepartmentState } from '../sim/orgscale/types';

export interface OrgDeptComparisonProps {
  departments: readonly DepartmentState[];
  onFocusDept: (id: string) => void;
  onFocusTeam: (id: string) => void;
}

const UNITS: readonly OrgComparisonUnit[] = ['department', 'team'];

export function OrgDeptComparison({
  departments,
  onFocusDept,
  onFocusTeam,
}: OrgDeptComparisonProps) {
  const [unit, setUnit] = useState<OrgComparisonUnit>('department');
  const [metric, setMetric] = useState<OrgCompareMetricSelection>('all');
  const view = useMemo(
    () => planOrgDeptComparison(departments, { unit, metric }),
    [departments, metric, unit],
  );
  const metricOptions = orgCompareColumns(unit);

  const selectUnit = (nextUnit: OrgComparisonUnit) => {
    setUnit(nextUnit);
    setMetric((current) => normalizeOrgCompareMetric(nextUnit, current));
  };

  return (
    <section className="org-dept-compare-section" aria-labelledby="org-dept-compare-heading">
      <div className="org-dashboard-heading">
        <h3 id="org-dept-compare-heading">部門・チーム比較</h3>
        <div
          className="org-dashboard-tabs"
          data-testid="org-compare-unit-tabs"
          role="tablist"
          aria-label="比較単位"
        >
          {UNITS.map((option) => (
            <button
              type="button"
              key={option}
              role="tab"
              aria-selected={unit === option}
              className={unit === option ? 'active' : undefined}
              data-testid={`org-compare-unit-${option}`}
              onClick={() => selectUnit(option)}
            >
              {ORG_COMPARISON_UNIT_LABELS[option]}
            </button>
          ))}
        </div>
        <div
          className="org-dashboard-tabs org-dashboard-metric-tabs"
          data-testid="org-compare-metric-tabs"
          role="tablist"
          aria-label="比較指標"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view.metric === 'all'}
            className={view.metric === 'all' ? 'active' : undefined}
            data-testid="org-compare-metric-all"
            onClick={() => setMetric('all')}
          >
            すべて
          </button>
          {metricOptions.map((option) => (
            <button
              type="button"
              key={option.key}
              role="tab"
              aria-selected={view.metric === option.key}
              className={view.metric === option.key ? 'active' : undefined}
              data-testid={`org-compare-metric-${option.key}`}
              onClick={() => setMetric(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="org-dept-compare-scroll">
        <table className="org-dept-compare" data-testid="org-dept-compare">
          <thead>
            <tr>
              <th>{view.unit === 'team' ? 'チーム' : '部門'}</th>
              {view.columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const targetId = row.teamId ?? row.deptId;
              const testPrefix = row.unit === 'team' ? 'org-team' : 'org-dept';
              return (
                <tr key={`${row.unit}-${targetId}`} data-testid={`${testPrefix}-row-${targetId}`}>
                  <th scope="row">
                    <button
                      type="button"
                      className="org-dept-compare-name"
                      data-testid={`${testPrefix}-focus-${targetId}`}
                      style={{ borderColor: row.color }}
                      onClick={() =>
                        row.teamId ? onFocusTeam(row.teamId) : onFocusDept(row.deptId)
                      }
                      title={row.teamId ? 'チームの状態を見る' : '部署ビューへ寄る'}
                    >
                      <span>{row.name}</span>
                      {row.groupLabel ? <small>{row.groupLabel}</small> : null}
                    </button>
                  </th>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.key}
                      className={cell.tone ? `tone-${cell.tone}` : undefined}
                      data-testid={`${testPrefix}-${targetId}-${cell.key}`}
                      data-health={cell.health}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
