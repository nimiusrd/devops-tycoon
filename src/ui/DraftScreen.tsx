/**
 * スプリント後のカードドラフト（SPEC 第7.1）。
 *
 * 提示された 3 枚から 1 枚を選んでデッキに加え、次スプリントを開始する。
 * 同じデッキでも捌き方で結果が変わり、ドラフトでデッキが育っていく（第7章）。
 */
import { getCard } from '../data/cards';
import { CardView } from './CardView';

export interface DraftScreenProps {
  /** 提示カードの定義 ID（3 枚）。 */
  options: string[];
  /** 次スプリントが何回目か（表示用、1 起点）。 */
  sprintNumber: number;
  onPick: (defId: string) => void;
  onSkip: () => void;
}

export function DraftScreen({ options, sprintNumber, onPick, onSkip }: DraftScreenProps) {
  return (
    <div className="result-overlay" data-testid="draft" role="dialog" aria-label="Card Draft">
      <div className="draft-card-panel">
        <p className="result-eyebrow">CARD DRAFT</p>
        <h2 className="draft-title">スプリント{sprintNumber} に向けて、施策を1枚選ぶ</h2>
        <div className="draft-options">
          {options.map((id) => {
            const def = getCard(id);
            if (!def) return null;
            return <CardView key={id} def={def} onPick={() => onPick(id)} />;
          })}
        </div>
        <button type="button" className="btn" onClick={onSkip} data-testid="draft-skip">
          スキップして進む
        </button>
      </div>
    </div>
  );
}
