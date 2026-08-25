/**
 * ステータス HUD（SPEC 第4.2 準拠）。
 *
 * 出荷ポイント・開発速度・レビュー耐性・品質・セキュリティ・シニア体力・AI依存度・
 * 技術的負債・士気を表示し、炎上リスクをチップで示す。
 * ラン中は組織状態（持続）と進行中スプリントのタスクから導出する（第22.2）。
 *
 * RI-70: 狭幅では KPI を折り畳み要約し、盤面と介入バーを1画面に収める。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  deriveHudMetrics,
  deriveHudStatusParts,
  diffHudMetricSnapshots,
  hudMetricSnapshot,
  type Grade,
  type HudMetricDelta,
  type HudMetricSnapshot,
  type StatusMetricView,
} from '../render/status';
import type { OrgScaleState } from '../sim/orgscale/types';
import type { OrgState, Task } from '../sim/types';
import { formatSigned } from './formatSigned';
import { pickCompactMetrics } from './hudCompact';
import { useResponsiveMode } from './responsiveMode';

const FEEDBACK_TTL_MS = 1000;

interface ActiveHudFeedback extends HudMetricDelta {
  id: number;
}

export type HudSnapshotScope = 'team' | 'orgScale';

function GradeValue({ grade }: { grade: Grade }) {
  return <span className={`v grade grade-${grade}`}>{grade}</span>;
}

function FeedbackPop({ feedback }: { feedback?: ActiveHudFeedback }) {
  return (
    <AnimatePresence>
      {feedback && (
        <motion.span
          key={feedback.id}
          className={`hud-feedback-pop feedback-${feedback.tone}`}
          aria-hidden="true"
          initial={{ y: 8, opacity: 0, scale: 0.85 }}
          animate={{ y: -14, opacity: 1, scale: 1 }}
          exit={{ y: -26, opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        >
          {formatSigned(feedback.delta)}
        </motion.span>
      )}
    </AnimatePresence>
  );
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

function HudStat({ metric, feedback }: { metric: StatusMetricView; feedback?: ActiveHudFeedback }) {
  const valueText = `${metric.value}${metric.unit ?? ''}`;
  const feedbackClass = feedback ? ` hud-feedback flash-${feedback.tone}` : '';

  return (
    <section
      className={`stat stat-${metric.id} stat-tone-${metric.tone}${feedbackClass}`}
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
      <FeedbackPop feedback={feedback} />
      {metric.warningChip && (
        <div
          className={`burnout-chip tone-${metric.tone}`}
          data-testid={
            metric.id === 'seniorHp'
              ? 'senior-burnout-warning'
              : metric.id === 'reviewCapacity'
                ? 'review-freeze-warning'
                : `${metric.id}-warning`
          }
        >
          {metric.warningChip}
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
  /** 全社/部署俯瞰中の集約状態。指定時はレバー適用後の集約値をHUDにも反映する。 */
  orgScale?: OrgScaleState | null;
  /** 進行中スプリントのタスク（渋滞・リスク導出用。非スプリント時は空配列）。 */
  tasks: Task[];
  /**
   * ライブのレビュー待ちピーク（RI-85 凍結予兆）。
   * 進行中スプリント peak と全チーム現在キューを渡す。通算 totals は使わない。
   * 未指定時は現在キュー長だけで判定する。
   */
  reviewQueuePeak?: number;
  /** 現場HUDと全社集約HUDのように、表示元が変わる境界では差分を出さない。 */
  snapshotScope: HudSnapshotScope;
  /** HUD再マウント時にも直前の表示値との差分を出すための初期比較対象。 */
  getInitialPreviousSnapshot?: (scope: HudSnapshotScope) => HudMetricSnapshot | null;
  /** 親がHUD非表示期間をまたいで最後の表示値を保持するための通知。 */
  onSnapshotCaptured?: (snapshot: HudMetricSnapshot, scope: HudSnapshotScope) => void;
  /** 狭幅時のKPI展開状態。未指定時はHUD内部で管理する。 */
  expanded?: boolean;
  /** 狭幅時のKPI展開状態が変わったときの通知。 */
  onExpandedChange?: (expanded: boolean) => void;
  /** 盤面を主役にしたい画面では、広幅でも要約表示を既定にする。 */
  preferCompact?: boolean;
}

function CompactChip({ metric }: { metric: StatusMetricView }) {
  const valueText = `${metric.value}${metric.unit ?? ''}`;
  const riskText = metric.risk && metric.risk !== 'LOW' ? `炎上 ${metric.risk}` : undefined;
  // ガイド/CSS/E2E はフル表示と同じ `hud-seniorHp` を対象にする。
  const testId = metric.id === 'seniorHp' ? 'hud-seniorHp' : `hud-compact-${metric.id}`;
  return (
    <span
      className={`hud-compact-chip tone-${metric.tone}`}
      data-testid={testId}
      data-tone={metric.tone}
      title={`${metric.label}: ${valueText}${riskText ? `。${riskText}` : ''}`}
    >
      <span className="hud-compact-chip-icon" aria-hidden="true">
        {metric.icon}
      </span>
      <span className="hud-compact-chip-label">{metric.label}</span>
      <span className="hud-compact-chip-value">{valueText}</span>
      {metric.warningChip && (
        <span
          className="hud-compact-chip-warn"
          data-testid={
            metric.id === 'seniorHp'
              ? 'senior-burnout-warning'
              : metric.id === 'reviewCapacity'
                ? 'review-freeze-warning'
                : `${metric.id}-warning`
          }
        >
          {metric.warningChip}
        </span>
      )}
      {riskText && <span className={`hud-compact-chip-risk risk-${metric.risk}`}>{riskText}</span>}
    </span>
  );
}

