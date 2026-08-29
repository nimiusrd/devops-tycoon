/**
 * ラン情報バー（パンくず的ヘッダ）。
 *
 * seed・難易度・試練・スプリント数・予算・進化ポイント・所持レリック・組織タイプ診断を
 * 常時表示し、ラン全体の文脈を示す（第4.7 のパンくずの簡易版）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDifficulty } from '../data/difficulties';
import { diagnosisTheme } from '../render/diagnosisTheme';
import { formatRelicTooltip } from '../render/eventOutcomeView';
import { runBarSprintView } from '../render/runBarView';
import { DEFAULT_SCENARIO, getScenario } from '../sim/scenarios';
import {
  budgetHudCopy,
  diffRunMetricSnapshots,
  goalCarryoverHudCopy,
  runMetricSnapshot,
  trustHudCopy,
  type RunMetricDelta,
  type RunMetricSnapshot,
} from '../render/status';
import { budgetHudTitle, trialHudViews } from '../render/trialView';
import { diagnosisView } from '../sim/diagnosis';
import { memberExpression, rosterSummary } from '../sim/member';
import type { MemberExpression } from '../sim/member/types';
import type { RunState } from '../sim/run/types';
import { formatSigned } from './formatSigned';
import { useReplayContent } from './replayContent';

const FEEDBACK_TTL_MS = 1600;

interface ActiveRunFeedback extends RunMetricDelta {
  id: number;
}

export interface RunBarProps {
  state: RunState;
  /** 編成画面を開く（指定時のみ編成ボタンを表示）。 */
  onOpenFormation?: () => void;
  /** 全社マップへズームアウトする（指定時のみ全社ボタンを表示。第4.7）。 */
  onOpenOrg?: () => void;
  /** リプレイ閲覧など、操作ボタンを無効化するとき。 */
  readOnly?: boolean;
  /** RunBar再マウント時にも直前の表示値との差分を出すための初期比較対象。 */
  getInitialPreviousSnapshot?: () => RunMetricSnapshot | null;
  /** 親がRunBar非表示期間をまたいで最後の表示値を保持するための通知。 */
  onSnapshotCaptured?: (snapshot: RunMetricSnapshot) => void;
  /** 進行判断に直結しない文脈情報を詳細へ退避する。 */
  compact?: boolean;
}

