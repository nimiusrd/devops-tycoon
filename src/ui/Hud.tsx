/**
 * ステータス HUD（SPEC 第4.2 / mockups/main-screen 準拠）。
 *
 * 出荷ポイント・開発速度・レビュー耐性・品質・シニア体力・AI依存度・
 * 技術的負債・士気を表示し、炎上リスクをチップで示す。
 * ラン中は組織状態（持続）と進行中スプリントのタスクから導出する（第22.2）。
 */
import { deriveHudMetrics, type Grade, type StatusMetricView } from '../render/status';
import type { OrgState, Task } from '../sim/types';

function GradeValue({ grade }: { grade: Grade }) {
  return <span className={`v grade grade-${grade}`}>{grade}</span>;
}

function MetricValue({ metric }: { metric: StatusMetricView }) {
  if (typeof metric.value === 'string') return <GradeValue grade={metric.value} />;

  return (
    <div
      className="v"
      data-testid={
        metric.id === 'delivery'
          ? 'stat-delivery'
          : metric.id === 'aiDependency'
            ? 'stat-ai-dependency'
            : undefined
      }
    >
      {metric.value}
      {metric.unit && <small>{metric.unit}</small>}
    </div>
  );
}

function HudStat({ metric }: { metric: StatusMetricView }) {
  const valueText = `${metric.value}${metric.unit ?? ''}`;
  return (
    <section
      className={`stat stat-${metric.id} stat-tone-${metric.tone}`}
      data-testid={`hud-${metric.id}`}
      data-tone={metric.tone}
      title={metric.help}
      aria-label={`${metric.label}: ${valueText}。${metric.directionLabel}。${metric.help}`}
    >
      <div className="stat-head">
        <div className="stat-label">
          <span className="stat-icon" aria-hidden="true">
            {metric.icon}
          </span>
          <span className="k">{metric.label}</span>
        </div>
        <span className={`direction-chip direction-${metric.direction}`}>
          {metric.directionLabel}
        </span>
      </div>
      <MetricValue metric={metric} />
      <div className="stat-detail">{metric.detail}</div>
      {metric.barPct !== undefined && metric.fillClass && (
        <div className="bar">
          <i className={metric.fillClass} style={{ width: `${metric.barPct}%` }} />
        </div>
      )}
      {metric.risk && (
        <div className={`risk-chip risk-${metric.risk}`} data-testid="risk">
          炎上 {metric.risk}
        </div>
      )}
    </section>
  );
}

export interface HudProps {
  org: OrgState;
  /** 進行中スプリントのタスク（渋滞・リスク導出用。非スプリント時は空配列）。 */
  tasks: Task[];
}

export function Hud({ org, tasks }: HudProps) {
  const metrics = deriveHudMetrics(org, tasks);
  return (
    <header className="hud" data-testid="hud">
      {metrics.map((metric) => (
        <HudStat key={metric.id} metric={metric} />
      ))}
    </header>
  );
}
