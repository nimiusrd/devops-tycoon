/**
 * 盤面レンダラ（SPEC 第4.1 / 第18章 / mockups/main-screen 準拠）。
 *
 * 「状態を読んで描くだけ」の一方向に徹する（第22.2）。`boardScene` が組み立てた
 * シーン計画を読み、俯瞰オフィス（アイソメ）として描く: 部屋（背景）＋工程ごとの
 * ステーション（机＋キャラ＋ラベル＋吹き出し）＋タスク粒の山＋工程間フロー。
 * 座標は設計空間（1404×573）の % で重ねる。将来 PixiJS へ移植する（第22.4）。
 */
import type { CSSProperties } from 'react';
import type { Task } from '../sim/types';
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

/** 設計px → 盤面内の % へ。 */
function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function TaskDot({ dot }: { dot: BoardDotPlan }) {
  const d = TASK_DIAMETER[dot.size];
  // 粒径は設計幅 1404 に対する % で持たせ、盤面サイズに追従させる。
  const sizePct = (d / VIEW_W) * 100;
  return (
    <span
      className={`task-dot variant-${dot.variant}`}
      data-variant={dot.variant}
      style={{
        left: pct(dot.x, VIEW_W),
        top: pct(dot.y, VIEW_H),
        width: `${sizePct}%`,
        aspectRatio: '1 / 1',
        background: TASK_COLORS[dot.variant],
      }}
    >
      {dot.fire && <span className="flame">🔥</span>}
    </span>
  );
}

function Station({ s }: { s: BoardStationPlan }) {
  return (
    <div
      className={`station station-${s.lane}`}
      data-testid={`lane-${s.lane}`}
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
}

/** 凡例（mockups の dot 凡例）。 */
const LEGEND: { variant: BoardDotPlan['variant']; label: string }[] = [
  { variant: 'ai', label: 'AI利用' },
  { variant: 'rework', label: '手戻り' },
  { variant: 'gold', label: '高価値' },
  { variant: 'debt', label: '技術的負債' },
  { variant: 'incident', label: '炎上' },
];

export function Board({ tasks }: BoardProps) {
  const scene = planBoardScene(tasks);
  // hot なら Review Hell トーン（強）。heat は hot 手前から徐々に盤面を赤くする
  // 早期警告で、--review-heat（0..1）で赤みオーバーレイの濃さをスケールする（第18.2/18.3）。
  const hot = scene.stations.some((s) => s.hot);
  const heat = scene.stations.reduce((m, s) => Math.max(m, s.heat), 0);

  return (
    <div
      className={`board iso-office${hot ? ' review-hell' : ''}`}
      data-testid="board"
      style={{ '--review-heat': heat } as CSSProperties}
    >
      <OfficeRoom />
      <FlowArrows flows={scene.flows} />

      {scene.dots.map((d) => (
        <TaskDot key={`${d.lane}-${d.id}`} dot={d} />
      ))}

      {scene.stations.map((s) => (
        <Station key={s.lane} s={s} />
      ))}
      {scene.stations.map((s) => (
        <StationLabel key={`l-${s.lane}`} s={s} />
      ))}
      {scene.stations.map((s) => (
        <Bubble key={`b-${s.lane}`} s={s} />
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
    </div>
  );
}
