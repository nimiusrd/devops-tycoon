/**
 * スプリント画面（能動操作フェーズ / SPEC 第4.1 / 第6章）。
 *
 * 盤面（タスク粒の流れ）＋ 介入アクションバー ＋ コンボ/数字ポップ ＋ 手札。
 * スプリント種別（通常/高負荷/ボス）に応じてバナーを変える。状態は読むだけ（第22.2）。
 * RI-30: assignTask/splitPr は武装→ドラッグ、カードは手札から発動。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getBoss } from '../data/bosses';
import { BOARD_VIEW } from '../render/boardScene';
import {
  ATTENTION_COOLDOWN_MS,
  ATTENTION_PAUSE_MS,
  countIgniteEvents,
  planAttentionPause,
  type AttentionPausePlan,
} from '../render/attentionPause';
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
  Task,
} from '../sim/types';
import type { GameHandle, PauseBrieflyClear } from '../game';
import type { RunState } from '../sim/run/types';
import type { InterventionTrigger } from './InterventionEffects';
import { ActionBar } from './ActionBar';
import { ComboBadge } from './ComboBadge';
import { DeckBar } from './DeckBar';
import { EventTicker } from './EventTicker';
import { PointPops } from './PointPops';
import { AspectStage } from './AspectStage';
import { SprintLayout } from './SprintLayout';
import { AttentionOverlay, SlowMotionOverlay } from './JuicyEffects';
import {
  isPlaybackPaused,
  nextPlaybackSpeed,
  type PlaybackSpeed,
  type PlayingSpeed,
} from './sprintTempo';
import { TutorialGuide } from './TutorialGuide';

/** ボススローモオーバーレイと自動進行停止の共通尺（ms）。 */
const BOSS_SLOWMO_MS = 1_200;

const IDLE_ATTENTION: AttentionPausePlan = {
  active: false,
  kind: null,
  label: '',
  title: '',
  meter: null,
};

const SPEED_OPTIONS: { speed: PlaybackSpeed; label: string; testId: string }[] = [
  { speed: 0, label: '❚❚', testId: 'speed-pause' },
  { speed: 1, label: '1x', testId: 'speed-1x' },
  { speed: 2, label: '2x', testId: 'speed-2x' },
];

export interface SprintScreenProps {
  state: RunState;
  header: ReactNode;
  onDispatch: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
  onPlayCard: (deckIndex: number) => CardPlayOutcome;
  getSprintSnapshot: () => SprintState | null;
  /** スローモ中に自動進行を止める（RI-10）。戻り値でキャンセル。 */
  pauseBriefly: (ms: number) => PauseBrieflyClear;
  /** プレイヤー向け再生速度（RI-62）。game.pause とは独立。 */
  playbackSpeed: PlaybackSpeed;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  /** 初見向け段階ガイドを表示する（RI-60）。 */
  showTutorial?: boolean;
  /** ガイド完了 / スキップ時。 */
  onTutorialDismiss?: () => void;
  /** ガイド表示中の pause 所有に使う（チャンク読込後にマウントされる）。 */
  game?: GameHandle;
}

