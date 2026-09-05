/**
 * 盤面レンダラ（SPEC 第4.1 / 第18章 準拠）。
 *
 * 「状態を読んで描くだけ」の一方向に徹する（第22.2）。`boardScene` が組み立てた
 * シーン計画を読み、俯瞰オフィス（アイソメ）として描く: 部屋（背景）＋工程ごとの
 * ステーション（机＋キャラ＋ラベル＋吹き出し）＋タスク粒の山＋工程間フロー。
 * 座標は設計空間（1404×573）の % で重ね、WebGL盤面にHTMLの操作・要約を重ねる。
 * RI-30: 武装中はタスク粒のドラッグで介入ターゲットを指定できる。
 */
import { WebglLoading } from '../ui/WebglLoading';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
  type DraggableActionId,
} from './boardDragPlan';
import {
  clientPointHitsDraggableBoardDot,
  registerBoardDragHitTest,
  registerPixiBoardDragHitTest,
} from './boardDragHit';
import { hitTestBoardDot } from './boardPixiView';
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

/** Pixi 盤面レイヤは動的 import（RI-12）。usePixi 時のみチャンクを取得する。 */
const BoardPixiLayer = lazy(() =>
  import('../ui/BoardPixiLayer').then((m) => ({ default: m.BoardPixiLayer })),
);

const VIEW_W = BOARD_VIEW.w;
const VIEW_H = BOARD_VIEW.h;

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
function BoardFlowSummary({ stations }: { stations: readonly BoardStationPlan[] }) {
  return (
    <section
      className="board-flow-summary"
      data-testid="board-flow-summary"
      aria-label="開発フローの工程別件数"
    >
      <span className="board-flow-heading">開発フロー</span>
      <ol className="board-flow-list">
        {stations.map((station) => {
          const needsAttention = station.hot || station.mood === 'panic';
          return (
            <li
              key={station.lane}
              className={needsAttention ? 'needs-attention' : undefined}
              data-lane={station.lane}
            >
              <span className="board-flow-icon" aria-hidden="true">
                {station.icon}
              </span>
              <span className="board-flow-name">{station.label}</span>
              <strong data-testid={`count-${station.lane}`}>{station.count}</strong>
              {needsAttention && <span className="board-flow-alert">要対応</span>}
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

  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [hoverLane, setHoverLane] = useState<Lane | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, taskId: number) => {
      if (!armedAction || !onDragComplete || !dragPlan) return;
      e.preventDefault();
      // 同じpointerイベントから二重にドラッグを開始しない。
      e.stopPropagation();
      setDragTaskId(taskId);

      const onMove = (ev: PointerEvent) => {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        const pt = clientToBoardPoint(ev.clientX, ev.clientY, rect);
        setHoverLane(hitTestDropLane(pt.x, pt.y, dragPlan.dropLanes));
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const rect = boardRef.current?.getBoundingClientRect();
        setDragTaskId(null);
        setHoverLane(null);
        if (!rect) return;
        if (armedAction === 'splitPr') {
          onDragComplete({ taskId });
          return;
        }
        const pt = clientToBoardPoint(ev.clientX, ev.clientY, rect);
        const lane = hitTestDropLane(pt.x, pt.y, dragPlan.dropLanes);
        if (!lane) return;
        onDragComplete({
          taskId,
          lane,
          ...(dragPlan.assignee ? { assignee: dragPlan.assignee } : {}),
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [armedAction, dragPlan, onDragComplete],
  );

  // Pixi 時は粒が canvas 内にあり DOM の pointerdown ターゲットが無いため、
  // 盤面 div で受けて設計座標から掴む粒を逆引きする（RI-30 の Pixi 対応）。
  const handleBoardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // ラベル・吹き出し等のHTML UIの上では粒を掴まない。splitPr は down+up だけで
      // 確定するため、粒と重なるラベルクリックの誤発動を防ぐ）。全面を覆う装飾
      // レイヤ（オーラ・演出）は素通しにする（弾くとドラッグ全体が効かなくなる）。
      if (
        e.target instanceof Element &&
        e.target.closest('.st-label, .bubble, .board-legend, .pile-overflow')
      ) {
        return;
      }
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || dragIds.size === 0) return;
      const pt = clientToBoardPoint(e.clientX, e.clientY, rect);
      const taskId = hitTestBoardDot(pt, scene.dots, dragIds);
      if (taskId !== null) handlePointerDown(e, taskId);
    },
    [dragIds, scene.dots, handlePointerDown],
  );

  return (
    <div
      ref={boardRef}
      className={`board iso-office${hot ? ' review-hell' : ''}${armedAction ? ' board-armed' : ''}`}
      data-testid="board"
      data-armed={armedAction ?? undefined}
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
      style={{ '--review-heat': heat } as CSSProperties}
    >
      <OfficeRoom />
      {usePixi && (
        <Suspense fallback={<WebglLoading />}>
          <BoardPixiLayer
            scene={scene}
            draggableTaskIds={dragIds}
            dragTaskId={dragTaskId}
            effects={boardEffects.effects}
            auras={activeAuras}
            onWebglError={onWebglError}
            onReady={() => setPixiReady(true)}
            animationsPaused={animationsPaused}
          />
        </Suspense>
      )}

      {scene.stations.map((s) => (
        <Station
          key={s.lane}
          s={s}
          dropTarget={dropLanes.has(s.lane as 'backlog' | 'coding' | 'review')}
          hover={hoverLane === s.lane}
        />
      ))}
      <BoardFlowSummary stations={scene.stations} />
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
