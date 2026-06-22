/**
 * 実績コレクション画面（SPEC 第17章）。
 *
 * 取得済み／未取得の実績を一覧表示し、未取得には獲得条件のヒントを出す。
 * 描画は meta を読むだけ（第22.2）。
 */
import { ACHIEVEMENT_DEFS, type MetaState } from '../state/meta';

export interface AchievementCollectionScreenProps {
  meta: MetaState;
  onClose: () => void;
}

export function AchievementCollectionScreen({ meta, onClose }: AchievementCollectionScreenProps) {
  const earned = new Set(meta.achievements);
  const earnedCount = ACHIEVEMENT_DEFS.filter((a) => earned.has(a.id)).length;

  return (
    <div
      className="result-overlay"
      data-testid="achievement-collection"
      role="dialog"
      aria-label="Achievement collection"
    >
      <div className="achievement-collection-panel">
        <p className="result-eyebrow">ACHIEVEMENTS</p>
        <h2 className="draft-title">
          実績コレクション{' '}
          <b data-testid="achievement-count">
            {earnedCount}/{ACHIEVEMENT_DEFS.length}
          </b>
        </h2>
        <p className="achievement-collection-lead">
          四半期を完走して実績を集めましょう。未取得の条件はヒントとして表示されます。
        </p>
        <div className="achievement-collection-grid">
          {ACHIEVEMENT_DEFS.map((def) => {
            const unlocked = earned.has(def.id);
            return (
              <div
                key={def.id}
                className={`achievement-card${unlocked ? ' unlocked' : ' locked'}`}
                data-testid={`achievement-${def.id}`}
                data-unlocked={unlocked ? 'true' : 'false'}
              >
                <span className="achievement-card-icon">{unlocked ? '🏅' : '🔒'}</span>
                <span className="achievement-card-label">{def.label}</span>
                <p className="achievement-card-hint" data-testid={`achievement-hint-${def.id}`}>
                  {unlocked ? '達成済み' : def.hint}
                </p>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="achievement-collection-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
