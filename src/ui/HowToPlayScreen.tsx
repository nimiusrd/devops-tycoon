/**
 * タイトルからの「遊び方」ヘルプ（RI-60 / RI-67）。
 *
 * 世界観の制約（第2.1）に沿った現実的なトーンで、初見が最初のスプリントまで
 * 到達できる最低限の操作を説明する。描画は読むだけ（第22.2）。
 */
import { HOW_TO_PLAY_SECTIONS } from './howToPlayContent';

export interface HowToPlayScreenProps {
  onClose: () => void;
}

export function HowToPlayScreen({ onClose }: HowToPlayScreenProps) {
  return (
    <div className="result-overlay" data-testid="how-to-play" role="dialog" aria-label="遊び方">
      <div className="how-to-play-panel">
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
        <button
          type="button"
          className="btn btn-primary"
          data-testid="how-to-play-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
