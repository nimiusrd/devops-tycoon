/**
 * ラン情報バー（パンくず的ヘッダ）。
 *
 * seed・難易度・スプリント数・予算・進化ポイント・所持レリック・組織タイプ診断を
 * 常時表示し、ラン全体の文脈を示す（第4.7 のパンくずの簡易版）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDifficulty } from '../data/difficulties';
import { getRelic } from '../data/relics';
import { formatRelicTooltip } from '../render/eventOutcomeView';
import {
  diffRunMetricSnapshots,
  runMetricSnapshot,
  type RunMetricDelta,
  type RunMetricSnapshot,
} from '../render/status';
import { diagnosisView } from '../sim/diagnosis';
import { memberExpression, rosterSummary } from '../sim/member';
import type { MemberExpression } from '../sim/member/types';
import type { RunState } from '../sim/run/types';

const FEEDBACK_TTL_MS = 1000;

interface ActiveRunFeedback extends RunMetricDelta {
  id: number;
}

export interface RunBarProps {
  state: RunState;
  /** 編成画面を開く（指定時のみ編成ボタンを表示）。 */
  onOpenFormation?: () => void;
  /** 全社マップへズームアウトする（指定時のみ全社ボタンを表示。第4.7）。 */
  onOpenOrg?: () => void;
  /** RunBar再マウント時にも直前の表示値との差分を出すための初期比較対象。 */
  getInitialPreviousSnapshot?: () => RunMetricSnapshot | null;
  /** 親がRunBar非表示期間をまたいで最後の表示値を保持するための通知。 */
  onSnapshotCaptured?: (snapshot: RunMetricSnapshot) => void;
}

/** 表情演出の絵文字（第12.2）。 */
const FACE: Record<MemberExpression, string> = {
  leave: '😴',
  tired: '😩',
  normal: '🙂',
  great: '💪',
};

function formatSigned(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function RunFeedbackPop({ feedbacks }: { feedbacks: ActiveRunFeedback[] }) {
  const tone = feedbacks.some((feedback) => feedback.tone === 'negative') ? 'negative' : 'positive';
  const label = feedbacks
    .map((feedback) => `${feedback.shortLabel}${formatSigned(feedback.delta)}`)
    .join(' / ');

  return (
    <AnimatePresence>
      {feedbacks.length > 0 && (
        <motion.span
          key={feedbacks.map((feedback) => feedback.id).join('-')}
          className={`run-feedback-pop feedback-${tone}`}
          aria-hidden="true"
          initial={{ y: 7, opacity: 0, scale: 0.85 }}
          animate={{ y: -12, opacity: 1, scale: 1 }}
          exit={{ y: -22, opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function RunBar({
  state,
  onOpenFormation,
  onOpenOrg,
  getInitialPreviousSnapshot,
  onSnapshotCaptured,
}: RunBarProps) {
  const diff = getDifficulty(state.difficulty);
  const diag = diagnosisView(state.diagnosis);
  const roster = rosterSummary(state.roster);
  const snapshot = useMemo(() => runMetricSnapshot(state), [state]);
  const previousSnapshot = useRef<RunMetricSnapshot | null>(null);
  const nextFeedbackId = useRef(0);
  const feedbackTimers = useRef(new Set<ReturnType<typeof window.setTimeout>>());
  const [feedbacks, setFeedbacks] = useState<ActiveRunFeedback[]>([]);

  useEffect(() => {
    const previous = previousSnapshot.current ?? getInitialPreviousSnapshot?.() ?? null;
    previousSnapshot.current = snapshot;
    onSnapshotCaptured?.(snapshot);
    if (!previous) return;

    const deltas = diffRunMetricSnapshots(previous, snapshot);
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
  }, [getInitialPreviousSnapshot, onSnapshotCaptured, snapshot]);

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
  const budgetFeedback = feedbackByKey.get('budget');
  const trustFeedbacks = [
    feedbackByKey.get('trustManagement'),
    feedbackByKey.get('trustCustomers'),
    feedbackByKey.get('trustTeam'),
  ].filter((feedback): feedback is ActiveRunFeedback => feedback !== undefined);
  const trustFeedbackTone = trustFeedbacks.some((feedback) => feedback.tone === 'negative')
    ? 'negative'
    : 'positive';

  return (
    <div className="subbar runbar" data-testid="runbar">
      <span className="pill" data-testid="seed">
        seed <b>{state.seed}</b>
      </span>
      <span className="pill" data-testid="difficulty">
        {diff.label.split(':')[0]}
      </span>
      <span className="pill" data-testid="sprint-no" title="当四半期のトラック進行（最終がボス）">
        スプリント{' '}
        <b>
          {Math.min(state.sprintIndexInQuarter, state.sprintsPerQuarter)}/{state.sprintsPerQuarter}
        </b>
        {state.sprintIndexInQuarter + 1 === state.sprintsPerQuarter && (
          <span className="boss-next"> ★次が山場</span>
        )}
      </span>
      <span
        className={`pill run-metric-pill${budgetFeedback ? ` run-feedback flash-${budgetFeedback.tone}` : ''}`}
        data-testid="budget"
      >
        💰<b>{state.budget}</b>
        {budgetFeedback && <RunFeedbackPop feedbacks={[budgetFeedback]} />}
      </span>
      <span
        className={`pill run-metric-pill trust-pill${trustFeedbacks.length > 0 ? ` run-feedback flash-${trustFeedbackTone}` : ''}`}
        data-testid="stakeholder-trust"
        title="ステークホルダー信頼（経営 / 顧客 / チーム）"
      >
        🤝
        <b>
          {state.stakeholderTrust.management}/{state.stakeholderTrust.customers}/
          {state.stakeholderTrust.team}
        </b>
        {trustFeedbacks.length > 0 && <RunFeedbackPop feedbacks={trustFeedbacks} />}
      </span>
      <span className="pill" data-testid="evo-points-bar">
        ⭐<b>{state.evolution.points}</b>
      </span>
      <div className="relic-bar" data-testid="relics">
        {state.relics.length === 0 ? (
          <span className="relic-empty">レリックなし</span>
        ) : (
          state.relics.map((id) => {
            const relic = getRelic(id);
            return (
              <span key={id} className="relic-chip" title={relic ? formatRelicTooltip(relic) : id}>
                🏛 {relic?.name}
              </span>
            );
          })
        )}
      </div>
      {onOpenFormation ? (
        <button
          type="button"
          className="pill roster-pill"
          data-testid="open-formation"
          onClick={onOpenFormation}
          title={`稼働 ${roster.active} / 休職 ${roster.onLeave}（コーダー${roster.coders}・レビュー${roster.reviewers}）`}
        >
          <span className="roster-faces" data-testid="roster-faces">
            {state.roster.members.map((m) => (
              <span key={m.id}>{FACE[memberExpression(m)]}</span>
            ))}
          </span>
          編成
        </button>
      ) : (
        <span className="pill" data-testid="roster-count">
          👥<b>{roster.active}</b>
          {roster.onLeave > 0 && <span className="roster-leave"> 😴{roster.onLeave}</span>}
        </span>
      )}
      <span className={`pill diagnosis diag-${state.diagnosis}`}>{diag.label}</span>
      {onOpenOrg && (
        <button
          type="button"
          className="pill org-pill"
          data-testid="open-org"
          onClick={onOpenOrg}
          title="全社マップへズームアウト（業界 ▸ 全社 ▸ 部署 ▸ 現場）"
        >
          🗺 全社
        </button>
      )}
    </div>
  );
}
