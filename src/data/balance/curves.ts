import { incidentProbability, reworkProbability } from '../../sim/model';
import type { OrgState, Task } from '../../sim/types';

/** 代表曲線の入力範囲とサンプル間隔。生成は決定論的で、0 から 100 まで 1 刻み。 */
export const BALANCE_CURVE_INPUT_MIN = 0;
export const BALANCE_CURVE_INPUT_MAX = 100;
export const BALANCE_CURVE_SAMPLE_STEP = 1;
export const BALANCE_CURVE_MARKER_INPUTS = [0, 25, 50, 75, 100] as const;

/**
 * probability-model.md §4.5 と同じ代表条件。
 * Security 水準 60 は脆弱度閾値以上なので Incident 加算は 0 になる。
 */
export const BALANCE_CURVE_REPRESENTATIVE = {
  aiLiteracy: 45,
  quality: 60,
  securityLevel: 60,
  reworkAttempts: 0,
} as const;

export interface RepresentativeCurvePoint {
  readonly input: number;
  readonly reworkAi: number;
  readonly reworkNoAi: number;
  readonly incidentAi: number;
  readonly incidentNoAi: number;
}

function representativeOrg(overrides: Partial<OrgState> = {}): OrgState {
  return {
    aiEnabled: true,
    aiDependency: 0,
    aiLiteracy: BALANCE_CURVE_REPRESENTATIVE.aiLiteracy,
    testCoverage: 0,
    documentation: 0,
    quality: BALANCE_CURVE_REPRESENTATIVE.quality,
    securityLevel: BALANCE_CURVE_REPRESENTATIVE.securityLevel,
    morale: 0,
    seniorHp: 100,
    techDebt: 0,
    deliveryScore: 0,
    ...overrides,
  };
}

function representativeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'review',
    progress: 0,
    reworkAttempts: BALANCE_CURVE_REPRESENTATIVE.reworkAttempts,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

/** 代表条件での Rework 確率。ゲーム式 `reworkProbability` をそのまま使う。 */
export function representativeReworkProbability(aiAssisted: boolean, aiDependency: number): number {
  return reworkProbability(representativeOrg({ aiDependency }), representativeTask({ aiAssisted }));
}

/** 代表条件での Incident 確率。ゲーム式 `incidentProbability` をそのまま使う。 */
export function representativeIncidentProbability(
  aiAssisted: boolean,
  testCoverage: number,
): number {
  return incidentProbability(
    representativeOrg({ testCoverage }),
    representativeTask({ aiAssisted }),
  );
}

function sampleInputs(): number[] {
  const inputs: number[] = [];
  for (
    let input = BALANCE_CURVE_INPUT_MIN;
    input <= BALANCE_CURVE_INPUT_MAX;
    input += BALANCE_CURVE_SAMPLE_STEP
  ) {
    inputs.push(input);
  }
  return inputs;
}

/** 代表曲線の全サンプル。SVG とテストが同じ点列を共有する。 */
export function sampleRepresentativeCurves(): readonly RepresentativeCurvePoint[] {
  return sampleInputs().map((input) => ({
    input,
    reworkAi: representativeReworkProbability(true, input),
    reworkNoAi: representativeReworkProbability(false, input),
    incidentAi: representativeIncidentProbability(true, input),
    incidentNoAi: representativeIncidentProbability(false, input),
  }));
}

export const BALANCE_CURVE_ENDPOINTS_BEGIN = '<!-- balance-curve-endpoints:begin -->';
export const BALANCE_CURVE_ENDPOINTS_END = '<!-- balance-curve-endpoints:end -->';

/** 端点表用のパーセント表記。1 桁以上の小数を保ち、末尾 0 は落とす。 */
export function formatEndpointPercent(probability: number): string {
  const pct = Math.round(probability * 10000) / 100;
  const body = pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0');
  return `${body}%`;
}

