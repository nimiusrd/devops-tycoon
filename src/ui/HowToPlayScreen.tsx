/**
 * タイトルからの「遊び方」ヘルプ（RI-60 / RI-67）。
 *
 * 世界観の制約（第2.1）に沿った現実的なトーンで、初見が最初のスプリントまで
 * 到達できる最低限の操作を説明する。描画は読むだけ（第22.2）。
 * Escape は親（App）が最前面判定つきで処理する。
 * フォーカス閉じ込めと閉じたあとの起点復帰は `useDialogOverlayLock` に任せる。
 */
import { ResultOverlay } from './ResultOverlay';
import { useRef } from 'react';
import { HOW_TO_PLAY_SECTIONS } from './howToPlayContent';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface HowToPlayScreenProps {
  onClose: () => void;
}

export function HowToPlayScreen({ onClose }: HowToPlayScreenProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(dialogRef, { restoreFocus: true });

  return (
    <ResultOverlay
      ref={dialogRef}
      className="how-to-play-overlay"
      data-testid="how-to-play"
      role="dialog"
      aria-modal="true"
      aria-label="遊び方"
      tabIndex={-1}
    >
      <button
        type="button"
        className="result-overlay-dismiss"
        data-testid="how-to-play-backdrop"
        aria-label="遊び方を閉じる"
        onClick={onClose}
      />
      <div className="how-to-play-panel">
        <div className="result-overlay-body">
          <p className="result-eyebrow">HOW TO PLAY</p>
          <h2 className="draft-title">遊び方</h2>
          <p className="how-to-play-lead">
            レビュー渋滞・技術的負債・士気・AI
            の効きどころ。制約の中で開発組織を回すための基本操作です。
          </p>
          <ol className="how-to-play-list">
            {HOW_TO_PLAY_SECTIONS.map((section) => (
              <li
                key={section.id}
                className="how-to-play-item"
                data-testid={`how-to-play-${section.id}`}
              >
                <b>{section.title}</b>
                <p>{section.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          className="btn btn-primary result-overlay-close"
          data-testid="how-to-play-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
