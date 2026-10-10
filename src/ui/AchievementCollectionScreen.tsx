/**
 * 実績コレクション画面（SPEC 第17章 / RI-34″ 失敗図鑑）。
 *
 * 取得済み／未取得の実績を一覧表示し、未取得には獲得条件のヒントを出す。
 * 描画は meta を読むだけ（第22.2）。
 */
import { useRef } from 'react';
import { diagnosisTheme } from '../render/diagnosisTheme';
import { FAILURE_ENCYCLOPEDIA_DEFS } from '../sim/diagnosis';
import {
  ACHIEVEMENT_DEFS,
  buildWinComboCodex,
  WIN_TITLE_DEFS,
  type MetaState,
} from '../state/meta';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';
import { VisualIcon } from './VisualIcon';

export interface AchievementCollectionScreenProps {
  meta: MetaState;
  onClose: () => void;
}

export function AchievementCollectionScreen({ meta, onClose }: AchievementCollectionScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef, { restoreFocus: true, onDismiss: onClose });
  const earned = new Set(meta.achievements);
  const earnedCount = ACHIEVEMENT_DEFS.filter((a) => earned.has(a.id)).length;
  const collectedTitles = new Set(meta.collectedWinTypes);
  const titleCount = WIN_TITLE_DEFS.filter((title) => collectedTitles.has(title.id)).length;
  const combos = buildWinComboCodex(meta);
  const collectedDiagnoses = new Set(meta.collectedDiagnoses);
  const failureCount = FAILURE_ENCYCLOPEDIA_DEFS.filter((def) =>
    collectedDiagnoses.has(def.type),
  ).length;

  return (
    <ResultOverlay
      ref={overlayRef}
      data-testid="achievement-collection"
      role="dialog"
      aria-modal="true"
      aria-label="Achievement collection"
      tabIndex={-1}
    >
      <div className="achievement-collection-panel">
        <div className="result-overlay-body" tabIndex={0}>
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
          <section className="title-collection-section" aria-labelledby="title-collection-heading">
            <p className="result-eyebrow">WIN TITLES</p>
            <h3 id="title-collection-heading" className="title-collection-heading">
              勝利称号{' '}
              <b data-testid="win-title-count">
                {titleCount}/{WIN_TITLE_DEFS.length}
              </b>
            </h3>
            <p className="achievement-collection-lead">
              勝利時のプレイスタイルに応じた称号です。ボスを突破して集めましょう。
            </p>
            <div className="achievement-collection-grid">
              {WIN_TITLE_DEFS.map((def) => {
                const unlocked = collectedTitles.has(def.id);
                return (
                  <div
                    key={def.id}
                    className={`achievement-card${unlocked ? ' unlocked' : ' locked'}`}
                    data-testid={`win-title-${def.id}`}
                    data-unlocked={unlocked ? 'true' : 'false'}
                  >
                    <span className="achievement-card-icon">{unlocked ? '🏆' : '🔒'}</span>
                    <span className="achievement-card-label">{def.label}</span>
                    <p className="achievement-card-hint" data-testid={`win-title-hint-${def.id}`}>
                      {unlocked ? def.description : def.hint}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
          <section
            className="title-collection-section"
            aria-labelledby="win-combo-heading"
            data-testid="win-combo-codex"
          >
            <p className="result-eyebrow">WIN COMBOS</p>
            <h3 id="win-combo-heading" className="title-collection-heading">
              難易度別の勝ち方{' '}
              <b data-testid="win-combo-count">
                {combos.achievedCount}/{combos.total}
              </b>
            </h3>
            <p className="achievement-collection-lead">
              どの難易度でどの勝ち方をしたかを記録します。記録を始める前の勝利は含みません。
            </p>
            <p className="win-combo-next" data-testid="win-combo-next">
              {combos.nextGoal
                ? `次の目標: ${combos.nextGoal.label} で未達の勝ち方 ${combos.nextGoal.remaining.length} 種`
                : '解放済みの難易度で、すべての勝ち方を達成しました。'}
            </p>
            <ul className="win-combo-rows">
              {combos.rows.map((row) => (
                <li
                  key={row.difficulty}
                  className={`achievement-card${row.unlocked ? '' : ' locked'}`}
                  data-testid={`win-combo-row-${row.difficulty}`}
                  data-unlocked={row.unlocked ? 'true' : 'false'}
                >
                  <span className="achievement-card-label">
                    {row.label}{' '}
                    <span className="win-combo-row-count">
                      {row.unlocked
                        ? `${row.achievedCount}/${row.cells.length}`
                        : '前の難易度でボスを突破すると解放'}
                    </span>
                  </span>
                  {row.unlocked ? (
                    <ul className="win-combo-cells" aria-label={`${row.label} の勝ち方`}>
                      {row.cells.map((cell) => (
                        <li
                          key={cell.winType}
                          className={`pill pill-compact${cell.achieved ? ' achievement' : ''}`}
                          data-testid={`win-combo-${row.difficulty}-${cell.winType}`}
                          data-achieved={cell.achieved ? 'true' : 'false'}
                        >
                          {cell.achieved ? `✓ ${cell.label}` : `未達 ${cell.label}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="achievement-card-hint">難易度未解放</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section
            className="title-collection-section"
            aria-labelledby="failure-encyclopedia-heading"
            data-testid="failure-encyclopedia"
          >
            <p className="result-eyebrow">FAILURE CODEX</p>
            <h3 id="failure-encyclopedia-heading" className="title-collection-heading">
              AI導入失敗図鑑{' '}
              <b data-testid="failure-encyclopedia-count">
                {failureCount}/{FAILURE_ENCYCLOPEDIA_DEFS.length}
              </b>
            </h3>
            <p className="achievement-collection-lead">
              ラン終了時の組織タイプ診断から、失敗パターンを集めます。取得済みは教訓も表示されます。
            </p>
            <div className="achievement-collection-grid">
              {FAILURE_ENCYCLOPEDIA_DEFS.map((def) => {
                const unlocked = collectedDiagnoses.has(def.type);
                const theme = diagnosisTheme(def.type);
                return (
                  <div
                    key={def.type}
                    className={`achievement-card${unlocked ? ' unlocked' : ' locked'}`}
                    data-testid={`failure-entry-${def.type}`}
                    data-unlocked={unlocked ? 'true' : 'false'}
                  >
                    <span className="achievement-card-icon">
                      {unlocked ? <VisualIcon name={theme.icon} size="card" /> : '🔒'}
                    </span>
                    <span className="achievement-card-label">{def.label}</span>
                    <p
                      className="achievement-card-hint"
                      data-testid={`failure-entry-hint-${def.type}`}
                    >
                      {unlocked ? `${def.description} ${def.lesson}` : def.hint}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <button
          type="button"
          className="btn btn-secondary result-overlay-close"
          data-testid="achievement-collection-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
