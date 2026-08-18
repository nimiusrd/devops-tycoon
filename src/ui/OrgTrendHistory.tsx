/**
 * 全社マップの診断・KPI時系列（RI-128）。
 *
 * `planTrendHistory` の純関数結果を自前 SVG で描画する（Recharts なし）。
 * 状態は読むだけ（第22.2）。部門現在値比較とレビュー結果履歴は扱わない。
 */
import { useMemo } from 'react';
import { planTrendHistory } from '../render/trendHistoryView';
import type { QuarterTrendSnapshot } from '../sim/run/types';

export interface OrgTrendHistoryProps {
  history: readonly QuarterTrendSnapshot[];
  departmentNames?: Readonly<Record<string, string>>;
}

export function OrgTrendHistory({ history, departmentNames }: OrgTrendHistoryProps) {
  const view = useMemo(
    () => planTrendHistory(history, { departmentNames }),
    [history, departmentNames],
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
                <span className="org-trend-last">{series.last}</span>
              </li>
            ))}
          </ul>
          <ul className="org-trend-depts" data-testid="org-trend-depts">
            {view.departments.map((dept) => (
              <li key={dept.deptId} data-testid={`org-trend-dept-${dept.deptId}`}>
                <span className="org-trend-dept-name">{dept.name}</span>
                <span className="org-trend-dept-series">
                  {dept.series.map((series) => (
                    <svg
                      key={series.key}
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
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