export function SprintScreen({
  state,
  header,
  onDispatch,
  onPlayCard,
  getSprintSnapshot,
  pauseBriefly,
  playbackSpeed,
  setPlaybackSpeed,
  showTutorial = false,
  onTutorialDismiss,
  game,
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
  const attentionTimer = useRef<number | null>(null);
  const clearPauseBriefly = useRef<PauseBrieflyClear | null>(null);
  const attentionPrevTasks = useRef<readonly Task[] | null>(null);
  const attentionPrevReviewQueueMax = useRef<number | null>(null);
  const attentionPrevIgniteCount = useRef<number | null>(null);
  const attentionSprintId = useRef<string | null>(null);
  const lastAttentionAt = useRef(0);
  const lastPlayingSpeedRef = useRef<PlayingSpeed>(1);
  const [slowMoKey, setSlowMoKey] = useState(0);
  const [slowMoPlan, setSlowMoPlan] = useState({ clearedIncidentCount: 0 });
  const [attentionKey, setAttentionKey] = useState(0);
  const [attentionPlan, setAttentionPlan] = useState<AttentionPausePlan>(IDLE_ATTENTION);
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
      if (attentionTimer.current != null) window.clearTimeout(attentionTimer.current);
      clearPauseBriefly.current?.();
      clearPauseBriefly.current = null;
    },
    [],
  );

  // RI-62③: 自動進行での点火・渋滞・ボスIncident をエッジ検出して短い自動ポーズ。
  useEffect(() => {
    if (!sprint || sprint.complete) {
      attentionPrevTasks.current = null;
      attentionPrevReviewQueueMax.current = null;
      attentionPrevIgniteCount.current = null;
      attentionSprintId.current = null;
      return;
    }

    const nextTasks = sprint.tasks;
    const nextReviewQueueMax = sprint.metrics.reviewQueueMax;
    const nextIgniteEventCount = countIgniteEvents(sprint.fireEvents);
    const sprintChanged = attentionSprintId.current !== state.currentSprintId;
    if (
      sprintChanged ||
      attentionPrevTasks.current == null ||
      attentionPrevReviewQueueMax.current == null ||
      attentionPrevIgniteCount.current == null
    ) {
      attentionSprintId.current = state.currentSprintId;
      attentionPrevTasks.current = nextTasks;
      attentionPrevReviewQueueMax.current = nextReviewQueueMax;
      attentionPrevIgniteCount.current = nextIgniteEventCount;
      return;
    }

    const prevTasks = attentionPrevTasks.current;
    const prevReviewQueueMax = attentionPrevReviewQueueMax.current;
    const prevIgniteEventCount = attentionPrevIgniteCount.current;
    attentionPrevTasks.current = nextTasks;
    attentionPrevReviewQueueMax.current = nextReviewQueueMax;
    attentionPrevIgniteCount.current = nextIgniteEventCount;

    // プレイヤー Pause 中は既に止まっているので自動ポーズ不要。
    if (isPlaybackPaused(playbackSpeed)) return;

    const now = performance.now();
    if (now - lastAttentionAt.current < ATTENTION_COOLDOWN_MS) return;

    const plan = planAttentionPause({
      isBoss: state.currentSprintKind === 'boss',
      prevTasks,
      nextTasks,
      prevReviewQueueMax,
      nextReviewQueueMax,
      prevIgniteEventCount,
      nextIgniteEventCount,
    });
    if (!plan.active) return;

    lastAttentionAt.current = now;
    setAttentionPlan(plan);
    setAttentionKey((key) => key + 1);
    clearPauseBriefly.current?.();
    clearPauseBriefly.current = pauseBriefly(ATTENTION_PAUSE_MS);
    if (attentionTimer.current != null) window.clearTimeout(attentionTimer.current);
    attentionTimer.current = window.setTimeout(() => {
      setAttentionKey(0);
      setAttentionPlan(IDLE_ATTENTION);
      attentionTimer.current = null;
      clearPauseBriefly.current = null;
    }, ATTENTION_PAUSE_MS);
  }, [
    sprint,
    state.currentSprintId,
    state.currentSprintKind,
    state.sprintTick,
    playbackSpeed,
    pauseBriefly,
  ]);

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
          setAttentionKey(0);
          setAttentionPlan(IDLE_ATTENTION);
          if (attentionTimer.current != null) {
            window.clearTimeout(attentionTimer.current);
            attentionTimer.current = null;
          }
          clearPauseBriefly.current?.();
          clearPauseBriefly.current = pauseBriefly(BOSS_SLOWMO_MS);
          if (slowMoTimer.current != null) window.clearTimeout(slowMoTimer.current);
          slowMoTimer.current = window.setTimeout(() => {
            setSlowMoKey(0);
            slowMoTimer.current = null;
            clearPauseBriefly.current = null;
          }, BOSS_SLOWMO_MS);
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
    [
      onDispatch,
      getSprintSnapshot,
      pauseBriefly,
      setArmedId,
      sprint,
      state.currentSprintKind,
      state.sprintTick,
    ],
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

  useEffect(() => {
    if (!isPlaybackPaused(playbackSpeed)) lastPlayingSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  const handleSelectPlaybackSpeed = useCallback(
    (clicked: PlaybackSpeed) => {
      const next = nextPlaybackSpeed(playbackSpeed, clicked, lastPlayingSpeedRef.current);
      if (!isPlaybackPaused(next)) lastPlayingSpeedRef.current = next;
      setPlaybackSpeed(next);
    },
    [playbackSpeed, setPlaybackSpeed],
  );

  const handlePlayCard = useCallback(
    (deckIndex: number): CardPlayOutcome => {
      if (isPlaybackPaused(playbackSpeed)) return { ok: false, reason: 'paused' };
      return onPlayCard(deckIndex);
    },
    [onPlayCard, playbackSpeed],
  );

  if (!sprint) return null;

  const kind = state.currentSprintKind;
  const isBoss = kind === 'boss';
  const isElite = kind === 'elite';
  const boss = getBoss(state.bossId);
  const paused = isPlaybackPaused(playbackSpeed);

  const queue = reviewQueueLength(sprint.tasks);
  const jamPct = Math.min(100, (queue / 18) * 100);
  const burning = sprint.tasks.filter((t) => t.lane === 'rework' && t.incident);
  const incidents = burning.length;
  const urgentTicks =
    incidents > 0 ? Math.min(...burning.map((t) => t.burnTicksLeft ?? BURN_TICKS)) : 0;
  const burnPct = incidents > 0 ? Math.max(0, (urgentTicks / BURN_TICKS) * 100) : 0;

  return (
    <SprintLayout
      header={header}
      status={
        <div className="subbar" data-testid="sprint-subbar">
          <span className={`pill node-tag node-${kind}`}>
            {isBoss
              ? `★ ボス: ${boss?.name ?? ''}`
              : isElite
                ? '🔥 高負荷スプリント'
                : '💻 通常スプリント'}
          </span>
          {isBoss && boss && <span className="pill boss-goal">{boss.description}</span>}
          <div
            className="speed-controls"
            role="group"
            aria-label="再生速度"
            data-testid="speed-controls"
            data-paused={paused ? 'true' : 'false'}
          >
            {SPEED_OPTIONS.map(({ speed, label, testId }) => (
              <button
                key={speed}
                type="button"
                className={`speed-btn${playbackSpeed === speed ? ' active' : ''}`}
                aria-pressed={playbackSpeed === speed}
                aria-label={
                  speed === 0 ? (isPlaybackPaused(playbackSpeed) ? '再開' : '一時停止') : undefined
                }
                data-testid={testId}
                disabled={sprint.complete}
                onClick={() => handleSelectPlaybackSpeed(speed)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={`meter-wrap${attentionKey > 0 && attentionPlan.meter === 'jam' ? ' attention' : ''}`}
            data-testid="jam-meter"
          >
            <span className="meter-label">渋滞メーター</span>
            <div className={`meter${queue >= 12 ? ' jam' : ''}`}>
              <i style={{ width: `${jamPct}%` }} />
            </div>
          </div>
          <div
            className={`meter-wrap${attentionKey > 0 && attentionPlan.meter === 'fire' ? ' attention' : ''}`}
          >
            <span className="meter-label">炎上タイマー</span>
            <div
              className={`meter fire${incidents > 0 ? ' burning' : ''}`}
              data-testid="fire-meter"
            >
              <i style={{ width: `${burnPct}%` }} />
            </div>
            <span className="meter-count" data-testid="fire-count">
              🔥{incidents}
            </span>
          </div>
          <ComboBadge
            combo={sprint.metrics.combo}
            stabilized={state.sprintTick < sprint.modifiers.stabilityUntilTick}
          />
        </div>
      }
      stage={
        <main className="board-wrap">
          <AspectStage
            ratio={BOARD_VIEW.w / BOARD_VIEW.h}
            className="board-stage"
            data-testid="board-stage"
          >
            <PointPops deliveryScore={state.org.deliveryScore} teamId={state.activeTeamId} />
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
            {attentionKey > 0 && attentionPlan.active && (
              <AttentionOverlay label={attentionPlan.label} title={attentionPlan.title} />
            )}
            <EventTicker events={sprint.events} />
          </AspectStage>
        </main>
      }
      deck={
        <DeckBar
          deck={state.deck}
          hand={sprint.cardPiles.hand}
          focus={sprint.focus}
          playable={!sprint.complete}
          paused={paused}
          onPlay={handlePlayCard}
        />
      }
      controls={
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
      }
      overlays={
        showTutorial && onTutorialDismiss && game ? (
          <TutorialGuide game={game} onDismiss={onTutorialDismiss} />
        ) : null
      }
    />
  );
}
