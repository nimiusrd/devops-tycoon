/**
 * ステータス HUD（SPEC 第4.2 / mockups/main-screen 準拠）。
 *
 * 出荷ポイント・開発速度・レビュー耐性・品質・シニア体力・AI依存度・
 * 技術的負債・士気を表示し、炎上リスクをチップで示す。
 * ラン中は組織状態（持続）と進行中スプリントのタスクから導出する（第22.2）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  deriveHudStatusParts,
  diffHudMetricSnapshots,
  hudMetricSnapshot,
  type Grade,
  type HudMetricDelta,
  type HudMetricKey,
  type HudMetricSnapshot,
} from '../render/status';
import type { OrgScaleState } from '../sim/orgscale/types';
import type { OrgState, Task } from '../sim/types';

const FEEDBACK_TTL_MS = 1000;

interface ActiveHudFeedback extends HudMetricDelta {
  id: number;
}

export type HudSnapshotScope = 'team' | 'orgScale';

function GradeValue({ grade }: { grade: Grade }) {
  return <span className={`v grade grade-${grade}`}>{grade}</span>;
}

function formatSigned(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
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

export interface HudProps {
  org: OrgState;
  /** 全社/部署俯瞰中の集約状態。指定時はレバー適用後の集約値をHUDにも反映する。 */
  orgScale?: OrgScaleState | null;
  /** 進行中スプリントのタスク（渋滞・リスク導出用。非スプリント時は空配列）。 */
  tasks: Task[];
  /** 現場HUDと全社集約HUDのように、表示元が変わる境界では差分を出さない。 */
  snapshotScope: HudSnapshotScope;
  /** HUD再マウント時にも直前の表示値との差分を出すための初期比較対象。 */
  getInitialPreviousSnapshot?: (scope: HudSnapshotScope) => HudMetricSnapshot | null;
  /** 親がHUD非表示期間をまたいで最後の表示値を保持するための通知。 */
  onSnapshotCaptured?: (snapshot: HudMetricSnapshot, scope: HudSnapshotScope) => void;
}

export function Hud({
  org,
  orgScale,
  tasks,
  snapshotScope,
  getInitialPreviousSnapshot,
  onSnapshotCaptured,
}: HudProps) {
  const s = deriveHudStatusParts(org, tasks, orgScale);
  const snapshot = useMemo(() => hudMetricSnapshot(s), [s]);
  const previousSnapshot = useRef<HudMetricSnapshot | null>(null);
  const previousScope = useRef<HudSnapshotScope | null>(null);
  const nextFeedbackId = useRef(0);
  const feedbackTimers = useRef(new Set<ReturnType<typeof window.setTimeout>>());
  const [feedbacks, setFeedbacks] = useState<ActiveHudFeedback[]>([]);

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
  const statClass = (key: HudMetricKey): string => {
    const feedback = feedbackByKey.get(key);
    return feedback ? `stat hud-feedback flash-${feedback.tone}` : 'stat';
  };

  return (
    <header className="hud" data-testid="hud">
      <div className={statClass('deliveryScore')}>
        <div className="k">出荷ポイント</div>
        <div className="v" data-testid="stat-delivery">
          {s.deliveryScore} <small>pt</small>
        </div>
        <FeedbackPop feedback={feedbackByKey.get('deliveryScore')} />
      </div>
      <div className="stat">
        <div className="k">開発速度</div>
        <GradeValue grade={s.devSpeed} />
      </div>
      <div className="stat">
        <div className="k">レビュー耐性</div>
        <GradeValue grade={s.reviewCapacity} />
      </div>
      <div className="stat">
        <div className="k">品質</div>
        <GradeValue grade={s.quality} />
      </div>
      <div className={statClass('seniorHpPct')}>
        <div className="k">シニア体力</div>
        <div className="v">
          {s.seniorHpPct}
          <small>%</small>
        </div>
        <div className="bar">
          <i className="fill-hp" style={{ width: `${s.seniorHpPct}%` }} />
        </div>
        <FeedbackPop feedback={feedbackByKey.get('seniorHpPct')} />
      </div>
      <div className={statClass('aiDependencyPct')}>
        <div className="k">AI依存度</div>
        <div className="v" data-testid="stat-ai-dependency">
          {s.aiDependencyPct}
          <small>%</small>
        </div>
        <div className="bar">
          <i className="fill-ai" style={{ width: `${s.aiDependencyPct}%` }} />
        </div>
        <FeedbackPop feedback={feedbackByKey.get('aiDependencyPct')} />
      </div>
      <div className={statClass('techDebt')}>
        <div className="k">技術的負債</div>
        <div className="v">{s.techDebt}</div>
        <FeedbackPop feedback={feedbackByKey.get('techDebt')} />
      </div>
      <div className={statClass('morale')}>
        <div className="k">士気</div>
        <div className="v">{s.morale}</div>
        <div className="bar">
          <i className="fill-mor" style={{ width: `${s.morale}%` }} />
        </div>
        <FeedbackPop feedback={feedbackByKey.get('morale')} />
        <div className={`risk-chip risk-${s.risk}`} data-testid="risk">
          炎上 {s.risk}
        </div>
      </div>
    </header>
  );
}
