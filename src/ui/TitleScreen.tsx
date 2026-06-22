/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 */
import { useState } from 'react';
import { DIFFICULTY_DEFS, TRIAL_DEFS } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, type MetaState } from '../state/meta';
import type { DifficultyId } from '../sim/run/types';

const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

export interface TitleScreenProps {
  seed: string;
  meta: MetaState;
  onStart: (difficulty: DifficultyId, trials: string[]) => void;
  onOpenMetaShop?: () => void;
}

export function TitleScreen({ seed, meta, onStart, onOpenMetaShop }: TitleScreenProps) {
  const firstUnlocked = DIFFICULTY_ORDER.find((d) => meta.unlockedDifficulties.includes(d));
  const [difficulty, setDifficulty] = useState<DifficultyId>(firstUnlocked ?? 'normal');
  const [trials, setTrials] = useState<string[]>([]);

  const toggleTrial = (id: string) =>
    setTrials((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  return (
    <div className="title-screen" data-testid="title">
      <header className="title-head">
        <h1 className="title-logo">DevOps Tycoon</h1>
        <p className="title-sub">AI時代の開発組織シミュレーター — 1ラン＝1四半期</p>
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

      <section className="title-section">
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
                <div className="difficulty-name">{def.label}</div>
                <div className="difficulty-desc">
                  {unlocked ? def.description : '🔒 未解放（下位難易度をクリアで解放）'}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="title-section">
        <h2 className="title-section-label">試練（任意 / スコア倍率↑）</h2>
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

      {meta.achievements.length > 0 && (
        <section className="title-section">
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

      <button
        type="button"
        className="btn btn-primary btn-lg"
        data-testid="start-run"
        onClick={() => onStart(difficulty, trials)}
      >
        四半期を始める →
      </button>

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
    </div>
  );
}
