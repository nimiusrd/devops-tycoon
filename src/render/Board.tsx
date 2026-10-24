/**
 * 盤面レンダラ（SPEC 第4.1 / 第18章 準拠）。
 *
 * 「状態を読んで描くだけ」の一方向に徹する（第22.2）。`boardScene` が組み立てた
 * シーン計画を読み、俯瞰オフィス（アイソメ）として描く: 部屋（背景）＋工程ごとの
 * ステーション（机＋キャラ＋ラベル＋吹き出し）＋タスク粒の山＋工程間フロー。
 * 座標は設計空間（1404×573）の % で重ね、WebGL盤面にHTMLの操作・要約を重ねる。
 * RI-30: 武装中はタスク粒のドラッグで介入ターゲットを指定できる。
 */
import { lazyWebgl } from '../ui/lazyWebgl';
import type { BoardPixiLayerProps } from '../ui/BoardPixiLayer';
import { loadWebglModule } from './loadWebglModule';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  ActionTarget,
  Lane,
  SprintMetrics,
  SprintModifiers,
  SprintState,
  Task,
} from '../sim/types';
import { deriveActiveBoardAuras } from './interventionEffects';
import {
  clientToBoardPoint,
  hitTestDropLane,
  planBoardDrag,
  type BoardClientRect,
  type DraggableActionId,
} from './boardDragPlan';
import {
  clientPointHitsDraggableBoardDot,
  hitTestClientBoardDot,
  registerBoardDragHitTest,
  registerPixiBoardDragHitTest,
} from './boardDragHit';
import type { InterventionTrigger } from './interventionEffects';
import { OfficeRoom } from '../ui/OfficeRoom';
import { usePixiRenderer } from '../ui/usePixiRenderer';
import { useBoardEffects } from '../ui/useBoardEffects';
import { deriveMemberMoodOverrides } from './memberMood';
import { BOARD_VIEW, planBoardScene, type BoardStationPlan, type BoardDotPlan } from './boardScene';
import type { RosterState } from '../sim/member/types';
import { TASK_COLORS } from './taskView';
import { VISUAL_TOKENS } from './visualTokens';
import { pct } from '../ui/pct';
import { describeTaskTarget } from './actionTargetPickerView';

/** Pixi 盤面レイヤは動的 import（RI-12）。usePixi 時のみチャンクを取得する。 */
const BoardPixiLayer = lazyWebgl<BoardPixiLayerProps>(() =>
  loadWebglModule('board').then((m) => ({ default: m.BoardPixiLayer })),
);

const VIEW_W = BOARD_VIEW.w;
const VIEW_H = BOARD_VIEW.h;

interface BoardPointerPosition {
  clientX: number;
  clientY: number;
  rect: BoardClientRect;
  blocked: boolean;
  action: DraggableActionId;
}

interface BoardGesture {
  pointerId: number;
  taskId: number;
  action: DraggableActionId;
  announce: boolean;
}

function blocksBoardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('.st-label, .board-flow-summary, .bubble, .board-legend, .pile-overflow') !==
      null
  );
}

function Station({
  s,
  dropTarget,
  hover,
}: {
  s: BoardStationPlan;
  dropTarget?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={`station station-${s.lane}${dropTarget ? ' drop-target' : ''}${hover ? ' drop-hover' : ''}`}
      data-testid={`lane-${s.lane}`}
      data-mood={s.mood}
      data-drop-target={dropTarget ? 'true' : undefined}
      style={{
        left: pct(s.x, VIEW_W),
        top: pct(s.y, VIEW_H),
        aspectRatio: `${VISUAL_TOKENS.dimensions.sprint.actor.dom.w} / ${VISUAL_TOKENS.dimensions.sprint.actor.dom.h}`,
      }}
    ></div>
  );
}

/**
 * 工程名と件数を盤面上部へ集約する。人物・粒の上へ個別ラベルを重ねず、
 * 「どこに何件あるか」を視線移動の少ない一列で読めるようにする。
 */
