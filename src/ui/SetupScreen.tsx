/**
 * 編成（Setup）画面（SPEC 第3章 基本ループ / 第4.4）。
 *
 * 第1スプリント前、各スプリント間、ショップ/休息後・次四半期開始時の編成ウィンドウ。
 * いきなり盤面を走らせず、メンバー配置・AI 配布を確定してからスプリントを開始する。
 * 高負荷（elite）予定はバナーで明示する（RI-77）。
 * 今四半期の OKR はコンパクト表示する（RI-129）。詳細な目標値は四半期レビューが正。
 * 既存の編成グリッド（FormationGrid）を流用する。
 */
import { getBoss } from '../data/bosses';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setupObservation } from '../render/companyGuidanceView';
import { runBarSprintView } from '../render/runBarView';
import type { LaneAssignment } from '../sim/member/types';
import type { RunState } from '../sim/run/types';
import { DeckBar } from './DeckBar';
import { FormationGrid } from './FormationScreen';
import { QuarterOkr } from './QuarterOkr';
import { TermTip } from './TermTip';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface SetupScreenProps {
  state: RunState;
  onAssign: (id: string, assignment: LaneAssignment) => void;
  onToggleAi: (id: string, on: boolean) => void;
  onBegin: () => void;
  /** リプレイ閲覧など、操作を受け付けないとき。 */
  readOnly?: boolean;
}

