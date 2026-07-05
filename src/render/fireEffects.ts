/**
 * 延焼・鎮火・点火の演出 plan（SPEC 第18.2 / RI-06）。
 *
 * スプリント状態の前後差分から、盤面上で再生する演出イベントを導出する純関数。
 * シミュレーション層は触らず、描画専用（第22.2）。
 */
import { planBoardScene } from './boardScene';
import type { Lane, SprintMetrics, Task } from '../sim/types';

/** 盤面上で再生する炎上関連の演出イベント。 */
export type FireEffect =
  | { kind: 'spread'; fromTaskId: number; toTaskId: number }
  | { kind: 'extinguish'; taskId: number; source: 'firefight' | 'auto' }
  | { kind: 'ignite'; taskId: number };

/** 演出検出用の軽量スナップショット。 */
export interface FireSnapshot {
  tasks: ReadonlyArray<{
    id: number;
    lane: Lane;
    incident: boolean;
    debt: boolean;
    burnTicksLeft?: number;
  }>;
  spread: number;
  contained: number;
  incidentCount: number;
}

/** 座標付きの演出（レンダラ向け）。設計空間 1404×573 の px。 */
export type PositionedFireEffect =
  | {
      kind: 'spread';
      fromTaskId: number;
      toTaskId: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  | {
      kind: 'extinguish';
      taskId: number;
      source: 'firefight' | 'auto';
      x: number;
      y: number;
    }
  | { kind: 'ignite'; taskId: number; x: number; y: number };

const VIEW_W = 1404;
const VIEW_H = 573;

/** スプリント状態から演出検出用スナップショットを作る。 */
export function createFireSnapshot(tasks: readonly Task[], metrics: SprintMetrics): FireSnapshot {
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      lane: t.lane,
      incident: t.incident,
      debt: t.debt,
      burnTicksLeft: t.burnTicksLeft,
    })),
    spread: metrics.spread,
    contained: metrics.contained,
    incidentCount: metrics.incidentCount,
  };
}

/** 参照が毎 tick 変わっても、実質同じなら演出検出をスキップする。 */
export function fireSnapshotsEqual(a: FireSnapshot, b: FireSnapshot): boolean {
  if (
    a.spread !== b.spread ||
    a.contained !== b.contained ||
    a.incidentCount !== b.incidentCount ||
    a.tasks.length !== b.tasks.length
  ) {
    return false;
  }
  for (let i = 0; i < a.tasks.length; i += 1) {
    const x = a.tasks[i];
    const y = b.tasks[i];
    if (
      x.id !== y.id ||
      x.lane !== y.lane ||
      x.incident !== y.incident ||
      x.debt !== y.debt ||
      x.burnTicksLeft !== y.burnTicksLeft
    ) {
      return false;
    }
  }
  return true;
}

function isSpreadSource(
  prev: FireSnapshot['tasks'][number],
  next: FireSnapshot['tasks'][number] | undefined,
): boolean {
  return Boolean(
    prev.incident &&
    prev.lane === 'rework' &&
    next &&
    !next.incident &&
    next.lane === 'rework' &&
    next.debt &&
    !prev.debt,
  );
}

/**
 * 前後スナップショットから演出イベントを検出する（決定論）。
 *
 * - spread: metrics.spread 増加 → タイマー切れ rework 火から Review 先頭への連鎖着火
 * - ignite: 延焼対象以外の Review 落ち点火
 * - extinguish: contained 増加分だけ（延焼元は除外）
 */
export function detectFireEvents(prev: FireSnapshot, next: FireSnapshot): FireEffect[] {
  const effects: FireEffect[] = [];
  const prevMap = new Map(prev.tasks.map((t) => [t.id, t]));
  const nextMap = new Map(next.tasks.map((t) => [t.id, t]));

  const spreadDelta = next.spread - prev.spread;
  const containedDelta = next.contained - prev.contained;

  const newlyIgnited = next.tasks.filter((n) => {
    const p = prevMap.get(n.id);
    return p && !p.incident && n.incident;
  });

  const spreadTargetIds = new Set<number>();

  if (spreadDelta > 0) {
    const expired = prev.tasks.filter((p) => isSpreadSource(p, nextMap.get(p.id)));
    const spreadCandidates = newlyIgnited
      .filter((n) => prevMap.get(n.id)?.lane === 'review')
      .sort(
        (a, b) =>
          prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
      );

    for (let i = 0; i < spreadDelta; i += 1) {
      const from = expired[i] ?? expired[0];
      const to =
        spreadCandidates.find((n) => !spreadTargetIds.has(n.id)) ?? spreadCandidates[i] ?? null;
      if (from && to) {
        spreadTargetIds.add(to.id);
        effects.push({ kind: 'spread', fromTaskId: from.id, toTaskId: to.id });
      }
    }
  }

  for (const n of newlyIgnited) {
    const p = prevMap.get(n.id);
    if (p && p.lane === 'review' && !spreadTargetIds.has(n.id)) {
      effects.push({ kind: 'ignite', taskId: n.id });
    }
  }

  if (containedDelta > 0) {
    const extinguishCandidates = prev.tasks
      .filter((p) => {
        const n = nextMap.get(p.id);
        if (!n || !p.incident || n.incident) return false;
        if (isSpreadSource(p, n)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
      );

    for (let i = 0; i < containedDelta && i < extinguishCandidates.length; i += 1) {
      const p = extinguishCandidates[i];
      const n = nextMap.get(p.id)!;
      effects.push({
        kind: 'extinguish',
        taskId: p.id,
        source: n.lane === 'review' ? 'firefight' : 'auto',
      });
    }
  }

  return effects;
}

/** 設計 px → 盤面内の % 文字列。Board と同式。 */
export function firePct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function dotPosition(tasks: readonly Task[], taskId: number): { x: number; y: number } | null {
  const dot = planBoardScene(tasks).dots.find((d) => d.id === taskId);
  if (!dot) return null;
  return { x: dot.x, y: dot.y };
}

/**
 * 演出イベントに盤面座標を付与する。
 * extinguish は鎮火前（prevTasks）の位置を使い、firefight 後の Review 山へのずれを防ぐ。
 */
export function positionFireEffects(
  effects: readonly FireEffect[],
  nextTasks: readonly Task[],
  prevTasks: readonly Task[] = nextTasks,
): PositionedFireEffect[] {
  return effects.flatMap((effect): PositionedFireEffect[] => {
    switch (effect.kind) {
      case 'spread': {
        const from =
          dotPosition(prevTasks, effect.fromTaskId) ?? dotPosition(nextTasks, effect.fromTaskId);
        const to = dotPosition(nextTasks, effect.toTaskId);
        if (!from || !to) return [];
        return [{ ...effect, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }];
      }
      case 'extinguish': {
        const pos = dotPosition(prevTasks, effect.taskId) ?? dotPosition(nextTasks, effect.taskId);
        if (!pos) return [];
        return [{ ...effect, x: pos.x, y: pos.y }];
      }
      case 'ignite': {
        const pos = dotPosition(nextTasks, effect.taskId);
        if (!pos) return [];
        return [{ ...effect, x: pos.x, y: pos.y }];
      }
      default:
        return [];
    }
  });
}

export const FIRE_VIEW = { w: VIEW_W, h: VIEW_H } as const;
