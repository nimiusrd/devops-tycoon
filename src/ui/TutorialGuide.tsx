/**
 * 初回スプリント向けの段階ガイド（RI-60）。
 *
 * UI 層のみ。sim の step / dispatch / RNG には触れない。
 * ハイライトは `document.body[data-tutorial-step]` 経由の CSS で行う。
 *
 * チャンク読込後（SprintSuspendFallback 解除後）にマウントされる前提で、
 * ガイド表示中の自動進行停止をここで所有する。
 */
import { useEffect, useState } from 'react';
import type { GameHandle } from '../game';
import { TUTORIAL_STEPS, type TutorialStepId } from './tutorial';

export interface TutorialGuideProps {
  game: GameHandle;
  onDismiss: () => void;
}

export function TutorialGuide({ game, onDismiss }: TutorialGuideProps) {
  const [index, setIndex] = useState(0);
  const step = TUTORIAL_STEPS[index] ?? TUTORIAL_STEPS[0];
  const isLast = index >= TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    const stepId: TutorialStepId = step.id;
    document.body.dataset.tutorialStep = stepId;
    return () => {
      delete document.body.dataset.tutorialStep;
    };
  }, [step.id]);

  // E2E 等が既に pause 済みなら触らない。未 pause なら所有して閉じるまで維持する。
  useEffect(() => {
    if (game.isPaused()) return;
    game.pause();
    const epoch = game.getPauseEpoch();
    return () => {
      if (game.getPauseEpoch() === epoch) game.resume();
    };
  }, [game]);

  const goNext = () => {
    if (isLast) {
      onDismiss();
      return;
    }
    setIndex((current) => current + 1);
  };

  return (
    <div
      className="tutorial-guide"
      data-testid="tutorial-guide"
      data-step={step.id}
      role="dialog"
      aria-label="初回ガイド"
    >
      <div className="tutorial-guide-card">
        <p className="tutorial-guide-eyebrow">
          初回ガイド {index + 1}/{TUTORIAL_STEPS.length}
        </p>
        <h3 className="tutorial-guide-title" data-testid={`tutorial-step-${step.id}`}>
          {step.title}
        </h3>
        <p className="tutorial-guide-body">{step.body}</p>
        <div className="tutorial-guide-actions">
          <button type="button" className="btn" data-testid="tutorial-skip" onClick={onDismiss}>
            スキップ
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="tutorial-next"
            onClick={goNext}
          >
            {isLast ? '始める' : '次へ'}
          </button>
        </div>
      </div>
    </div>
  );
}
