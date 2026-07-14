/**
 * スプリント画面（能動操作フェーズ / SPEC 第4.1 / 第6章）。
 *
 * 盤面（タスク粒の流れ）＋ 介入アクションバー ＋ コンボ/数字ポップ ＋ 手札。
 * スプリント種別（通常/高負荷/ボス）に応じてバナーを変える。状態は読むだけ（第22.2）。
 * RI-30: assignTask/splitPr は武装→ドラッグ、カードは手札から発動。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBoss } from '../data/bosses';
import { Board } from '../render/Board';
import type { DraggableActionId } from '../render/boardDragPlan';
import { planBossSlowMotion } from '../render/juicyEffects';
import { reviewQueueLength } from '../render/status';
import { BURN_TICKS } from '../sim/model';
import type {
  ActionId,
  ActionTarget,
  CardPlayOutcome,
  InterventionOutcome,
  SprintState,
} from '../sim/types';
import type { RunState } from '../sim/run/types';
import type { InterventionTrigger } from './InterventionEffects';
import { ActionBar } from './ActionBar';
import { ComboBadge } from './ComboBadge';
import { DeckBar } from './DeckBar';
import { EventTicker } from './EventTicker';
import { PointPops } from './PointPops';
import { SlowMotionOverlay } from './JuicyEffects';

export interface SprintScreenProps {
  state: RunState;
  onDispatch: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
  onPlayCard: (deckIndex: number) => CardPlayOutcome;
  getSprintSnapshot: () => SprintState | null;
}

export function SprintScreen({
  state,
  onDispatch,
  onPlayCard,
  getSprintSnapshot,
}: SprintScreenProps) {
  const sprint = state.sprint;
  const [interventionTrigger, setInterventionTrigger] = useState<InterventionTrigger | null>(null);
  const [suppressExtinguishTaskIds, setSuppressExtinguishTaskIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [armed, setArmed] = useState<{
    sprintId: string | null;
    id: DraggableActionId | null;
  }>({ sprintId: null, id: null });
  const [assignAssignee, setAssignAssignee] = useState<'ai' | 'senior' | undefined>(undefined);
  const [outcomeFeedback, setOutcomeFeedback] = useState<{
    id: ActionId;
    outcome: InterventionOutcome;
    nonce: number;
  } | null>(null);
  const feedbackNonce = useRef(0);
  const triggerKey = useRef(0);
  const slowMoTimer = useRef<number | null>(null);
  const [slowMoKey, setSlowMoKey] = useState(0);
  const [slowMoPlan, setSlowMoPlan] = useState({ clearedIncidentCount: 0 });
  // 完了中・別スプリントの武装は無効（effect で setState しない）。
  const armedId =
    sprint && !sprint.complete && armed.sprintId === state.currentSprintId ? armed.id : null;
  const setArmedId = useCallback(
    (id: DraggableActionId | null) => {
      setArmed({ sprintId: state.currentSprintId, id });
      if (id !== 'assignTask') setAssignAssignee(undefined);
    },
    [state.currentSprintId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setArmedId]);

  useEffect(
    () => () => {
      if (slowMoTimer.current != null) window.clearTimeout(slowMoTimer.current);
    },
    [],
  );

  const handleDispatch = useCallback(
    (id: ActionId, target?: ActionTarget): InterventionOutcome => {
      if (!sprint) return { ok: false, reason: 'complete' };
      const prevTasks = sprint.tasks;
      const outcome = onDispatch(id, target);
      if (outcome.ok && outcome.effect) {
        const nextSprint = getSprintSnapshot();
        const nextTasks = nextSprint ? [...nextSprint.tasks] : [...prevTasks];
        const slowMotion = planBossSlowMotion(
          state.currentSprintKind === 'boss',
          prevTasks,
          nextTasks,
        );
        if (slowMotion.active) {
          setSlowMoPlan({ clearedIncidentCount: slowMotion.clearedIncidentCount });
          setSlowMoKey((key) => key + 1);
          if (slowMoTimer.current != null) window.clearTimeout(slowMoTimer.current);
          slowMoTimer.current = window.setTimeout(() => {
            setSlowMoKey(0);
            slowMoTimer.current = null;
          }, 1_200);
        }
        triggerKey.current += 1;
        setInterventionTrigger({
          effect: outcome.effect,
          prevTasks: [...prevTasks],
          nextTasks,
          currentTick: state.sprintTick,
          key: triggerKey.current,
        });
        if (outcome.effect.containedTaskId != null) {
          setSuppressExtinguishTaskIds(new Set([outcome.effect.containedTaskId]));
          window.setTimeout(() => setSuppressExtinguishTaskIds(new Set()), 700);
        }
        setArmedId(null);
      }
      return outcome;
    },
    [onDispatch, getSprintSnapshot, setArmedId, sprint, state.currentSprintKind, state.sprintTick],
  );

  const handleDragComplete = useCallback(
    (target: ActionTarget) => {
      if (!armedId) return;
      const outcome = handleDispatch(armedId, target);
      feedbackNonce.current += 1;
      setOutcomeFeedback({ id: armedId, outcome, nonce: feedbackNonce.current });
    },
    [armedId, handleDispatch],
  );

  if (!sprint) return null;

  const kind = state.currentSprintKind;
  const isBoss = kind === 'boss';
  const isElite = kind === 'elite';
  const boss = getBoss(state.bossId);

  const queue = reviewQueueLength(sprint.tasks);
  const jamPct = Math.min(100, (queue / 18) * 100);
  const burning = sprint.tasks.filter((t) => t.lane === 'rework' && t.incident);
  const incidents = burning.length;
  const urgentTicks =
    incidents > 0 ? Math.min(...burning.map((t) => t.burnTicksLeft ?? BURN_TICKS)) : 0;
  const burnPct = incidents > 0 ? Math.max(0, (urgentTicks / BURN_TICKS) * 100) : 0;

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
            <i style={{ width: `${burnPct}%` }} />
          </div>
          <span className="meter-count" data-testid="fire-count">
            🔥{incidents}
          </span>
        </div>
        <ComboBadge combo={sprint.metrics.combo} />
      </div>

      <main className="board-wrap">
        <div className="board-stage">
          <PointPops deliveryScore={state.org.deliveryScore} />
          <Board
            tasks={sprint.tasks}
            metrics={sprint.metrics}
            reviewAccumulator={sprint.reviewAccumulator}
            modifiers={sprint.complete ? undefined : sprint.modifiers}
            sprintTick={state.sprintTick}
            interventionTrigger={interventionTrigger}
            suppressExtinguishTaskIds={suppressExtinguishTaskIds}
            roster={state.roster}
            sprint={sprint}
            armedAction={armedId}
            assignAssignee={armedId === 'assignTask' ? assignAssignee : undefined}
            onDragComplete={handleDragComplete}
          />
          {slowMoKey > 0 && (
            <SlowMotionOverlay clearedIncidentCount={slowMoPlan.clearedIncidentCount} />
          )}
          <EventTicker events={sprint.events} />
        </div>
      </main>

      <DeckBar
        deck={state.deck}
        hand={sprint.cardPiles.hand}
        focus={sprint.focus}
        playable={!sprint.complete}
        onPlay={onPlayCard}
      />
      <ActionBar
        sprint={sprint}
        sprintTick={state.sprintTick}
        disabled={sprint.complete}
        armedId={armedId}
        onArm={setArmedId}
        onAction={handleDispatch}
        assignAssignee={assignAssignee}
        onAssignAssigneeChange={setAssignAssignee}
        outcomeFeedback={outcomeFeedback}
      />
    </>
  );
}
