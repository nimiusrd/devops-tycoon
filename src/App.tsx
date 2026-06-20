/**
 * メイン画面（SPEC 第4章 / mockups/main-screen 準拠）。
 *
 * HUD（第4.2）＋ 盤面（第4.1）＋ AIあり/なしトグルで、1 スプリントを自動進行し、
 * 終了時にリザルト（第4.6）を重ねて表示する。AI 導入の有無で結果差を観察できる。
 */
import { Board } from './render/Board';
import { reviewQueueLength } from './render/status';
import { Hud, SprintResultScreen, useSprint } from './ui';
import type { GameHandle } from './game';

export interface AppProps {
  game: GameHandle;
}

export default function App({ game }: AppProps) {
  const { state, complete, result, aiEnabled, setAiEnabled, restart } = useSprint(game);
  const queue = reviewQueueLength(state.sprint.tasks);
  const jamPct = Math.min(100, (queue / 18) * 100);

  return (
    <div className="app">
      <Hud state={state} />

      <div className="subbar">
        <span className="pill" data-testid="seed">
          seed <b>{state.seed}</b>
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
        <button type="button" className="btn" onClick={restart} data-testid="restart">
          ↻ 再実行
        </button>
      </div>

      <main className="board-wrap">
        <Board state={state} />
      </main>

      {complete && result && (
        <SprintResultScreen
          result={result}
          aiEnabled={aiEnabled}
          onRestart={restart}
          onToggleAi={() => setAiEnabled(!aiEnabled)}
        />
      )}
    </div>
  );
}
