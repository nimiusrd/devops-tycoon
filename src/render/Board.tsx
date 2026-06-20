/**
 * 盤面レンダラ（SPEC 第4.1 / mockups/main-screen 準拠）。
 *
 * 「状態を読んで描くだけ」の一方向に徹する（第22.2）。タスク粒が
 * Backlog → Coding → Review → Rework → Done を流れる様子を DOM で表示する。
 * MVP3 以降で PixiJS へ移植する（第22.4）。
 */
import type { CSSProperties } from 'react';
import type { Lane, SimState, Task } from '../sim/types';
import { taskColor, taskDiameter, taskVariant } from './taskView';

const LANES: { id: Lane; label: string; icon: string }[] = [
  { id: 'backlog', label: 'Backlog', icon: '📥' },
  { id: 'coding', label: 'Coding', icon: '💻' },
  { id: 'review', label: 'Review', icon: '🔍' },
  { id: 'rework', label: 'Rework', icon: '↩️' },
  { id: 'done', label: 'Done', icon: '📦' },
];

/** Done レーンで表示する粒の最大数（多すぎる場合は数で代替）。 */
const DONE_DISPLAY_CAP = 14;

function TaskDot({ task }: { task: Task }) {
  const variant = taskVariant(task);
  const d = taskDiameter(task);
  return (
    <span
      className={`task-dot variant-${variant}`}
      style={{ width: d, height: d, background: taskColor(task) }}
      title={`#${task.id} ${task.kind}${task.aiAssisted ? ' / AI' : ''}`}
      data-variant={variant}
    >
      {variant === 'incident' && <span className="flame">🔥</span>}
    </span>
  );
}

export interface BoardProps {
  state: SimState;
}

/** Review 渋滞ヒートマップの強度（0..1）。この件数で赤熱が最大に達する。 */
const HEAT_MAX_QUEUE = 16;

export function Board({ state }: BoardProps) {
  const byLane = (lane: Lane) => state.sprint.tasks.filter((t) => t.lane === lane);

  return (
    <div className="board" data-testid="board">
      {LANES.map(({ id, label, icon }) => {
        const tasks = byLane(id);
        const shown = id === 'done' ? tasks.slice(0, DONE_DISPLAY_CAP) : tasks;
        const congested = id === 'review' && tasks.length >= 12;
        // 渋滞ヒートマップ: Review レーンは件数に応じて赤熱する（第18.2）。
        const heat = id === 'review' ? Math.min(1, tasks.length / HEAT_MAX_QUEUE) : 0;
        return (
          <section
            key={id}
            className={`lane lane-${id}${congested ? ' congested' : ''}`}
            data-testid={`lane-${id}`}
            data-heat={id === 'review' ? heat.toFixed(2) : undefined}
            style={id === 'review' ? ({ '--heat': heat } as CSSProperties) : undefined}
          >
            <header className="lane-head">
              <span className="lane-title">
                {icon} {label}
              </span>
              <span className="lane-count" data-testid={`count-${id}`}>
                {tasks.length}
              </span>
            </header>
            <div className="lane-body">
              {shown.map((t) => (
                <TaskDot key={t.id} task={t} />
              ))}
              {id === 'done' && tasks.length > DONE_DISPLAY_CAP && (
                <span className="lane-overflow">+{tasks.length - DONE_DISPLAY_CAP}</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
