import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getAction } from '../data/actions';
import type { GameHandle } from '../game';
import { formatInterventionFailure } from '../render/actionBarView';
import {
  planReviewCommand,
  REVIEW_COMMAND_ACTIONS,
  REVIEW_COMMAND_PANEL_ID,
  type ReviewCommandAction,
} from '../render/reviewCommandView';
import { getWebglStatus } from '../render/webglStatus';
import type { RunState } from '../sim/run/types';
import type { InterventionOutcome, SprintState } from '../sim/types';

interface ReviewCommandPanelProps {
  state: Pick<RunState, 'activeTeamId' | 'currentSprintId' | 'org' | 'sprintTick'>;
  sprint: SprintState;
  paused: boolean;
  game: GameHandle;
  onInspect: (id: ReviewCommandAction) => void;
  onDispatch: (id: ReviewCommandAction) => InterventionOutcome;
  onClose: () => void;
}

export function ReviewCommandPanel({
  state,
  sprint,
  paused,
  game,
  onInspect,
  onDispatch,
  onClose,
}: ReviewCommandPanelProps) {
  const [selection, setSelection] = useState<{
    id: ReviewCommandAction;
    confirmationKey: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const firstOption = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    firstOption.current?.focus();
  }, []);

  const choice = selection
    ? planReviewCommand(
        sprint,
        state.org,
        state.sprintTick,
        selection.id,
        paused ? 'paused' : undefined,
      )
    : null;
  const needsReview = selection?.confirmationKey !== choice?.confirmationKey;
  const status = choice?.availability.blockMessage;

  function handleChoose(id: ReviewCommandAction) {
    const { confirmationKey } = planReviewCommand(sprint, state.org, state.sprintTick, id);
    setSelection({ id, confirmationKey });
    setMessage('');
    onInspect(id);
  }

  function confirm() {
    if (!selection || confirmed.current) return;
    const current = game.getState();
    if (
      !current.sprint ||
      current.phase !== 'sprint' ||
      current.currentSprintId !== state.currentSprintId ||
      current.activeTeamId !== state.activeTeamId ||
      current.zoom.level !== 'team' ||
      game.isReplayMode()
    ) {
      onClose();
      return;
    }
    if (getWebglStatus() !== 'ready') {
      setMessage('盤面が表示されてから実行してください。');
      return;
    }
    const latest = planReviewCommand(
      current.sprint,
      current.org,
      current.sprintTick,
      selection.id,
      paused ? 'paused' : undefined,
    );
    if (latest.confirmationKey !== selection.confirmationKey) {
      setSelection({ id: selection.id, confirmationKey: latest.confirmationKey });
      setMessage('現在の効果と代償を確認してから実行してください。');
      return;
    }
    if (!latest.availability.canActivate) {
      setMessage(latest.availability.blockMessage ?? '');
      return;
    }

    confirmed.current = true;
    const outcome = onDispatch(selection.id);
    if (outcome.ok) {
      onClose();
    } else {
      confirmed.current = false;
      setMessage(
        outcome.reason
          ? formatInterventionFailure(outcome.reason, selection.id)
          : '介入を実行できませんでした。',
      );
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <section
      id={REVIEW_COMMAND_PANEL_ID}
      data-testid="review-command-panel"
      className="action-inspect-panel review-command-panel"
      aria-labelledby="review-command-title"
      onKeyDown={handleKeyDown}
    >
      <div className="review-command-options">
        <strong id="review-command-title">レビュー工程の介入</strong>
        <div className="review-command-buttons" role="group" aria-label="介入を選ぶ">
          {REVIEW_COMMAND_ACTIONS.map((id, index) => (
            <button
              key={id}
              ref={index === 0 ? firstOption : undefined}
              type="button"
              className="btn"
              data-testid={`review-command-${id}`}
              aria-pressed={selection?.id === id}
              onClick={() => handleChoose(id)}
            >
              {id === 'andon' ? '流入停止（アンドン）' : getAction(id)!.label}
            </button>
          ))}
        </div>
      </div>
      {choice && (
        <dl
          className="action-inspect-facts review-command-facts"
          data-testid="review-command-facts"
        >
          <div>
            <dt>作用先</dt>
            <dd>{choice.targetLabel}</dd>
          </div>
          <div>
            <dt>効果</dt>
            <dd>{choice.effect}</dd>
          </div>
          <div>
            <dt>代償</dt>
            <dd>
              集中力 {choice.action.cost} / {choice.tradeoff}
            </dd>
          </div>
        </dl>
      )}
      <div className="review-command-confirmation">
        {choice && (
          <div>
            <span role="status">
              {status ??
                (needsReview
                  ? '状況が変わりました。効果と代償をもう一度確認してください。'
                  : message || '実行可能')}
            </span>
            {choice.cooldownRemaining > 0 && `（CD 残り ${choice.cooldownRemaining} tick）`}
          </div>
        )}
        <div className="review-command-buttons">
          <button type="button" className="btn" onClick={onClose}>
            {choice ? '取消' : '閉じる'}
          </button>
          {choice && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!choice.availability.canActivate}
              onClick={confirm}
              data-testid="review-command-confirm"
            >
              {needsReview ? '変更を確認' : '実行する'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
