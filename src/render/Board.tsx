/**
 * 盤面レンダラ（SPEC 第4.1 / 第18章 / mockups/main-screen 準拠）。
 *
 * 「状態を読んで描くだけ」の一方向に徹する（第22.2）。`boardScene` が組み立てた
 * シーン計画を読み、俯瞰オフィス（アイソメ）として描く: 部屋（背景）＋工程ごとの
 * ステーション（机＋キャラ＋ラベル＋吹き出し）＋タスク粒の山＋工程間フロー。
 * 座標は設計空間（1404×573）の % で重ねる。将来 PixiJS へ移植する（第22.4）。
 * RI-30: 武装中はタスク粒のドラッグで介入ターゲットを指定できる。
 */
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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
import { FireEffects } from '../ui/FireEffects';
import { InterventionEffects, type InterventionTrigger } from '../ui/InterventionEffects';
import { OfficeRoom } from '../ui/OfficeRoom';
import { StationActor } from '../ui/OfficeActors';
import {
  planBoardScene,
  type BoardDotPlan,
  type BoardFlow,
  type BoardStationPlan,
} from './boardScene';
import { TASK_COLORS, TASK_DIAMETER } from './taskView';

const VIEW_W = 1404;
const VIEW_H = 573;
const VIEW_RATIO = VIEW_W / VIEW_H;

/** 設計px → 盤面内の % へ。 */
function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/**
 * 盤面を親スロットに「両軸 contain」で収める（比率 1404:573 を厳守）。
 * width = min(スロット幅, スロット高×比率) をインラインで与え、高さは aspect-ratio が導く。
 * CSS だけでは「狭いスロットでは幅基準・低いスロットでは高さ基準」を自動で選べないため、
 * ResizeObserver でスロット実寸から算出する（描画専用の純レイアウト。決定論に影響しない）。
 */
function useContainFit(ref: React.RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const slot = el?.parentElement;
    if (!el || !slot) return;
    const apply = () => {
      const w = slot.clientWidth;
      const h = slot.clientHeight;
      if (w === 0 || h === 0) return;
      el.style.width = `${Math.min(w, h * VIEW_RATIO)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [ref]);
}

function TaskDot({
  dot,
  draggable,
  dragging,
  onPointerDown,
}: {
  dot: BoardDotPlan;
  draggable?: boolean;
  dragging?: boolean;
  onPointerDown?: (e: React.PointerEvent, taskId: number) => void;
}) {
  const d = TASK_DIAMETER[dot.size];
  // 粒径は設計幅 1404 に対する % で持たせ、盤面サイズに追従させる。
  const sizePct = (d / VIEW_W) * 100;
  const urgency = dot.burnUrgency;
  const urgentClass =
    urgency !== undefined && urgency < 0.35
      ? ' burn-critical'
      : urgency !== undefined
        ? ' burn-warn'
        : '';
  const flowing = dot.motion?.kind === 'flow';
  const motionStyle: CSSProperties = flowing
    ? (() => {
        const rad = ((dot.motion?.angleDeg ?? 0) * Math.PI) / 180;
        const speedMul = dot.motion?.speedMul ?? 1;
        return {
          '--flow-dx': `${Math.cos(rad) * 5}px`,
          '--flow-dy': `${Math.sin(rad) * 5}px`,
          '--flow-duration': `${1.15 / speedMul}s`,
        } as CSSProperties;
      })()
    : {};
  return (
    <span
      className={`task-dot variant-${dot.variant}${urgentClass}${flowing ? ' flowing' : ''}${draggable ? ' draggable' : ''}${dragging ? ' dragging' : ''}`}
      data-variant={dot.variant}
      data-task-id={dot.id}
      data-flowing={flowing ? 'true' : undefined}
      data-draggable={draggable ? 'true' : undefined}
      onPointerDown={draggable && onPointerDown ? (e) => onPointerDown(e, dot.id) : undefined}
      style={{
        left: pct(dot.x, VIEW_W),
        top: pct(dot.y, VIEW_H),
        width: `${sizePct}%`,
        aspectRatio: '1 / 1',
        background: TASK_COLORS[dot.variant],
        ...motionStyle,
        ...(urgency !== undefined ? ({ '--burn-urgency': urgency } as CSSProperties) : undefined),
      }}
    >
      {dot.fire && (
        <span
          className="flame"
          style={
            urgency !== undefined
              ? ({ fontSize: `${0.75 + (1 - urgency) * 0.35}em` } as CSSProperties)
              : undefined
          }
        >
          🔥
        </span>
      )}
    </span>
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
      data-drop-target={dropTarget ? 'true' : undefined}
      style={{ left: pct(s.x, VIEW_W), top: pct(s.y, VIEW_H) }}
    >
      <StationActor lane={s.lane} mood={s.mood} />
    </div>
  );
}

function StationLabel({ s }: { s: BoardStationPlan }) {
  return (
    <div
      className={`st-label${s.hot ? ' hot' : ''}`}
      style={{ left: pct(s.labelX, VIEW_W), top: pct(s.labelY, VIEW_H) }}
    >
      {s.icon} {s.label}{' '}
      <small data-testid={`count-${s.lane}`}>
        {s.count}
        {s.hot ? ' ⚠' : ''}
      </small>
    </div>
  );
}

function Bubble({ s }: { s: BoardStationPlan }) {
  if (!s.bubble) return null;
  const tone =
    s.mood === 'panic' || s.mood === 'sad'
      ? 'hot'
      : s.mood === 'happy' || s.mood === 'cheer'
        ? 'warm'
        : '';
  return (
    <div
      className={`bubble ${tone}`}
      style={{ left: pct(s.bubbleX, VIEW_W), top: pct(s.bubbleY, VIEW_H) }}
    >
      {s.bubble}
    </div>
  );
}

function FlowArrows({ flows }: { flows: readonly BoardFlow[] }) {
  return (
    <svg
      className="office-flows"
      viewBox="0 0 1404 573"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker id="bd-ah" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#cdbff0" />
        </marker>
        <marker id="bd-ahr" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#ff9a93" />
        </marker>
      </defs>
      {flows.map((f) => (
        <line
          key={`${f.from}-${f.to}`}
          className="flowdash"
          x1={f.x1}
          y1={f.y1}
          x2={f.x2}
          y2={f.y2}
          stroke={f.rework ? '#ff9a93' : '#cdbff0'}
          strokeWidth={f.rework ? 2.5 : 3.5}
          opacity={f.rework ? 0.6 : 0.85}
          markerEnd={`url(#${f.rework ? 'bd-ahr' : 'bd-ah'})`}
        />
      ))}
    </svg>
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
  /** 武装中のドラッグ介入（RI-30）。フル SprintState があると候補判定が正確。 */
  sprint?: SprintState | null;
  armedAction?: DraggableActionId | null;
  /** タスク差配の担当指定（省略時は defaultAssignee）。 */
  assignAssignee?: 'ai' | 'senior';
  onDragComplete?: (target: ActionTarget) => void;
}