/** probability-model.md の読み取り値表。曲線と同じ純関数から作る。 */
export function renderBalanceCurveEndpointTable(): string {
  const span = (start: number, end: number): string =>
    `${formatEndpointPercent(start)} → ${formatEndpointPercent(end)}`;

  return [
    '| 入力 | 対象タスク: AI支援あり | 対象タスク: AI支援なし |',
    '| --- | ---: | ---: |',
    `| AI依存度 0 → 100でのRework確率 | ${span(representativeReworkProbability(true, 0), representativeReworkProbability(true, 100))} | ${span(representativeReworkProbability(false, 0), representativeReworkProbability(false, 100))} |`,
    `| Test Coverage 0 → 100でのIncident確率 | ${span(representativeIncidentProbability(true, 0), representativeIncidentProbability(true, 100))} | ${span(representativeIncidentProbability(false, 0), representativeIncidentProbability(false, 100))} |`,
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 人手の説明文はそのままに、端点表だけを生成内容で置き換える。 */
export function applyBalanceCurveEndpointsToMarkdown(markdown: string): string {
  const block = [
    BALANCE_CURVE_ENDPOINTS_BEGIN,
    renderBalanceCurveEndpointTable(),
    BALANCE_CURVE_ENDPOINTS_END,
  ].join('\n');
  const pattern = new RegExp(
    `${escapeRegExp(BALANCE_CURVE_ENDPOINTS_BEGIN)}[\\s\\S]*?${escapeRegExp(BALANCE_CURVE_ENDPOINTS_END)}`,
  );
  if (!pattern.test(markdown)) {
    throw new Error('probability-model.md に端点表の生成マーカーがありません。');
  }
  return markdown.replace(pattern, () => block);
}

interface PlotFrame {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface PlotBox extends PlotFrame {
  readonly maxProbability: number;
}

const REWORK_FRAME: PlotFrame = {
  left: 90,
  right: 455,
  top: 150,
  bottom: 380,
};

const INCIDENT_FRAME: PlotFrame = {
  left: 575,
  right: 940,
  top: 150,
  bottom: 380,
};

const REWORK_PREFERRED_TICKS = [0, 0.05, 0.15, 0.25, 0.35] as const;
const INCIDENT_PREFERRED_TICKS = [0, 0.04, 0.08, 0.12, 0.16] as const;

/** 代表点が既定上限を超えたときに使う、目盛りの取りやすい確率上限。 */
const NICE_PROBABILITY_MAXIMA = [
  0.08, 0.1, 0.12, 0.16, 0.2, 0.24, 0.25, 0.3, 0.32, 0.35, 0.4, 0.5, 0.6, 0.75, 1,
] as const;

export interface ProbabilityAxis {
  readonly max: number;
  readonly ticks: readonly number[];
}

/**
 * サンプル最大値に合わせて Y 軸上限と目盛りを決める。
 * 現行値では既定目盛りを保ち、超えたときだけ上限を広げる。
 */
export function chooseProbabilityAxis(
  sampleMax: number,
  preferredTicks: readonly number[],
): ProbabilityAxis {
  const preferredMax = preferredTicks[preferredTicks.length - 1];
  if (preferredMax === undefined || preferredTicks.length < 2) {
    throw new Error('Y軸の既定目盛りが不足しています。');
  }
  if (sampleMax <= preferredMax) {
    return { max: preferredMax, ticks: preferredTicks };
  }
  const max = NICE_PROBABILITY_MAXIMA.find((value) => value >= sampleMax) ?? 1;
  const lastIndex = preferredTicks.length - 1;
  const ticks = preferredTicks.map((_, index) => (max * index) / lastIndex);
  return { max, ticks };
}

function percentTickLabel(probability: number): string {
  const pct = Math.round(probability * 10000) / 100;
  return `${pct}%`;
}

function plotFromAxis(frame: PlotFrame, axis: ProbabilityAxis): PlotBox {
  return { ...frame, maxProbability: axis.max };
}

/** SVG 座標を固定小数へ丸め、生成を冪等にする。 */
export function formatCurveCoord(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function plotX(plot: PlotBox, input: number): number {
  const span = BALANCE_CURVE_INPUT_MAX - BALANCE_CURVE_INPUT_MIN;
  return plot.left + ((input - BALANCE_CURVE_INPUT_MIN) / span) * (plot.right - plot.left);
}

function plotY(plot: PlotBox, probability: number): number {
  return plot.bottom - (probability / plot.maxProbability) * (plot.bottom - plot.top);
}

function polylinePoints(
  plot: PlotBox,
  points: readonly RepresentativeCurvePoint[],
  probabilityOf: (point: RepresentativeCurvePoint) => number,
): string {
  return points
    .map(
      (point) =>
        `${formatCurveCoord(plotX(plot, point.input))},${formatCurveCoord(plotY(plot, probabilityOf(point)))}`,
    )
    .join(' ');
}

function markerCircles(
  plot: PlotBox,
  points: readonly RepresentativeCurvePoint[],
  probabilityOf: (point: RepresentativeCurvePoint) => number,
): string {
  const byInput = new Map(points.map((point) => [point.input, point]));
  return BALANCE_CURVE_MARKER_INPUTS.map((input) => {
    const point = byInput.get(input);
    if (!point) {
      throw new Error(`代表曲線のマーカー入力 ${input} がサンプルにありません。`);
    }
    return `      <circle cx="${formatCurveCoord(plotX(plot, input))}" cy="${formatCurveCoord(plotY(plot, probabilityOf(point)))}" r="5" />`;
  }).join('\n');
}

function yGrid(plot: PlotBox, ticks: readonly number[]): string {
  return ticks
    .map((probability) => {
      const y = formatCurveCoord(plotY(plot, probability));
      return `    <line class="grid" x1="${formatCurveCoord(plot.left)}" y1="${y}" x2="${formatCurveCoord(plot.right)}" y2="${y}" />`;
    })
    .join('\n');
}

function yLabels(plot: PlotBox, ticks: readonly { probability: number; label: string }[]): string {
  return ticks
    .map(({ probability, label }) => {
      const y = formatCurveCoord(plotY(plot, probability) + 5);
      return `    <text class="muted" x="${formatCurveCoord(plot.left - 12)}" y="${y}" font-size="12" text-anchor="end">${label}</text>`;
    })
    .join('\n');
}

function xLabels(plot: PlotBox, ticks: readonly number[]): string {
  return ticks
    .map((input) => {
      const x = formatCurveCoord(plotX(plot, input));
      return `    <text class="muted" x="${x}" y="402" font-size="12" text-anchor="middle">${input}</text>`;
    })
    .join('\n');
}

/**
 * 現行工程モデルの代表確率曲線 SVG。
 * 生成日時や実行環境の情報を含めず、同じ定義から常に同じ出力を得る。
 */
export function renderBalanceCurvesSvg(): string {
  const points = sampleRepresentativeCurves();
  const { aiLiteracy, quality } = BALANCE_CURVE_REPRESENTATIVE;
  const reworkAi = (point: RepresentativeCurvePoint) => point.reworkAi;
  const reworkNoAi = (point: RepresentativeCurvePoint) => point.reworkNoAi;
  const incidentAi = (point: RepresentativeCurvePoint) => point.incidentAi;
  const incidentNoAi = (point: RepresentativeCurvePoint) => point.incidentNoAi;
  const inputTicks = [...BALANCE_CURVE_MARKER_INPUTS];
  const reworkSampleMax = Math.max(
    ...points.map((point) => Math.max(point.reworkAi, point.reworkNoAi)),
  );
  const incidentSampleMax = Math.max(
    ...points.map((point) => Math.max(point.incidentAi, point.incidentNoAi)),
  );
  const reworkAxis = chooseProbabilityAxis(reworkSampleMax, REWORK_PREFERRED_TICKS);
  const incidentAxis = chooseProbabilityAxis(incidentSampleMax, INCIDENT_PREFERRED_TICKS);
  const reworkPlot = plotFromAxis(REWORK_FRAME, reworkAxis);
  const incidentPlot = plotFromAxis(INCIDENT_FRAME, incidentAxis);
  const reworkTickLabels = reworkAxis.ticks.map((probability) => ({
    probability,
    label: percentTickLabel(probability),
  }));
  const incidentTickLabels = incidentAxis.ticks.map((probability) => ({
    probability,
    label: percentTickLabel(probability),
  }));

  return [
    '<!-- このファイルは `npm run balance:docs` で生成されます。手動編集しないでください。 -->',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 520" role="img" aria-labelledby="title desc">',
    '  <title id="title">現行モデルのRework確率とIncident確率の代表曲線</title>',
    '  <desc id="desc">',
    '    左は組織の累積AI依存度が上がるとRework確率が上がる様子、右はテストカバレッジが上がるとIncident確率が下がる様子を、対象タスクのAI支援ありとなしで比較する。',
    '  </desc>',
    '  <style>',
    '    .bg { fill: #ffffff; }',
    '    .panel { fill: #f8fafc; stroke: #cbd5e1; }',
    '    .grid { stroke: #cbd5e1; stroke-width: 1; }',
    '    .axis { stroke: #64748b; stroke-width: 1.5; }',
    '    .text { fill: #334155; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '    .muted { fill: #64748b; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '    .ai { fill: none; stroke: #2563eb; stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; }',
    '    .no-ai { fill: none; stroke: #dc2626; stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; }',
    '    .ai-dot { fill: #2563eb; }',
    '    .no-ai-dot { fill: #dc2626; }',
    '    @media (prefers-color-scheme: dark) {',
    '      .bg { fill: #0f172a; }',
    '      .panel { fill: #111827; stroke: #475569; }',
    '      .grid { stroke: #334155; }',
    '      .axis { stroke: #94a3b8; }',
    '      .text { fill: #e2e8f0; }',
    '      .muted { fill: #94a3b8; }',
    '      .ai { stroke: #60a5fa; }',
    '      .no-ai { stroke: #f87171; }',
    '      .ai-dot { fill: #60a5fa; }',
    '      .no-ai-dot { fill: #f87171; }',
    '    }',
    '  </style>',
    '',
    '  <rect class="bg" width="1000" height="520" rx="16" />',
    '',
    '  <g aria-label="凡例">',
    '    <line class="ai" x1="210" y1="32" x2="250" y2="32" />',
    '    <circle class="ai-dot" cx="230" cy="32" r="5" />',
    '    <text class="text" x="260" y="38" font-size="16">対象タスク: AI支援あり</text>',
    '    <line class="no-ai" x1="560" y1="32" x2="600" y2="32" />',
    '    <circle class="no-ai-dot" cx="580" cy="32" r="5" />',
    '    <text class="text" x="610" y="38" font-size="16">対象タスク: AI支援なし</text>',
    '  </g>',
    '',
    '  <g aria-label="AI依存度とRework確率">',
    '    <rect class="panel" x="30" y="60" width="455" height="405" rx="12" />',
    '    <text class="text" x="257.5" y="91" font-size="20" font-weight="600" text-anchor="middle">AI依存度とRework確率</text>',
    `    <text class="muted" x="257.5" y="116" font-size="13" text-anchor="middle">AI Literacy ${aiLiteracy} / Quality ${quality} / 初回Review / 補正なし</text>`,
    '',
    yGrid(reworkPlot, [...reworkAxis.ticks].reverse()),
    `    <line class="axis" x1="${formatCurveCoord(reworkPlot.left)}" y1="${formatCurveCoord(reworkPlot.top)}" x2="${formatCurveCoord(reworkPlot.left)}" y2="${formatCurveCoord(reworkPlot.bottom)}" />`,
    `    <line class="axis" x1="${formatCurveCoord(reworkPlot.left)}" y1="${formatCurveCoord(reworkPlot.bottom)}" x2="${formatCurveCoord(reworkPlot.right)}" y2="${formatCurveCoord(reworkPlot.bottom)}" />`,
    '',
    yLabels(reworkPlot, reworkTickLabels),
    '',
    xLabels(reworkPlot, inputTicks),
    '    <text class="text" x="272.5" y="430" font-size="14" text-anchor="middle">組織の累積AI依存度</text>',
    '',
    `    <polyline class="ai" points="${polylinePoints(reworkPlot, points, reworkAi)}" />`,
    `    <polyline class="no-ai" points="${polylinePoints(reworkPlot, points, reworkNoAi)}" />`,
    '',
    '    <g class="ai-dot">',
    markerCircles(reworkPlot, points, reworkAi),
    '    </g>',
    '    <g class="no-ai-dot">',
    markerCircles(reworkPlot, points, reworkNoAi),
    '    </g>',
    '  </g>',
    '',
    '  <g aria-label="テストカバレッジとIncident確率">',
    '    <rect class="panel" x="515" y="60" width="455" height="405" rx="12" />',
    '    <text class="text" x="742.5" y="91" font-size="20" font-weight="600" text-anchor="middle">Test CoverageとIncident確率</text>',
    `    <text class="muted" x="742.5" y="116" font-size="13" text-anchor="middle">AI Literacy ${aiLiteracy} / Incident倍率 1.0</text>`,
    '',
    yGrid(incidentPlot, [...incidentAxis.ticks].reverse()),
    `    <line class="axis" x1="${formatCurveCoord(incidentPlot.left)}" y1="${formatCurveCoord(incidentPlot.top)}" x2="${formatCurveCoord(incidentPlot.left)}" y2="${formatCurveCoord(incidentPlot.bottom)}" />`,
    `    <line class="axis" x1="${formatCurveCoord(incidentPlot.left)}" y1="${formatCurveCoord(incidentPlot.bottom)}" x2="${formatCurveCoord(incidentPlot.right)}" y2="${formatCurveCoord(incidentPlot.bottom)}" />`,
    '',
    yLabels(incidentPlot, incidentTickLabels),
    '',
    xLabels(incidentPlot, inputTicks),
    '    <text class="text" x="757.5" y="430" font-size="14" text-anchor="middle">Test Coverage</text>',
    '',
    `    <polyline class="ai" points="${polylinePoints(incidentPlot, points, incidentAi)}" />`,
    `    <polyline class="no-ai" points="${polylinePoints(incidentPlot, points, incidentNoAi)}" />`,
    '',
    '    <g class="ai-dot">',
    markerCircles(incidentPlot, points, incidentAi),
    '    </g>',
    '    <g class="no-ai-dot">',
    markerCircles(incidentPlot, points, incidentNoAi),
    '    </g>',
    '  </g>',
    '',
    '  <text class="muted" x="500" y="487" font-size="13" text-anchor="middle">線は現行モデル式から算出した条件付き確率。Monte Carloの観測値ではない。</text>',
    '  <text class="muted" x="500" y="507" font-size="12" text-anchor="middle">AI支援なしの高依存度側は、AI未導入組織の経時変化ではなく対象タスク単位の感度分析。</text>',
    '</svg>',
    '',
  ].join('\n');
}
