/**
 * 全社マップの診断・KPI時系列（RI-128 / RI-135）。
 *
 * 全社系列を維持し、部門系列だけを表示ローカルな指標タブで絞り込む。
 */
import { useMemo, useState } from 'react';
import {
  DEPT_TREND_METRICS,
  planTrendHistory,
  type DeptTrendMetricSelection,
} from '../render/trendHistoryView';
import type { QuarterTrendSnapshot } from '../sim/run/types';

export interface OrgTrendHistoryProps {
  history: readonly QuarterTrendSnapshot[];
  departmentNames?: Readonly<Record<string, string>>;
}

export function OrgTrendHistory({ history, departmentNames }: OrgTrendHistoryProps) {
  const [departmentMetric, setDepartmentMetric] = useState<DeptTrendMetricSelection>('all');
  const view = useMemo(
    () => planTrendHistory(history, { departmentNames, departmentMetric }),
    [departmentMetric, departmentNames, history],
  );

  return (
    <section className="org-trend-section" aria-labelledby="org-trend-heading">
      <h3 id="org-trend-heading">四半期トレンド</h3>
      {view.empty ? (
        <p className="org-trend-empty" data-testid="org-trend-history">
          記録なし
        </p>
      ) : (
        <div className="org-trend" data-testid="org-trend-history">
          <ol className="org-trend-diagnosis" data-testid="org-trend-diagnosis">
            {view.quarters.map((quarter) => (
              <li
                key={quarter.quarterNumber}
                className={`org-trend-diag diag-${quarter.diagnosis}`}
                data-testid={`org-trend-q${quarter.quarterNumber}`}
                data-diagnosis={quarter.diagnosis}
              >
                <span className="org-trend-q">Q{quarter.quarterNumber}</span>
                <span>{quarter.label}</span>
              </li>
            ))}
          </ol>
          <ul className="org-trend-series" data-testid="org-trend-company">
            {view.series.map((series) => (
              <li key={series.key} className={`org-trend-metric tone-${series.tone}`}>
                <span className="org-trend-label">{series.label}</span>
                <svg
                  className="org-trend-svg"
                  viewBox={`0 0 ${view.width} ${view.height}`}
                  role="img"
                  aria-label={`${series.label} ${series.last}`}
                  data-testid={`org-trend-series-${series.key}`}
                >
                  <path className={`trend-series series-${series.tone}`} d={series.d} fill="none" />
                </svg>
                <span className="org-trend-last">
                  {series.last}
                  {series.lastStatusLabel ? (
                    <span className={`org-trend-status kpi-${series.lastStatus}`}>
                      {series.lastStatusLabel}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="org-trend-dept-head">
            <span>部門トレンド</span>
            <div
              className="org-dashboard-tabs org-dashboard-metric-tabs"
              data-testid="org-trend-metric-tabs"
              role="tablist"
              aria-label="部門トレンド指標"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view.departmentMetric === 'all'}
                className={view.departmentMetric === 'all' ? 'active' : undefined}
                data-testid="org-trend-metric-all"
                onClick={() => setDepartmentMetric('all')}
              >
                すべて
              </button>
              {DEPT_TREND_METRICS.map((metric) => (
                <button
                  type="button"
                  key={metric.key}
                  role="tab"
                  aria-selected={view.departmentMetric === metric.key}
                  className={view.departmentMetric === metric.key ? 'active' : undefined}
                  data-testid={`org-trend-metric-${metric.key}`}
                  onClick={() => setDepartmentMetric(metric.key)}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="org-trend-depts" data-testid="org-trend-depts">
            {view.departments.map((dept) => (
              <li key={dept.deptId} data-testid={`org-trend-dept-${dept.deptId}`}>
                <span className="org-trend-dept-name">{dept.name}</span>
                <span className="org-trend-dept-content">
                  {dept.series.length > 0 ? (
                    <span className="org-trend-dept-series">
                      {dept.series.map((series) => (
                        <span
                          key={series.key}
                          className={`org-trend-dept-metric tone-${series.tone}`}
                        >
                          <span className="org-trend-dept-label">{series.label}</span>
                          <svg
                            className="org-trend-svg org-trend-svg-mini"
                            viewBox={`0 0 ${view.width} ${view.height}`}
                            role="img"
                            aria-label={`${dept.name} ${series.label} ${series.last}`}
                            data-testid={`org-trend-dept-${dept.deptId}-${series.key}`}
                          >
                            <path
                              className={`trend-series series-${series.tone}`}
                              d={series.d}
                              fill="none"
                            />
                          </svg>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {dept.healthHistory.length > 0 ? (
                    <span
                      className="org-trend-dept-health"
                      data-testid={`org-trend-dept-${dept.deptId}-health`}
                    >
                      {dept.healthHistory.map((cell) => (
                        <span
                          key={cell.quarterNumber}
                          className="org-trend-health-badge"
                          data-health={cell.health}
                          title={`Q${cell.quarterNumber} ${cell.label}`}
                        >
                          <b>Q{cell.quarterNumber}</b> {cell.label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
