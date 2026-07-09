/**
 * スプリントリザルトのタイムライン・スパークライン（RI-53）。
 *
 * `planSprintTimeline` の純関数結果を自前 SVG で描画する（Recharts なし）。
 */
import { planSprintTimeline } from '../render/sprintTimelineView';
import type { SprintEvent, TimelineSample } from '../sim/types';

export interface SprintTimelineChartProps {
  timeline: readonly TimelineSample[];
  events: readonly SprintEvent[];
}

export function SprintTimelineChart({ timeline, events }: SprintTimelineChartProps) {
  const view = planSprintTimeline(timeline, events);

  if (view.empty) {
    return (
      <div className="sprint-timeline" data-testid="sprint-timeline">
        <p className="result-section-label">タイムライン</p>
        <p className="sprint-timeline-empty">記録なし</p>
      </div>
    );
  }

  return (
    <div className="sprint-timeline" data-testid="sprint-timeline">
      <p className="result-section-label">タイムライン</p>
      <p className="sprint-timeline-hint">折れ線＝Review待ち / 炎上 / コンボ / シニアHP。▼＝介入</p>
      <ul className="sprint-timeline-legend" aria-hidden="true">
        {view.series.map((s) => (
          <li key={s.key} className={`legend-${s.tone}`}>
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        className="sprint-timeline-svg"
        viewBox={`0 0 ${view.width} ${view.height}`}
        role="img"
        aria-label={`スプリント時系列 tick ${view.tickStart}〜${view.tickEnd}`}
        data-testid="sprint-timeline-svg"
      >
        {view.series.map((s) => (
          <path
            key={s.key}
            className={`timeline-series series-${s.tone}`}
            d={s.d}
            fill="none"
            data-testid={`timeline-series-${s.key}`}
          />
        ))}
        {view.markers.map((m, i) => (
          <g
            key={`${m.tick}-${m.actionId}-${i}`}
            className="timeline-marker"
            transform={`translate(${m.x}, ${view.pad.top - 2})`}
            data-testid={`timeline-marker-${m.actionId}`}
          >
            <title>
              tick {m.tick}: {m.label}
            </title>
            <text textAnchor="middle" className="timeline-marker-icon">
              ▼
            </text>
          </g>
        ))}
        <text className="timeline-axis" x={view.pad.left} y={view.height - 4} textAnchor="start">
          t{view.tickStart}
        </text>
        <text
          className="timeline-axis"
          x={view.width - view.pad.right}
          y={view.height - 4}
          textAnchor="end"
        >
          t{view.tickEnd}
        </text>
      </svg>
    </div>
  );
}