function MissingCoderConfirm({
  canAssign,
  onAssign,
  onCancel,
  onBegin,
}: {
  canAssign: boolean;
  onAssign: () => void;
  onCancel: () => void;
  onBegin: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const assignRef = useRef<HTMLButtonElement>(null);
  const acceptedRef = useRef(false);
  useDialogOverlayLock(dialogRef, { restoreFocus: true, onDismiss: onCancel });
  useEffect(() => {
    assignRef.current?.focus();
  }, [canAssign]);

  return (
    <div
      ref={dialogRef}
      className="result-overlay setup-coder-confirm"
      data-testid="setup-no-coder-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-no-coder-title"
      aria-describedby="setup-no-coder-description"
      tabIndex={-1}
    >
      <div className="result-card resume-risk-card">
        <h2 className="draft-title" id="setup-no-coder-title">
          コーダーが0人です
        </h2>
        <p id="setup-no-coder-description">
          このまま始めると出荷できません。
          {canAssign
            ? 'コーダーを割り当ててから始めますか？'
            : '今は割り当てられるメンバーがいません。'}
        </p>
        <div className="result-actions">
          <button
            ref={assignRef}
            type="button"
            className="btn btn-primary"
            data-testid="setup-no-coder-assign"
            onClick={canAssign ? onAssign : onCancel}
          >
            {canAssign ? 'コーダーを割り当てる' : '編成に戻る'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="setup-no-coder-begin"
            onClick={() => {
              if (acceptedRef.current) return;
              acceptedRef.current = true;
              onBegin();
            }}
          >
            このまま開始
          </button>
        </div>
      </div>
    </div>
  );
}

export function SetupScreen({
  state,
  onAssign,
  onToggleAi,
  onBegin,
  readOnly = false,
}: SetupScreenProps) {
  const [dismissedSprintKeys, setDismissedSprintKeys] = useState<string[]>([]);
  const setupRef = useRef<HTMLDivElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sprintKey = JSON.stringify([
    state.seed,
    state.quarterNumber,
    state.sprintIndexInQuarter,
    state.activeTeamId,
  ]);
  const observation = setupObservation(state);
  const missingCoders = observation?.id === 'coding-staff';
  const confirmationKey = JSON.stringify([sprintKey, missingCoders, readOnly]);
  const assignmentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => clearTimeout(assignmentTimerRef.current), [confirmationKey]);
  const [confirmation, setConfirmation] = useState({ key: confirmationKey, open: false });
  // 一時的な確認を別のスプリント・チームや閲覧モードへ持ち越さない。
  if (confirmation.key !== confirmationKey) {
    setConfirmation({ key: confirmationKey, open: false });
  }
  const showConfirmation = confirmation.key === confirmationKey && confirmation.open;
  const activeMembers = state.roster.members.filter((member) => !member.onLeave);
  const assignmentTarget =
    activeMembers.find((member) => member.assignment === 'bench') ?? activeMembers[0];
  const focusCodingAssignment = () => {
    if (readOnly || !assignmentTarget) return;
    const buttons = setupRef.current?.querySelectorAll<HTMLButtonElement>('.fm-lane');
    const target = [...(buttons ?? [])].find(
      (button) => button.dataset.testid === `assign-${assignmentTarget.id}-coding`,
    );
    target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    target?.focus({ preventScroll: true });
  };
  const showObservation =
    observation !== null && (missingCoders || !dismissedSprintKeys.includes(sprintKey));
  const dismissObservation = () => {
    setDismissedSprintKeys((keys) => [...keys, sprintKey]);
    (readOnly ? headingRef.current : beginRef.current)?.focus();
  };
  const boss = getBoss(state.bossId);
  const { current: nextIndex, total } = runBarSprintView(state);
  // launchSprint と同様、最終枠はインデックスからボスを決める（pending は normal のまま）。
  const bossPending = state.pendingSprintKind === 'boss' || nextIndex >= total;
  const elitePending = !bossPending && state.pendingSprintKind === 'elite';
  const heading = bossPending
    ? '編成 — ボススプリントの前に配置とAIを決める'
    : elitePending
      ? '編成 — 高負荷スプリントの前に配置とAIを決める'
      : '編成 — スプリント開始前に配置とAIを決める';
  return (
    <div
      ref={setupRef}
      className="run-setup"
      data-testid="setup"
      data-readonly={readOnly ? 'true' : undefined}
      role="main"
      aria-labelledby="setup-heading"
    >
      <div className="map-banner">
        <span className="pill">第{state.quarterNumber}四半期</span>
        <span className="pill" data-testid="setup-next-sprint">
          次: スプリント {nextIndex} / {total}
        </span>
        {elitePending ? (
          <span className="pill" data-testid="setup-elite-pending" role="status" aria-live="polite">
            高負荷案件
          </span>
        ) : null}
        {bossPending ? (
          <span className="pill" data-testid="setup-boss-pending" role="status" aria-live="polite">
            ボススプリント
          </span>
        ) : null}
        <b className="boss-name">
          <span aria-hidden="true">★ </span>
          <span className="visually-hidden">ボス: </span>
          {boss?.name ?? 'ボス'}
        </b>
        <span className="boss-desc">{boss?.description}</span>
      </div>
      <QuarterOkr variant="setup" bossId={state.bossId} goal={state.quarterGoal} />
      <div className="formation-panel">
        <div className="formation-head">
          <div>
            <p className="result-eyebrow">SETUP</p>
            <h2 ref={headingRef} tabIndex={-1} className="draft-title" id="setup-heading">
              {heading}
            </h2>
            <p className="formation-setup-hint">
              {bossPending
                ? '次はボス。四半期の締めくくりなので、AI 配布と配置をこのタイミングで見直そう。'
                : elitePending
                  ? '次は高負荷案件。出荷は大きいが渋滞・炎上リスクも高い。AI 配布と配置をこのタイミングで見直そう。'
                  : 'AI は配った相手の習熟で効き方が変わる。広げすぎると依存と手戻りが積み上がるので、誰に配るかこのタイミングで見直そう。'}
            </p>
            <div className="setup-term-tips" data-testid="setup-term-tips">
              <TermTip termId="pr" />
              <TermTip termId="aiLiteracy" />
              <TermTip termId="rework" />
            </div>
            <div className="setup-observation" data-testid="setup-observation-slot">
              <div
                className="setup-observation-content"
                data-testid={showObservation ? 'setup-observation' : undefined}
              >
                <div role="status" aria-live="polite" aria-atomic="true">
                  {showObservation && (
                    <p
                      id="setup-observation-text"
                      className={`formation-setup-hint${missingCoders ? ' setup-coding-warning' : ''}`}
                      data-testid={`setup-observation-${observation.id}`}
                    >
                      {observation.text}
                    </p>
                  )}
                </div>
                {showObservation &&
                  (missingCoders ? (
                    <button
                      type="button"
                      className="btn btn-secondary setup-observation-action"
                      data-testid="setup-assign-coder"
                      disabled={readOnly || !assignmentTarget}
                      onClick={focusCodingAssignment}
                    >
                      割り当てる
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary setup-observation-action"
                      aria-label="案内を閉じる"
                      onClick={dismissObservation}
                      data-testid="setup-observation-dismiss"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
          <button
            ref={beginRef}
            type="button"
            className="primary-button"
            data-testid="begin-sprint"
            aria-label="スプリント開始"
            aria-describedby={missingCoders ? 'setup-observation-text' : undefined}
            disabled={readOnly}
            onClick={() => {
              if (readOnly) return;
              if (missingCoders) setConfirmation({ key: confirmationKey, open: true });
              else onBegin();
            }}
          >
            スプリント開始 ▶
          </button>
        </div>
        <FormationGrid
          state={state}
          onAssign={onAssign}
          onToggleAi={onToggleAi}
          readOnly={readOnly}
        />
        {readOnly ? <DeckBar deck={state.deck} /> : null}
      </div>
      {showConfirmation && !readOnly && missingCoders && (
        <MissingCoderConfirm
          canAssign={!!assignmentTarget}
          onCancel={() => setConfirmation({ key: confirmationKey, open: false })}
          onAssign={() => {
            setConfirmation({ key: confirmationKey, open: false });
            // overlay の inert とフォーカス復帰が解除された後で配置操作へ移す。
            assignmentTimerRef.current = setTimeout(focusCodingAssignment, 0);
          }}
          onBegin={() => {
            setConfirmation({ key: confirmationKey, open: false });
            onBegin();
          }}
        />
      )}
    </div>
  );
}