/** 表情演出の絵文字（第12.2）。 */
const FACE: Record<MemberExpression, string> = {
  leave: '😴',
  tired: '😩',
  normal: '🙂',
  great: '💪',
};

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
  readOnly = false,
  getInitialPreviousSnapshot,
  onSnapshotCaptured,
  compact = false,
}: RunBarProps) {
  const diff = getDifficulty(state.difficulty);
  const { resolveRelic, resolveTrial } = useReplayContent();
  const diag = diagnosisView(state.diagnosis);
  const theme = diagnosisTheme(state.diagnosis);
  const roster = rosterSummary(state.roster);
  const snapshot = useMemo(() => runMetricSnapshot(state), [state]);
  const previousSnapshot = useRef<RunMetricSnapshot | null>(null);
  const nextFeedbackId = useRef(0);
  const feedbackTimers = useRef(new Set<ReturnType<typeof window.setTimeout>>());
  const [feedbacks, setFeedbacks] = useState<ActiveRunFeedback[]>([]);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

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
  const sprintView = runBarSprintView(state);
  const budgetCopy = budgetHudCopy(state.budget);
  const trialViews = trialHudViews(state.trials, resolveTrial);
  const trustCopy = trustHudCopy(state.stakeholderTrust);
  const carryoverCopy = goalCarryoverHudCopy({
    goalCarryoverId: state.goalCarryoverId,
    goalCarryoverQuarter: state.goalCarryoverQuarter,
    quarterNumber: state.quarterNumber,
  });

  const secondaryDetails = (
    <>
      <span className="pill" data-testid="seed">
        seed <b>{state.seed}</b>
      </span>
      <span className="pill" data-testid="difficulty">
        {diff.label.split(':')[0]}
      </span>
      {state.scenario !== DEFAULT_SCENARIO && (
        <span className="pill" data-testid="scenario">
          {getScenario(state.scenario).label}
        </span>
      )}
      <span className="pill" data-testid="evo-points-bar">
        ⭐<b>{state.evolution.points}</b>
      </span>
      <div className="relic-bar" data-testid="relics">
        {state.relics.length === 0 ? (
          <span className="relic-empty">レリックなし</span>
        ) : (
          state.relics.map((id) => {
            const relic = resolveRelic(id);
            return (
              <span key={id} className="relic-chip" title={formatRelicTooltip(relic)}>
                🏛 {relic.name}
              </span>
            );
          })
        )}
      </div>
      <div
        className={`diagnosis-status diag-${state.diagnosis}`}
        data-testid="runbar-diagnosis"
        data-diagnosis={state.diagnosis}
        aria-live="polite"
      >
        <span className="pill diagnosis" title={diag.description}>
          <span aria-hidden="true">{theme.icon}</span> {diag.label}
        </span>
        <span className="diagnosis-warning">{theme.warning}</span>
      </div>
    </>
  );

  return (
    <div
      className={`subbar runbar${compact ? ' runbar-compact' : ''}`}
      data-testid="runbar"
      data-compact={compact ? 'true' : 'false'}
    >
      <span className="pill" data-testid="sprint-no" title="当四半期のトラック進行（最終がボス）">
        スプリント{' '}
        <b>
          {sprintView.current}/{sprintView.total}
        </b>
        {sprintView.bossNext && <span className="boss-next"> ★次が山場</span>}
      </span>
      <span
        className={`pill run-metric-pill tone-${budgetCopy.tone}${budgetFeedback ? ` run-feedback flash-${budgetFeedback.tone}` : ''}`}
        data-testid="budget"
        title={budgetHudTitle(budgetCopy.detail, state.trials, resolveTrial)}
        data-tone={budgetCopy.tone}
      >
        💰<b>{state.budget}</b>
        {budgetCopy.warningChip && (
          <span className={`runbar-warning tone-${budgetCopy.tone}`} data-testid="budget-warning">
            {budgetCopy.warningChip}
          </span>
        )}
        {budgetFeedback && <RunFeedbackPop feedbacks={[budgetFeedback]} />}
      </span>
      {trialViews.length > 0 && (
        <div className="trial-bar" data-testid="run-trials">
          {trialViews.map((trial) => (
            <span
              key={trial.id}
              className="pill"
              data-testid={`run-trial-${trial.id}`}
              title={trial.description}
              aria-label={`試練 ${trial.label}`}
            >
              {trial.label}
            </span>
          ))}
        </div>
      )}
      <span
        className={`pill run-metric-pill trust-pill tone-${trustCopy.tone}${trustFeedbacks.length > 0 ? ` run-feedback flash-${trustFeedbackTone}` : ''}`}
        data-testid="stakeholder-trust"
        title={`ステークホルダー信頼（経営 / 顧客 / チーム）。${trustCopy.detail}`}
        data-tone={trustCopy.tone}
      >
        🤝
        <b>
          {state.stakeholderTrust.management}/{state.stakeholderTrust.customers}/
          {state.stakeholderTrust.team}
        </b>
        {trustCopy.warningChip && (
          <span className={`runbar-warning tone-${trustCopy.tone}`} data-testid="trust-warning">
            {trustCopy.warningChip}
          </span>
        )}
        {trustFeedbacks.length > 0 && <RunFeedbackPop feedbacks={trustFeedbacks} />}
      </span>
      {carryoverCopy.warningChip && (
        <span
          className={`pill run-metric-pill tone-${carryoverCopy.tone}`}
          data-testid="goal-carryover"
          title={carryoverCopy.detail}
          data-tone={carryoverCopy.tone}
        >
          修正
          <span
            className={`runbar-warning tone-${carryoverCopy.tone}`}
            data-testid="goal-carryover-warning"
          >
            {carryoverCopy.warningChip}
          </span>
        </span>
      )}
      {onOpenFormation ? (
        <button
          type="button"
          className="pill roster-pill"
          data-testid="open-formation"
          disabled={readOnly}
          onClick={onOpenFormation}
          title={
            readOnly
              ? 'リプレイ閲覧中は編成を開けません'
              : `稼働 ${roster.active} / 休職 ${roster.onLeave}（コーダー${roster.coders}・レビュー${roster.reviewers}）`
          }
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
      {onOpenOrg && (
        <button
          type="button"
          className="pill org-pill"
          data-testid="open-org"
          disabled={readOnly}
          onClick={onOpenOrg}
          title={
            readOnly
              ? 'リプレイ閲覧中は全社マップを開けません'
              : '全社マップへズームアウト（業界 ▸ 全社 ▸ 部署 ▸ 現場）'
          }
        >
          🗺 全社
        </button>
      )}
      {compact ? (
        <>
          <button
            type="button"
            className="pill runbar-details-toggle"
            data-testid="runbar-details-toggle"
            aria-expanded={detailsExpanded}
            aria-controls="runbar-details"
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            {detailsExpanded ? '詳細を閉じる' : 'ラン詳細'}
          </button>
          {detailsExpanded && (
            <div className="runbar-details" id="runbar-details" data-testid="runbar-details">
              {secondaryDetails}
            </div>
          )}
        </>
      ) : (
        secondaryDetails
      )}
    </div>
  );
}
