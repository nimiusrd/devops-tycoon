/**
 * スプリント画面（能動操作フェーズ / SPEC 第4.1 / 第6章）。
 *
 * 盤面（タスク粒の流れ）＋ 介入アクションバー ＋ コンボ/数字ポップ ＋ デッキ。
 * スプリント種別（通常/高負荷/ボス）に応じてバナーを変える。状態は読むだけ（第22.2）。
 */
import { getBoss } from '../data/bosses';
import { Board } from '../render/Board';
import { reviewQueueLength } from '../render/status';
import type { ActionId, InterventionOutcome } from '../sim/types';
import type { RunState } from '../sim/run/types';
import { ActionBar } from './ActionBar';
import { ComboBadge } from './ComboBadge';
import { DeckBar } from './DeckBar';
import { PointPops } from './PointPops';

export interface SprintScreenProps {
  state: RunState;
  onDispatch: (id: ActionId) => InterventionOutcome;
}

export function SprintScreen({ state, onDispatch }: SprintScreenProps) {
  const sprint = state.sprint;
  if (!sprint) return null;

  const kind = state.currentSprintKind;
  const isBoss = kind === 'boss';
  const isElite = kind === 'elite';
  const boss = getBoss(state.bossId);

  const queue = reviewQueueLength(sprint.tasks);
  const jamPct = Math.min(100, (queue / 18) * 100);
  const incidents = sprint.tasks.filter((t) => t.lane === 'rework' && t.incident).length;

  return (
    <>
      <div className="subbar">
        <span className={`pill node-tag node-${kind}`}>
          {isBoss
            ? `★ ボス: ${boss?.name ?? ''}`
            : isElite
              ? '🔥 高負荷スプリント'
              : '💻 通常スプリント'}
        </span>
        {isBoss && boss && <span className="pill boss-goal">{boss.description}</span>}
        <div className="meter-wrap">
          <span className="meter-label">渋滞メーター</span>
          <div className={`meter${queue >= 12 ? ' jam' : ''}`}>
            <i style={{ width: `${jamPct}%` }} />
          </div>
        </div>
        <div className="meter-wrap">
          <span className="meter-label">炎上タイマー</span>
          <div className={`meter fire${incidents > 0 ? ' burning' : ''}`} data-testid="fire-meter">
            <i style={{ width: `${Math.min(100, incidents * 25)}%` }} />
          </div>
          <span className="meter-count" data-testid="fire-count">
            🔥{incidents}
          </span>
        </div>
        <ComboBadge combo={sprint.metrics.combo} />
      </div>

      <main className="board-wrap">
        <PointPops deliveryScore={state.org.deliveryScore} />
        <Board tasks={sprint.tasks} />
      </main>

      <DeckBar deck={state.deck} />
      <ActionBar sprint={sprint} disabled={sprint.complete} onAction={onDispatch} />
    </>
  );
}
