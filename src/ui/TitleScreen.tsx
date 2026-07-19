/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 * レイアウトは司令室 UI の構図を使い、文言は SPEC の用語に揃える。
 */
import { useState } from 'react';
import { DIFFICULTY_DEFS, TRIAL_DEFS, getTrial } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, getDailyRecord, utcDateStr, type MetaState } from '../state/meta';
import type { RunSaveSummary } from '../state/runPersistence';
import type { DifficultyId } from '../sim/run/types';

const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];
const DIFFICULTY_TAG: Record<DifficultyId, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  nightmare: 'Nightmare',
};

const PHASE_LABEL: Record<RunSaveSummary['phase'], string> = {
  setup: '編成',
  result: 'リザルト',
  draft: 'ドラフト',
  evolution: '進化',
  beat: 'イベント',
  shop: 'ショップ',
  rest: '休息',
  recruit: '採用',
  quarterReview: '四半期レビュー',
};

export interface TitleScreenProps {
  seed: string;
  meta: MetaState;
  onStart: (difficulty: DifficultyId, trials: string[]) => void;
  onStartDaily?: () => void;
  onResume?: () => void;
  resumableSummary?: RunSaveSummary | null;
  onOpenMetaShop?: () => void;
  onOpenAchievements?: () => void;
  /** サウンドミュート切替（RI-59）。 */
  onToggleSoundMuted?: () => void;
  onOpenHelp?: () => void;
}

export function TitleScreen({
  seed,
  meta,
  onStart,
  onStartDaily,
  onResume,
  resumableSummary = null,
  onOpenMetaShop,
  onOpenAchievements,
  onToggleSoundMuted,
  onOpenHelp,
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
        <img className="title-world-backdrop" src="/assets/title-arena-backdrop.svg" alt="" />
        <img className="title-world-platform" src="/assets/title-command-platform.svg" alt="" />
        <img className="title-world-core" src="/assets/title-ai-core.svg" alt="" />
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
            <b>DevOps Tycoon</b>
            <small>AI時代の開発組織シミュレーター</small>
          </span>
        </div>
        <div className="title-season">
          <small>基本単位</small>
          <b>1ラン = 1四半期</b>
        </div>
        <div className="title-career">
          <span>
            <small>メタ進行</small>
            <b>{meta.points} pt</b>
          </span>
          <span>
            <small>自己ベスト</small>
            <b>{meta.bestScore} pt</b>
          </span>
        </div>
      </header>

      <div className="title-content">
        <header className="title-head">
          <p className="title-eyebrow">
            <span /> ラン開始 — 組織と難易度を選ぶ
          </p>
          <h1 className="title-logo">
            DevOps Tycoon
            <br />
            <em>制約の中で、AIを活かせ。</em>
          </h1>
          <p className="title-sub">
            レビュー渋滞、技術的負債、士気、そして AI の効きどころ。
            <br />
            1四半期で開発組織の運営を体験するシミュレーション。
          </p>
          <div className="title-hero-badges" aria-label="ゲームの特徴">
            <span>WebGL レイヤー想定</span>
            <span>組織盤面 × カード戦略</span>
            <span>AI ブースト演出</span>
          </div>
          <div className="title-meta">
            <span className="pill" data-testid="seed">
              seed <b>{seed}</b>
            </span>
            <span className="pill">
              難易度 <b>{DIFFICULTY_TAG[difficulty]}</b>
            </span>
            <span className="pill">
              試練 <b>{trials.length}</b>
            </span>
          </div>
        </header>

        <main className="title-deck">
          <div className="title-deck-head">
            <div>
              <span className="title-step">01</span>
              <p>
                <b>難易度（組織の状態）</b>
                <small>開始する組織の成熟度を選ぶ</small>
              </p>
            </div>
            <span className="title-ready">
              <i /> 準備完了
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
                      <i>{unlocked ? '選択可' : '未解放'}</i>
                    </span>
                    <span className="difficulty-name">{def.label}</span>
                    <span className="difficulty-desc">
                      {unlocked ? def.description : '🔒 未解放（下位難易度をクリアで解放）'}
                    </span>
                    <span className="difficulty-action">
                      {unlocked ? 'この組織で始める →' : '条件未達'}
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
                <b>試練（ランモディファイア）</b>
                <small>任意。スコア倍率と引き換えに難度を上げる</small>
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

          {resumableSummary && onResume ? (
            <section className="title-resume" data-testid="resume-run-section">
              <div className="title-resume-copy">
                <span>中断中のラン</span>
                <b>
                  {DIFFICULTY_TAG[resumableSummary.difficulty]} / Q{resumableSummary.quarterNumber}{' '}
                  {PHASE_LABEL[resumableSummary.phase]}
                </b>
                <small>
                  スプリント {resumableSummary.sprintsPlayed} 完了
                  {resumableSummary.runKind === 'daily' && resumableSummary.dailyDate
                    ? ` · デイリー ${resumableSummary.dailyDate}`
                    : ''}
                </small>
              </div>
              <button
                type="button"
                className="title-resume-btn"
                data-testid="resume-run"
                onClick={onResume}
              >
                続きから再開 →
              </button>
            </section>
          ) : null}

          {onStartDaily ? (
            <section className="title-launch-row" data-testid="daily-run-section">
              <div className="title-daily">
                <span>デイリーラン</span>
                <b>全員同じシードで競う</b>
                <small>
                  UTC {today}・{dailyStatus}
                </small>
                <button type="button" data-testid="start-daily-run" onClick={onStartDaily}>
                  本日のデイリーを始める →
                </button>
              </div>
              <div className="title-mission">
                <small>今回の設定</small>
                <b>
                  {DIFFICULTY_TAG[difficulty]} / 試練 {trials.length}
                </b>
                <span>
                  最終倍率 <strong>×{scoreMultiplier.toFixed(2)}</strong>
                </span>
              </div>
              <button
                type="button"
                className="title-launch"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials)}
              >
                <span>
                  <small>ラン開始</small>
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
            <span>実績</span>
            {meta.achievements.map((achievement) => (
              <b key={achievement}>🏅 {ACHIEVEMENT_LABEL[achievement] ?? achievement}</b>
            ))}
          </section>
        )}

        <footer className="title-footer">
          <span>{selectedDifficulty.label}</span>
          <nav>
            {onToggleSoundMuted && (
              <button
                type="button"
                data-testid="sound-mute"
                aria-pressed={meta.soundMuted}
                onClick={onToggleSoundMuted}
              >
                {meta.soundMuted ? 'ミュート中' : '音あり'}
              </button>
            )}
            {onOpenHelp && (
              <button type="button" data-testid="open-help" onClick={onOpenHelp}>
                遊び方
              </button>
            )}
            {onOpenMetaShop && (
              <button type="button" data-testid="open-meta-shop" onClick={onOpenMetaShop}>
                研修ツール解禁（メタショップ）
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
