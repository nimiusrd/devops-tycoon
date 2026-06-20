/**
 * メイン画面（SPEC 第4章 / 第6章 / 第7章 / mockups/main-screen 準拠）。
 *
 * HUD（第4.2）＋ 盤面（第4.1）＋ 介入アクションバー（第6章）＋ コンボ/数字ポップ（第18.2）。
 * 1 スプリントを自動進行しつつリアルタイムに介入して捌き、終了時はリザルト（第4.6）→
 * カードドラフト（第7章）でデッキを育てて次スプリントへ進む。
 */
import { useState } from 'react';
import { Board } from './render/Board';
import { reviewQueueLength } from './render/status';
import {
  ActionBar,
  ComboBadge,
  DeckBar,
  DraftScreen,
  Hud,
  PointPops,
  SprintResultScreen,
  useSprint,
} from './ui';
import type { GameHandle } from './game';

export interface AppProps {
  game: GameHandle;
}

export default function App({ game }: AppProps) {
  const {
    state,
    complete,
    result,
    aiEnabled,
    deck,
    draft,
    setAiEnabled,
    dispatch,
    chooseCard,
    skipDraft,
    restart,
  } = useSprint(game);
  // リザルト → ドラフトの2段表示を制御する。
  const [drafting, setDrafting] = useState(false);

  const queue = reviewQueueLength(state.sprint.tasks);
  const jamPct = Math.min(100, (queue / 18) * 100);

  const handlePick = (defId: string) => {
    setDrafting(false);
    chooseCard(defId);
  };
  const handleSkip = () => {
    setDrafting(false);
    skipDraft();
  };

  return (
    <div className="app">
      <Hud state={state} />

      <div className="subbar">
        <span className="pill" data-testid="seed">
          seed <b>{state.seed}</b>
        </span>
        <span className="pill" data-testid="sprint-no">
          スプリント <b>{state.sprintIndex + 1}</b>
        </span>
        <span className="pill">
          progress{' '}
          <b>
            {Math.round((state.sprint.metrics.doneCount / state.sprint.config.taskCount) * 100)}%
          </b>
        </span>
        <label className="ai-toggle" data-testid="ai-toggle">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
            data-testid="ai-toggle-input"
          />
          <span>AI導入 {aiEnabled ? 'ON' : 'OFF'}</span>
        </label>
        <div className="meter-wrap">
          <span className="meter-label">渋滞メーター</span>
          <div className={`meter${queue >= 12 ? ' jam' : ''}`}>
            <i style={{ width: `${jamPct}%` }} />
          </div>
        </div>
        <ComboBadge combo={state.sprint.metrics.combo} />
        <button type="button" className="btn" onClick={restart} data-testid="restart">
          ↻ 新しいラン
        </button>
      </div>

      <main className="board-wrap">
        <PointPops deliveryScore={state.org.deliveryScore} />
        <Board state={state} />
      </main>

      <DeckBar deck={deck} />

      <ActionBar sprint={state.sprint} disabled={complete} onAction={dispatch} />

      {complete && result && !drafting && (
        <SprintResultScreen
          result={result}
          aiEnabled={aiEnabled}
          onRestart={restart}
          onContinue={() => setDrafting(true)}
        />
      )}

      {complete && drafting && draft && (
        <DraftScreen
          options={draft}
          sprintNumber={state.sprintIndex + 2}
          onPick={handlePick}
          onSkip={handleSkip}
        />
      )}
    </div>
  );
}
