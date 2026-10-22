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
  LabelList,
  Legend,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  useActiveTooltipDataPoints,
  XAxis,
  YAxis,
  type BarShapeProps,
  type LabelProps,
} from 'recharts';
import {
  planBaselineComparison,
  type BaselineComparisonView,
} from '../render/sprintBaselineComparison';
import type { SprintResult } from '../sim/types';
import { VISUAL_TOKENS } from '../render/visualTokens';

const BASELINE_FILL = VISUAL_TOKENS.colors.chart.baseline;
const ACTUAL_FILL = VISUAL_TOKENS.colors.mint;

interface ComparisonDatum {
  name: string;
  baseline: number;
  actual: number;
  baselineLabel: string;
  actualLabel: string;
}

export interface BaselineComparisonChartProps {
  result: SprintResult;
}

function chartData(result: SprintResult, view: BaselineComparisonView): ComparisonDatum[] {
  const baseline = result.baseline;
  if (!baseline) return [];
  const values = {
    delivered: { baseline: baseline.delivered, actual: result.delivered },
    spread: { baseline: baseline.spread, actual: result.spread },
    maxCombo: { baseline: baseline.maxCombo, actual: result.maxCombo },
  };
  return view.rows.map((row) => ({
    name: row.label,
    ...values[row.key],
    baselineLabel: row.baseline,
    actualLabel: row.actual,
  }));
}

/** マウス・タッチ・キーボードのすべてで、Tooltip と同じ項目を強調する。 */
function ComparisonBar({ payload, ...props }: Partial<BarShapeProps>) {
  const activeRows = useActiveTooltipDataPoints<ComparisonDatum>();
  const dimmed =
    activeRows != null &&
    activeRows.length > 0 &&
    !activeRows.some((row) => row.name === payload?.name);
  return <Rectangle {...props} data-row={payload?.name} fillOpacity={dimmed ? 0.45 : 1} />;
}

/** SVG の text を直接使い、狭幅でも「最大コンボ」などを途中で改行しない。 */
function CategoryTick({
  x,
  y,
  payload,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
}) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" className="result-baseline-axis-label">
      {payload?.value}
    </text>
  );
}

/** 単位まで一つの text に保持し、Recharts のバー幅による自動改行を避ける。 */
function ComparisonValueLabel({ viewBox, value }: LabelProps) {
  if (!viewBox || !('x' in viewBox)) return null;
  return (
    <text
      x={viewBox.x + viewBox.width + 6}
      y={viewBox.y + viewBox.height / 2}
      dominantBaseline="central"
      className="result-baseline-bar-label"
    >
      {value}
    </text>
  );
}

function ComparisonTooltip({
  active,
  label,
  view,
}: {
  active?: boolean;
  label?: string | number;
  view: BaselineComparisonView;
}) {
  const row = view.rows.find((candidate) => candidate.label === label);
  if (!active || !row) return null;
  return (
    <div className="result-baseline-tooltip">
      <p className="result-baseline-tooltip-label">{row.label}</p>
      <p className="result-baseline-tooltip-baseline">介入なし: {row.baseline}</p>
      <p className="result-baseline-tooltip-actual">実績: {row.actual}</p>
    </div>
  );
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

  const data = chartData(result, view);

  return (
    <div className="result-baseline-comparison" data-testid="result-baseline-comparison">
      <p className="result-section-label">介入の成果</p>
      <p className="result-baseline-caption">介入なしの見込み → 実績</p>
      <div className="result-baseline-chart" data-testid="result-baseline-chart">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 64, left: 0, bottom: 0 }}
            aria-label="介入の成果 比較グラフ"
          >
            <CartesianGrid
              stroke={VISUAL_TOKENS.colors.line}
              strokeDasharray="3 3"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: VISUAL_TOKENS.colors.textDim, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={<CategoryTick />}
              interval={0}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip
              cursor={{ fill: VISUAL_TOKENS.colors.chart.hoverBand }}
              content={<ComparisonTooltip view={view} />}
            />
            <Legend />
            <Bar
              dataKey="baseline"
              name="介入なし"
              fill={BASELINE_FILL}
              radius={[0, 4, 4, 0]}
              maxBarSize={36}
              shape={<ComparisonBar />}
            >
              <LabelList dataKey="baselineLabel" content={<ComparisonValueLabel />} />
            </Bar>
            <Bar
              dataKey="actual"
              name="実績"
              fill={ACTUAL_FILL}
              radius={[0, 4, 4, 0]}
              maxBarSize={36}
              shape={<ComparisonBar />}
            >
              <LabelList dataKey="actualLabel" content={<ComparisonValueLabel />} />
            </Bar>
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