/** 凡例（mockups の dot 凡例）。 */
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
  sprint = null,
  armedAction = null,
  assignAssignee,
  onDragComplete,
}: BoardProps) {
  const scene = planBoardScene(tasks);
  // hot なら Review Hell トーン（強）。heat は hot 手前から徐々に盤面を赤くする
  // 早期警告で、--review-heat（0..1）で赤みオーバーレイの濃さをスケールする（第18.2/18.3）。
  const hot = scene.stations.some((s) => s.hot);
  const heat = scene.stations.reduce((m, s) => Math.max(m, s.heat), 0);

  const boardRef = useRef<HTMLDivElement>(null);
  useContainFit(boardRef);
  const activeAuras = modifiers != null ? deriveActiveBoardAuras(modifiers, sprintTick) : [];

  const dragPlan =
    armedAction && sprint ? planBoardDrag(sprint, armedAction, assignAssignee) : null;
  const dragIds = new Set(dragPlan?.draggableTaskIds ?? []);
  const dropLanes = new Set(dragPlan?.dropLanes ?? []);

  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [hoverLane, setHoverLane] = useState<Lane | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, taskId: number) => {
      if (!armedAction || !onDragComplete || !dragPlan) return;
      e.preventDefault();
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

  return (
    <div
      ref={boardRef}
      className={`board iso-office${hot ? ' review-hell' : ''}${armedAction ? ' board-armed' : ''}`}
      data-testid="board"
      data-armed={armedAction ?? undefined}
      style={{ '--review-heat': heat } as CSSProperties}
    >
      <OfficeRoom />
      <FlowArrows flows={scene.flows} />

      {scene.dots.map((d) => (
        <TaskDot
          key={`${d.lane}-${d.id}`}
          dot={d}
          draggable={dragIds.has(d.id)}
          dragging={dragTaskId === d.id}
          onPointerDown={handlePointerDown}
        />
      ))}

      {scene.stations.map((s) => (
        <Station
          key={s.lane}
          s={s}
          dropTarget={dropLanes.has(s.lane as 'backlog' | 'coding' | 'review')}
          hover={hoverLane === s.lane}
        />
      ))}
      {scene.stations.map((s) => (
        <StationLabel key={`l-${s.lane}`} s={s} />
      ))}
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

      <div className="board-legend">
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

      {metrics && (
        <FireEffects
          tasks={tasks}
          metrics={metrics}
          reviewAccumulator={reviewAccumulator}
          suppressExtinguishTaskIds={suppressExtinguishTaskIds}
        />
      )}

      {activeAuras.map((aura) => (
        <div
          key={aura.kind}
          className={`board-modifier-aura aura-${aura.kind}`}
          data-testid={`board-aura-${aura.kind}`}
          style={
            {
              '--aura-remaining': aura.remainingTicks / aura.totalTicks,
            } as CSSProperties
          }
        />
      ))}

      {interventionTrigger && <InterventionEffects trigger={interventionTrigger} />}
    </div>
  );
}
