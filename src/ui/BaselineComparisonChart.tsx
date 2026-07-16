/**
 * 介入なしベースライン vs 実績の grouped bar（RI-13 / RI-55）。
 *
 * 数値導出は `planBaselineComparison` に任せ、見た目だけ Recharts に置き換える。
 * 既存 E2E testid とアクセシブルな数値テキストは維持する。
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  planBaselineComparison,
  type BaselineComparisonView,
} from '../render/sprintBaselineComparison';
import type { SprintResult } from '../sim/types';

const BASELINE_FILL = '#8aa4c0';
const ACTUAL_FILL = '#58e0b0';

export interface BaselineComparisonChartProps {
  result: SprintResult;
}

function chartData(result: SprintResult): { name: string; baseline: number; actual: number }[] {
  const baseline = result.baseline;
  if (!baseline) return [];
  return [
    { name: '出荷', baseline: baseline.delivered, actual: result.delivered },
    { name: '延焼', baseline: baseline.spread, actual: result.spread },
    { name: 'Max Combo', baseline: baseline.maxCombo, actual: result.maxCombo },
  ];
}

function BaselineRows({ view }: { view: BaselineComparisonView }) {
  return (
    <dl className="result-rows result-baseline-rows">
      {view.rows.map((row) => (
        <div
          className="result-row result-baseline-row"
          data-testid={`result-baseline-row-${row.key}`}
          key={row.key}
        >
          <dt>{row.label}</dt>
          <dd>
            <span className="result-baseline-values">
              {row.baseline} → {row.actual}
            </span>
            <strong className={`result-baseline-delta baseline-delta-${row.tone}`}>
              {row.delta}
            </strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function BaselineComparisonChart({ result }: BaselineComparisonChartProps) {
  const view = planBaselineComparison(result);
  if (!view.showSection || !result.baseline) return null;

  const data = chartData(result);

  return (
    <div className="result-baseline-comparison" data-testid="result-baseline-comparison">
      <p className="result-section-label">介入の成果</p>
      <p className="result-baseline-caption">介入なしの見込み → 実績</p>
      <div className="result-baseline-chart" data-testid="result-baseline-chart">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid
              stroke="rgba(179, 157, 255, 0.2)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: '#b9add0', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#b9add0', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1b1438',
                border: '1px solid rgba(179, 157, 255, 0.35)',
                borderRadius: 8,
                color: '#fdf6ec',
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#b9add0' }}
              formatter={(value) => (value === 'baseline' ? '介入なし' : '実績')}
            />
            <Bar dataKey="baseline" fill={BASELINE_FILL} radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="actual" fill={ACTUAL_FILL} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <BaselineRows view={view} />
      <p className="result-baseline-disclaimer" data-testid="result-baseline-disclaimer">
        {view.disclaimer}
      </p>
    </div>
  );
}