export function Hud({
  org,
  orgScale,
  tasks,
  reviewQueuePeak = 0,
  snapshotScope,
  getInitialPreviousSnapshot,
  onSnapshotCaptured,
  expanded: expandedProp,
  onExpandedChange,
  preferCompact = false,
}: HudProps) {
  const s = deriveHudStatusParts(org, tasks, orgScale);
  const snapshot = useMemo(() => hudMetricSnapshot(s), [s]);
  const metrics = deriveHudMetrics(org, tasks, orgScale, reviewQueuePeak);
  const previousSnapshot = useRef<HudMetricSnapshot | null>(null);
  const previousScope = useRef<HudSnapshotScope | null>(null);
  const nextFeedbackId = useRef(0);
  const feedbackTimers = useRef(new Set<ReturnType<typeof window.setTimeout>>());
  const [feedbacks, setFeedbacks] = useState<ActiveHudFeedback[]>([]);
  const responsiveMode = useResponsiveMode();
  const narrow = responsiveMode.width === 'narrow';
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const expanded = expandedProp ?? uncontrolledExpanded;
  // スプリント中は広幅でも要約を既定にし、盤面へ高さを返す。
  const canCompact = narrow || preferCompact;
  const compact = canCompact && !expanded;
  const compactMetrics = useMemo(() => pickCompactMetrics(metrics), [metrics]);

  useEffect(() => {
    const scopeChanged = previousScope.current !== null && previousScope.current !== snapshotScope;
    const previous =
      previousScope.current === snapshotScope
        ? previousSnapshot.current
        : previousScope.current === null
          ? (getInitialPreviousSnapshot?.(snapshotScope) ?? null)
          : null;
    if (scopeChanged) {
      for (const timer of feedbackTimers.current) {
        window.clearTimeout(timer);
      }
      feedbackTimers.current.clear();
      setFeedbacks([]);
    }
    previousScope.current = snapshotScope;
    previousSnapshot.current = snapshot;
    onSnapshotCaptured?.(snapshot, snapshotScope);
    if (!previous) return;

    const deltas = diffHudMetricSnapshots(previous, snapshot);
    if (deltas.length === 0) return;

    const nextFeedbacks = deltas.map((delta) => ({
      ...delta,
      id: nextFeedbackId.current++,
    }));
    const updatedKeys = new Set(nextFeedbacks.map((feedback) => feedback.key));
    setFeedbacks((current) => [
      ...current.filter((feedback) => !updatedKeys.has(feedback.key)),
      ...nextFeedbacks,
    ]);

    const feedbackIds = new Set(nextFeedbacks.map((feedback) => feedback.id));
    const timer = window.setTimeout(() => {
      setFeedbacks((current) => current.filter((feedback) => !feedbackIds.has(feedback.id)));
      feedbackTimers.current.delete(timer);
    }, FEEDBACK_TTL_MS);
    feedbackTimers.current.add(timer);
  }, [getInitialPreviousSnapshot, onSnapshotCaptured, snapshot, snapshotScope]);

  useEffect(
    () => () => {
      for (const timer of feedbackTimers.current) {
        window.clearTimeout(timer);
      }
      feedbackTimers.current.clear();
    },
    [],
  );

  const feedbackByKey = new Map(feedbacks.map((feedback) => [feedback.key, feedback]));
  const hudClass = compact ? 'hud hud-compact' : 'hud';
  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    if (expandedProp === undefined) setUncontrolledExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  return (
    <header
      className={hudClass}
      data-testid="hud"
      data-compact={compact ? 'true' : 'false'}
      data-responsive-width={responsiveMode.width}
      data-responsive-height={responsiveMode.height}
    >
      {canCompact && (
        <button
          type="button"
          className="hud-toggle"
          data-testid="hud-toggle"
          aria-expanded={expanded}
          aria-controls="hud-metrics"
          onClick={toggleExpanded}
        >
          {expanded ? 'KPIを畳む' : 'KPI詳細'}
        </button>
      )}
      {compact ? (
        <div className="hud-compact-row" id="hud-metrics" data-testid="hud-compact">
          {compactMetrics.map((metric) => (
            <CompactChip key={metric.id} metric={metric} />
          ))}
        </div>
      ) : (
        <div className="hud-metrics" id="hud-metrics">
          {metrics.map((metric) => (
            <HudStat
              key={metric.id}
              metric={metric}
              feedback={metric.feedbackKey ? feedbackByKey.get(metric.feedbackKey) : undefined}
            />
          ))}
        </div>
      )}
    </header>
  );
}
