/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 */
import { useState } from 'react';
import { DIFFICULTY_DEFS, TRIAL_DEFS, getTrial } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, getDailyRecord, utcDateStr, type MetaState } from '../state/meta';
import type { DifficultyId } from '../sim/run/types';

const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

export interface TitleScreenProps {
  seed: string;
  meta: MetaState;
  onStart: (difficulty: DifficultyId, trials: string[]) => void;
  onStartDaily?: () => void;
  onOpenMetaShop?: () => void;
  onOpenAchievements?: () => void;
}

export function TitleScreen({
  seed,
  meta,
  onStart,
  onStartDaily,
  onOpenMetaShop,
  onOpenAchievements,
}: TitleScreenProps) {
  const firstUnlocked = DIFFICULTY_ORDER.find((d) => meta.unlockedDifficulties.includes(d));
  const [difficulty, setDifficulty] = useState<DifficultyId>(firstUnlocked ?? 'normal');
  const [trials, setTrials] = useState<string[]>([]);
  const today = utcDateStr();
  const dailyRecord = getDailyRecord(meta, today);
  const scoreMul = trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);
  const selectedDifficulty = DIFFICULTY_DEFS[difficulty];

  const toggleTrial = (id: string) =>
    setTrials((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  return (
    <div className="title-screen" data-testid="title">
      <div className="title-atmosphere" aria-hidden="true" />

      <div className="title-content">
        <header className="title-head">
          <p className="title-kicker">組織シミュレーション</p>
          <h1 className="title-logo">DevOps Tycoon</h1>
          <p className="title-sub">
            AI時代の開発組織を、1ラン＝1四半期で指揮する。
            <br />
            文化・負債・人間関係を立て直し、リリースまで走り切ろう。
          </p>
          <div className="title-meta">
            <span className="pill" data-testid="seed">
              seed <b>{seed}</b>
            </span>
            <span className="pill">
              メタ進行 <b>{meta.points}</b> pt
            </span>
            <span className="pill">
              自己ベスト <b>{meta.bestScore}</b> pt
            </span>
          </div>
        </header>

        <main className="title-deck">
          <section className="title-section title-difficulty-section">
            <div className="title-section-head">
              <h2 className="title-section-label">難易度</h2>
              <p className="title-section-note">開始する組織の成熟度を選ぶ</p>
            </div>
            <div className="difficulty-grid">
              {DIFFICULTY_ORDER.map((id) => {
                const def = DIFFICULTY_DEFS[id];
                const unlocked = meta.unlockedDifficulties.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`difficulty-card${difficulty === id ? ' selected' : ''}`}
                    data-testid={`difficulty-${id}`}
                    disabled={!unlocked}
                    onClick={() => setDifficulty(id)}
                  >
                    <div className="difficulty-name">{def.label}</div>
                    <div className="difficulty-desc">
                      {unlocked ? def.description : '🔒 未解放（下位難易度をクリアで解放）'}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="title-section title-trial-section">
            <div className="title-section-head">
              <h2 className="title-section-label">試練（任意 / スコア倍率↑）</h2>
              <span className="title-score-mul">
                最終倍率 <b>×{scoreMul.toFixed(2)}</b>
              </span>
            </div>
            <div className="trial-row">
              {TRIAL_DEFS.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`trial-chip${trials.includes(t.id) ? ' on' : ''}`}
                  data-testid={`trial-${t.id}`}
                  onClick={() => toggleTrial(t.id)}
                  title={t.description}
                >
                  {t.label} <small>×{t.scoreMul.toFixed(2)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="title-launch-section">
            {onStartDaily && (
              <div className="title-daily-block" data-testid="daily-run-section">
                <h2 className="title-section-label">デイリーラン（社内コンテスト）</h2>
                <p className="title-daily-desc">
                  全員同じ seed・Normal 固定で競う。UTC {today} の記録。
                  {dailyRecord ? (
                    <>
                      {' '}
                      今日のベスト <b>{dailyRecord.bestScore}</b> pt
                      {dailyRecord.rewardClaimed ? ' / 報酬受領済み' : ' / 報酬未受領'}
                    </>
                  ) : (
                    <> まだ今日の記録はありません。</>
                  )}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="start-daily-run"
                  onClick={onStartDaily}
                >
                  本日のデイリーを始める →
                </button>
              </div>
            )}

            <div className="title-mission-block">
              <p className="title-mission-label">今回の設定</p>
              <p className="title-mission-summary">
                <b>{selectedDifficulty.label}</b>
                <span>
                  試練 {trials.length} / 倍率 ×{scoreMul.toFixed(2)}
                </span>
              </p>
              <button
                type="button"
                className="btn btn-primary btn-lg title-start-btn"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials)}
              >
                四半期を始める →
              </button>
            </div>
          </section>
        </main>

        {meta.achievements.length > 0 && (
          <section className="title-section title-achievements">
            <h2 className="title-section-label">実績</h2>
            <div className="trial-row">
              {meta.achievements.map((a) => (
                <span key={a} className="pill achievement">
                  🏅 {ACHIEVEMENT_LABEL[a] ?? a}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="title-actions">
          {onOpenMetaShop && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="open-meta-shop"
              onClick={onOpenMetaShop}
            >
              研修ツール解禁（メタショップ）
            </button>
          )}

          {onOpenAchievements && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="open-achievements"
              onClick={onOpenAchievements}
            >
              実績コレクション
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