function BoardFlowSummary({
  stations,
  actionInspection,
}: {
  stations: readonly BoardStationPlan[];
  actionInspection?: { label: string; targetLanes: readonly Lane[] };
}) {
  return (
    <section
      className="board-flow-summary"
      data-testid="board-flow-summary"
      aria-label="開発フローの工程別件数"
    >
      <span className="board-flow-heading">
        {actionInspection ? `${actionInspection.label}の作用先` : '開発フロー'}
      </span>
      <ol className="board-flow-list">
        {stations.map((station) => {
          const needsAttention = station.hot || station.mood === 'panic';
          const actionTarget = actionInspection?.targetLanes.includes(station.lane) ?? false;
          return (
            <li
              key={station.lane}
              className={needsAttention ? 'needs-attention' : undefined}
              data-lane={station.lane}
              data-action-target={actionTarget ? 'true' : undefined}
            >
              <span className="board-flow-icon" aria-hidden="true">
                {station.icon}
              </span>
              <span className="board-flow-name">{station.label}</span>
              <strong data-testid={`count-${station.lane}`}>{station.count}</strong>
              {needsAttention && <span className="board-flow-alert">要対応</span>}
              {actionTarget && <span className="board-flow-target">作用先</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Bubble({ s }: { s: BoardStationPlan }) {
  // 好調・完了の肯定的な演出は人物の表情へ任せ、判断が必要な状態だけ言語化する。
  if (!s.bubble || s.mood === 'happy' || s.mood === 'cheer') return null;
  const tone = s.mood === 'panic' || s.mood === 'sad' ? 'hot' : '';
  return (
    <div
      className={`bubble ${tone}`}
      data-testid={`board-bubble-${s.lane}`}
      data-lane={s.lane}
      style={{ left: pct(s.bubbleX, VIEW_W), top: pct(s.bubbleY, VIEW_H) }}
    >
      {s.bubble}
    </div>
  );
}

export interface BoardProps {
  tasks: Task[];
  /** 指定時は盤面内に延焼・鎮火演出を重ねる（RI-06）。 */
  metrics?: SprintMetrics;
  /** Review スループット（延焼先判定用）。metrics 指定時は必須。 */
  reviewAccumulator?: number;
  /** 時限モディファイア（盤面オーラ / RI-50）。 */
  modifiers?: SprintModifiers;
  /** 進行中スプリント tick（modifiers 表示用）。 */
  sprintTick?: number;
  /** 介入成功トリガ（盤面リアクション / RI-50）。 */
  interventionTrigger?: InterventionTrigger | null;
  /** firefight 演出と FireEffects 鎮火の二重再生を避ける task ID。 */
  suppressExtinguishTaskIds?: ReadonlySet<number>;
  /** 育成メンバーの状態をキャラ表情へ反映する（RI-08）。 */
  roster?: RosterState | null;
  /** 武装中のドラッグ介入（RI-30）。フル SprintState があると候補判定が正確。 */
  sprint?: SprintState | null;
  armedAction?: DraggableActionId | null;
  /** タスク差配の担当指定（省略時は defaultAssignee）。 */
  assignAssignee?: 'ai' | 'senior';
  onDragComplete?: (target: ActionTarget) => void;
  /** true なら壁時計アニメを止める（進化オーバーレイ中 / #386）。 */
  animationsPaused?: boolean;
  /** 情報確認中の介入と作用先。HTML工程要約だけを強調し、発動や盤面操作は変えない。 */
  actionInspection?: { label: string; targetLanes: readonly Lane[] };
}

/** 凡例（dot 凡例）。 */
const LEGEND: { variant: BoardDotPlan['variant']; label: string }[] = [
  { variant: 'ai', label: 'AI利用' },
  { variant: 'rework', label: '手戻り' },
  { variant: 'gold', label: '高価値' },
  { variant: 'debt', label: '技術的負債' },
  { variant: 'incident', label: '炎上' },
];

export function Board({
  tasks,
  metrics,
  reviewAccumulator = 0,
  modifiers,
  sprintTick = 0,
  interventionTrigger = null,
  suppressExtinguishTaskIds,
  roster = null,
  sprint = null,
  armedAction = null,
  assignAssignee,
  onDragComplete,
  animationsPaused = false,
  actionInspection,
}: BoardProps) {
  // 育成メンバーの疲弊/好調を表情上書きへ（RI-08。roster 無しは従来どおり）。
  const moodOverrides = useMemo(
    () => (roster ? deriveMemberMoodOverrides(roster) : undefined),
    [roster],
  );
  const scene = planBoardScene(tasks, moodOverrides);
  // 盤面の常駐物と連続演出を WebGL で描くか（RI-11 / RI-142。ラベルは DOM 共通）。
  const { usePixi, onWebglError } = usePixiRenderer();
  const [pixiReady, setPixiReady] = useState(false);
  // 初回描画の完了を診断・操作E2Eに公開する。
  const gpuEffectsActive = usePixi && pixiReady;
  // hot なら Review Hell トーン（強）。heat は hot 手前から徐々に盤面を赤くする
  // 早期警告で、--review-heat（0..1）で赤みオーバーレイの濃さをスケールする（第18.2/18.3）。
  const hot = scene.reviewEffects.heatField?.hell ?? false;
  const heat = scene.reviewEffects.heatField?.intensity ?? 0;

  const boardRef = useRef<HTMLDivElement>(null);
  const activeAuras = modifiers != null ? deriveActiveBoardAuras(modifiers, sprintTick) : [];
  const boardEffects = useBoardEffects({
    tasks,
    metrics,
    reviewAccumulator,
    interventionTrigger,
    suppressExtinguishTaskIds,
  });

  const dragPlan =
    armedAction && sprint ? planBoardDrag(sprint, armedAction, assignAssignee) : null;
  const dragIds = useMemo(() => new Set(dragPlan?.draggableTaskIds ?? []), [dragPlan]);
  const dropLanes = new Set(dragPlan?.dropLanes ?? []);

  useEffect(() => {
    registerPixiBoardDragHitTest(usePixi, (clientX, clientY) =>
      clientPointHitsDraggableBoardDot(
        clientX,
        clientY,
        boardRef.current?.getBoundingClientRect() ?? null,
        scene.dots,
        dragIds,
      ),
    );
    return () => registerBoardDragHitTest(null);
  }, [dragIds, scene.dots, usePixi]);

  const [pointer, setPointer] = useState<BoardPointerPosition | null>(null);
  const [gesture, setGesture] = useState<BoardGesture | null>(null);
  const [confirmedTarget, setConfirmedTarget] = useState('');
  const interactive = usePixi && armedAction !== null && onDragComplete != null && dragPlan != null;
  // 元のsceneで逆引きし、強調による前面化が次のヒット順を変えないようにする。
  const previewTaskId =
    !interactive || !pointer || pointer.action !== armedAction || pointer.blocked
      ? null
      : gesture?.action === 'assignTask'
        ? dragIds.has(gesture.taskId)
          ? gesture.taskId
          : null
        : hitTestClientBoardDot(
            pointer.clientX,
            pointer.clientY,
            pointer.rect,
            scene.dots,
            dragIds,
          );
  const dragTaskId =
    interactive &&
    gesture?.action === 'assignTask' &&
    gesture.action === armedAction &&
    dragIds.has(gesture.taskId)
      ? gesture.taskId
      : null;
  const selectedTask = gesture?.announce ? tasks.find((task) => task.id === previewTaskId) : null;
  const targetAnnouncement = selectedTask
    ? `対象: ${describeTaskTarget(selectedTask)}（#${selectedTask.id}）`
    : confirmedTarget;
  const dropPoint = pointer && clientToBoardPoint(pointer.clientX, pointer.clientY, pointer.rect);
  const hoverLane =
    gesture?.action === 'assignTask' && dragTaskId !== null && dropPoint && dragPlan
      ? hitTestDropLane(dropPoint.x, dropPoint.y, dragPlan.dropLanes)
      : null;
  const currentInput = useRef({
    interactive,
    armedAction,
    dragPlan,
    dragIds,
    dots: scene.dots,
    tasks,
    previewTaskId,
    onDragComplete,
  });
  useEffect(() => {
    currentInput.current = {
      interactive,
      armedAction,
      dragPlan,
      dragIds,
      dots: scene.dots,
      tasks,
      previewTaskId,
      onDragComplete,
    };
  }, [
    interactive,
    armedAction,
    dragPlan,
    dragIds,
    scene.dots,
    tasks,
    previewTaskId,
    onDragComplete,
  ]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !usePixi) return;
    // Reactのtouchstartはpassive。粒をつかむときだけnative scrollを止め、空白は縦に送れる。
    const onTouchStart = (event: TouchEvent) => {
      const input = currentInput.current;
      if (!input.interactive || event.touches.length !== 1 || blocksBoardTarget(event.target))
        return;
      const touch = event.touches[0];
      if (
        hitTestClientBoardDot(
          touch.clientX,
          touch.clientY,
          board.getBoundingClientRect(),
          input.dots,
          input.dragIds,
        ) !== null
      )
        event.preventDefault();
    };
    board.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => board.removeEventListener('touchstart', onTouchStart);
  }, [usePixi]);

  const readPointer = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null): BoardPointerPosition | null => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || !armedAction) return null;
      return {
        clientX,
        clientY,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        blocked: blocksBoardTarget(target),
        action: armedAction,
      };
    },
    [armedAction],
  );

  useEffect(() => {
    if (!gesture) return;
    let finished = false;
    const matchingPointer = (event: PointerEvent) => (event.pointerId ?? 1) === gesture.pointerId;
    const position = (event: PointerEvent) =>
      readPointer(
        event.clientX,
        event.clientY,
        // Touchの暗黙captureでも、指の下にあるHTMLを操作対象から除く。
        typeof document === 'undefined'
          ? event.target
          : document.elementFromPoint(event.clientX, event.clientY),
      );
    const cancel = () => {
      finished = true;
      setGesture(null);
      setPointer(null);
    };
    const onMove = (event: PointerEvent) => {
      if (finished || !matchingPointer(event)) return;
      setPointer(position(event));
    };
    const onUp = (event: PointerEvent) => {
      if (finished || !matchingPointer(event)) return;
      const input = currentInput.current;
      const released = position(event);
      cancel();
      if (
        !released ||
        released.blocked ||
        !input.interactive ||
        input.armedAction !== gesture.action ||
        !input.dragPlan
      )
        return;
      const confirm = (target: ActionTarget) => {
        const task = input.tasks.find((task) => task.id === target.taskId);
        if (task) setConfirmedTarget(`対象を確定: ${describeTaskTarget(task)}（#${task.id}）`);
        input.onDragComplete?.(target);
      };
      if (gesture.action === 'splitPr') {
        const taskId = hitTestClientBoardDot(
          event.clientX,
          event.clientY,
          released.rect,
          input.dots,
          input.dragIds,
        );
        // 表示していた対象だけを確定する。消滅やupだけの座標変化は誤発動させない。
        if (taskId !== null && taskId === input.previewTaskId) confirm({ taskId });
        return;
      }
      const { rect } = released;
      if (
        !input.dragIds.has(gesture.taskId) ||
        event.clientX < rect.left ||
        event.clientX > rect.left + rect.width ||
        event.clientY < rect.top ||
        event.clientY > rect.top + rect.height
      )
        return;
      const point = clientToBoardPoint(event.clientX, event.clientY, rect);
      const lane = hitTestDropLane(point.x, point.y, input.dragPlan.dropLanes);
      if (lane)
        confirm({
          taskId: gesture.taskId,
          lane,
          ...(input.dragPlan.assignee ? { assignee: input.dragPlan.assignee } : {}),
        });
    };
    const onCancel = (event: PointerEvent) => {
      if (matchingPointer(event)) cancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', cancel);
    return () => {
      // up/cancel後は既に解除済み。後始末で再度state更新して描画を増やさない。
      if (!finished) cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', cancel);
    };
  }, [gesture, readPointer]);

  // スクロール/リサイズ後の古い矩形から対象を表示・確定しない。
  useEffect(() => {
    const clear = () => {
      setPointer(null);
      setGesture(null);
    };
    window.addEventListener('resize', clear);
    window.addEventListener('scroll', clear, true);
    return () => {
      window.removeEventListener('resize', clear);
      window.removeEventListener('scroll', clear, true);
    };
  }, []);

  const handleBoardPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (
        !interactive ||
        gesture ||
        event.isPrimary === false ||
        (event.button != null && event.button !== 0)
      )
        return;
      const next = readPointer(event.clientX, event.clientY, event.target);
      if (!next || next.blocked) return;
      const taskId = hitTestClientBoardDot(
        event.clientX,
        event.clientY,
        next.rect,
        scene.dots,
        dragIds,
      );
      if (taskId === null || !armedAction) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmedTarget('');
      setPointer(next);
      setGesture({
        pointerId: event.pointerId ?? 1,
        taskId,
        action: armedAction,
        announce: event.pointerType === 'touch' || event.pointerType === 'pen',
      });
    },
    [interactive, gesture, readPointer, scene.dots, dragIds, armedAction],
  );

  const handleBoardPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (gesture || event.pointerType === 'touch') return;
      setPointer(interactive ? readPointer(event.clientX, event.clientY, event.target) : null);
    },
    [gesture, interactive, readPointer],
  );

  return (
    <div
      ref={boardRef}
      className={`board iso-office${hot ? ' review-hell' : ''}${armedAction ? ' board-armed' : ''}`}
      data-testid="board"
      data-armed={armedAction ?? undefined}
      data-preview-task-id={previewTaskId ?? undefined}
      data-review-heat={heat}
      data-review-hell={hot ? 'true' : 'false'}
      data-effect-renderer={gpuEffectsActive ? 'pixi' : 'loading'}
      data-effect-count={boardEffects.effects.length}
      data-effect-kinds={boardEffects.effects
        .map((effect) => `${effect.source}:${effect.effect.kind}`)
        .join(',')}
      data-effect-sequence={boardEffects.lastSequence}
      data-effect-sfx-count={boardEffects.audio.count}
      data-effect-last-sfx={boardEffects.audio.last ?? undefined}
      data-animations-paused={animationsPaused ? 'true' : undefined}
      onPointerDown={usePixi ? handleBoardPointerDown : undefined}
      onPointerMove={usePixi ? handleBoardPointerMove : undefined}
      onPointerLeave={() => {
        if (!gesture) setPointer(null);
      }}
      style={{ '--review-heat': heat } as CSSProperties}
    >
      <OfficeRoom />
      {usePixi && (
        <BoardPixiLayer
          scene={scene}
          draggableTaskIds={dragIds}
          dragTaskId={dragTaskId}
          previewTaskId={previewTaskId}
          effects={boardEffects.effects}
          auras={activeAuras}
          onWebglError={onWebglError}
          onReady={() => setPixiReady(true)}
          animationsPaused={animationsPaused}
        />
      )}

      <span
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="board-target-preview"
      >
        {targetAnnouncement}
      </span>

      {scene.stations.map((s) => (
        <Station
          key={s.lane}
          s={s}
          dropTarget={dropLanes.has(s.lane as 'backlog' | 'coding' | 'review')}
          hover={hoverLane === s.lane}
        />
      ))}
      <BoardFlowSummary stations={scene.stations} actionInspection={actionInspection} />
      {scene.stations.map((s) => (
        <Bubble key={`b-${s.lane}`} s={s} />
      ))}

      {scene.stations
        .filter((s) => s.overflow > 0)
        .map((s) => (
          <div
            key={`of-${s.lane}`}
            className="pile-overflow"
            data-testid={`overflow-${s.lane}`}
            style={{ left: pct(s.overflowX, VIEW_W), top: pct(s.overflowY, VIEW_H) }}
          >
            +{s.overflow}
          </div>
        ))}

      <details className="board-legend">
        <summary>粒の見方</summary>
        <div className="board-legend-items">
          {LEGEND.map((l) => (
            <span key={l.variant} className="li">
              <span
                className={`legend-dot variant-${l.variant}`}
                style={{ background: TASK_COLORS[l.variant] }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}
