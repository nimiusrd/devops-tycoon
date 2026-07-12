/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 * 見た目は戦略司令室 UI（デザイン案）に寄せ、値の持ち方は既存実装を維持する。
 */
import { useState } from 'react';
import { DIFFICULTY_DEFS, TRIAL_DEFS, getTrial } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, getDailyRecord, utcDateStr, type MetaState } from '../state/meta';
import type { DifficultyId } from '../sim/run/types';

const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];
const DIFFICULTY_TAG: Record<DifficultyId, string> = {
  easy: 'EASY',
  normal: 'NORMAL',
  hard: 'HARD',
  nightmare: 'NIGHTMARE',
};

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
  const selectedDifficulty = DIFFICULTY_DEFS[difficulty];
  const scoreMultiplier = trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);

  const toggleTrial = (id: string) =>
    setTrials((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const dailyStatus = dailyRecord
    ? `今日のベスト ${dailyRecord.bestScore} pt${dailyRecord.rewardClaimed ? ' / 報酬受領済み' : ' / 報酬未受領'}`
    : 'まだ今日の記録はありません';

  return (
    <div className="title-screen title-command" data-testid="title">
      <div className="title-world" aria-hidden="true">
        <div className="title-scanlines" />
        <div className="title-orbit title-orbit-a" />
        <div className="title-orbit title-orbit-b" />
      </div>

      <header className="title-topbar">
        <div className="title-brand">
          <span className="title-brand-mark">
            D<span>O</span>
          </span>
          <span>
            <b>DEVOPS TYCOON</b>
            <small>AI ERA // ORGANIZATION SIM</small>
          </span>
        </div>
        <div className="title-season">
          <small>SEASON 01</small>
          <b>THE AGENTIC SHIFT</b>
        </div>
        <div className="title-career">
          <span>
            <small>META RANK</small>
            <b>{meta.points}</b>
          </span>
          <span>
            <small>PERSONAL BEST</small>
            <b>{meta.bestScore}</b>
          </span>
        </div>
      </header>

      <div className="title-content">
        <header className="title-head">
          <p className="title-eyebrow">
            <span /> NEW QUARTER // Q3 2026
          </p>
          <h1 className="title-logo">
            組織を選び、
            <br />
            <em>AI時代を生き残れ。</em>
          </h1>
          <p className="title-sub">
            開発文化、技術的負債、そして人間関係。
            <br />
            90日でチームを変革する組織シミュレーション。
          </p>
          <div className="title-meta">
            <span className="pill" data-testid="seed">
              ◈ SEED <b>{seed}</b>
            </span>
            <span className="pill">⌁ 1 RUN = 1 QUARTER</span>
            <span className="pill">◎ EST. 18 MIN</span>
          </div>
        </header>

        <main className="title-deck">
          <div className="title-deck-head">
            <div>
              <span className="title-step">01</span>
              <p>
                <b>CHOOSE YOUR ORGANIZATION</b>
                <small>開始する組織の成熟度を選択</small>
              </p>
            </div>
            <span className="title-ready">
              <i /> SYSTEM READY
            </span>
          </div>

          <section className="title-section title-difficulty-section">
            <h2 className="title-section-label">難易度</h2>
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
                    <span className="difficulty-kicker">
                      <b>{DIFFICULTY_TAG[id]}</b>
                      <i>{unlocked ? 'SELECT' : 'LOCKED'}</i>
                    </span>
                    <span className="difficulty-name">{def.label}</span>
                    <span className="difficulty-desc">
                      {unlocked ? def.description : '未解放 — 下位難易度のクリアが必要'}
                    </span>
                    <span className="difficulty-action">
                      {unlocked ? '組織プロファイルを選択 →' : '条件未達'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="title-section title-trial-section">
            <div className="title-section-copy">
              <span className="title-step">02</span>
              <p>
                <b>ADD CHALLENGES</b>
                <small>任意の制約でスコア倍率を上げる</small>
              </p>
            </div>
            <div className="trial-row">
              {TRIAL_DEFS.map((trial) => (
                <button
                  type="button"
                  key={trial.id}
                  className={`trial-chip${trials.includes(trial.id) ? ' on' : ''}`}
                  data-testid={`trial-${trial.id}`}
                  onClick={() => toggleTrial(trial.id)}
                  title={trial.description}
                >
                  <i>{trials.includes(trial.id) ? '×' : '+'}</i>
                  {trial.label}
                  <small>×{trial.scoreMul.toFixed(2)}</small>
                </button>
              ))}
            </div>
          </section>

          {onStartDaily ? (
            <section className="title-launch-row" data-testid="daily-run-section">
              <div className="title-daily">
                <span>DAILY RUN</span>
                <b>全員同じ条件で競う</b>
                <small>
                  UTC {today}・{dailyStatus}
                </small>
                <button type="button" data-testid="start-daily-run" onClick={onStartDaily}>
                  本日のデイリー →
                </button>
              </div>
              <div className="title-mission">
                <small>MISSION PROFILE</small>
                <b>
                  {DIFFICULTY_TAG[difficulty]} / {trials.length} MODS
                </b>
                <span>
                  FINAL MULTIPLIER <strong>×{scoreMultiplier.toFixed(2)}</strong>
                </span>
              </div>
              <button
                type="button"
                className="title-launch"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials)}
              >
                <span>
                  <small>BEGIN THE QUARTER</small>
                  四半期を始める
                </span>
                <i>→</i>
              </button>
            </section>
          ) : (
            <div className="title-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials)}
              >
                四半期を始める →
              </button>
            </div>
          )}
        </main>

        {meta.achievements.length > 0 && (
          <section className="title-achievements">
            <span>RECENT ACHIEVEMENTS</span>
            {meta.achievements.slice(0, 3).map((achievement) => (
              <b key={achievement}>◇ {ACHIEVEMENT_LABEL[achievement] ?? achievement}</b>
            ))}
          </section>
        )}

        <footer className="title-footer">
          <span>{selectedDifficulty.label} // BUILD 0.8.21</span>
          <nav>
            {onOpenMetaShop && (
              <button type="button" data-testid="open-meta-shop" onClick={onOpenMetaShop}>
                研修ツール
              </button>
            )}
            {onOpenAchievements && (
              <button type="button" data-testid="open-achievements" onClick={onOpenAchievements}>
                実績コレクション
              </button>
            )}
          </nav>
        </footer>
      </div>
    </div>
  );
}
