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
  /** advanceReview の小数スループット（延焼先判定用）。 */
  reviewAccumulator: number;
  /** 緊急対応の累計回数（鎮火 source 判定用）。 */
  firefightCount: number;
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
export function createFireSnapshot(
  tasks: readonly Task[],
  metrics: SprintMetrics,
  reviewAccumulator = 0,
): FireSnapshot {
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
    reviewAccumulator,
    firefightCount: metrics.actionCounts.firefight ?? 0,
  };
}

/** 参照が毎 tick 変わっても、実質同じなら演出検出をスキップする。 */
export function fireSnapshotsEqual(a: FireSnapshot, b: FireSnapshot): boolean {
  if (
    a.spread !== b.spread ||
    a.contained !== b.contained ||
    a.incidentCount !== b.incidentCount ||
    a.reviewAccumulator !== b.reviewAccumulator ||
    a.firefightCount !== b.firefightCount ||
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

function isExpiredReworkFire(
  prev: FireSnapshot['tasks'][number],
  next: FireSnapshot['tasks'][number] | undefined,
): boolean {
  return Boolean(
    prev.incident && prev.lane === 'rework' && next && !next.incident && next.lane === 'rework',
  );
}

/** 延焼で負債が新規付与された火（再炎上で既に debt な場合も expired 側で拾う）。 */
function isSpreadSource(
  prev: FireSnapshot['tasks'][number],
  next: FireSnapshot['tasks'][number],
): boolean {
  if (!isExpiredReworkFire(prev, next)) return false;
  return !prev.debt && next.debt;
}

function pickSpreadSources(
  expiredInOrder: FireSnapshot['tasks'],
  spreadDelta: number,
  containedDelta: number,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
): FireSnapshot['tasks'] {
  if (spreadDelta <= 0) return [];
  if (containedDelta <= 0) return expiredInOrder.slice(0, spreadDelta);

  const definite = expiredInOrder.filter((p) => isSpreadSource(p, nextMap.get(p.id)!));
  const ambiguous = expiredInOrder.filter((p) => !definite.includes(p));
  const ambiguousNeeded = Math.max(0, spreadDelta - definite.length);
  // 同 tick に鎮火がある場合、先に処理された火ほど contained になりやすい。
  return [...definite, ...ambiguous.slice(-ambiguousNeeded)].slice(0, spreadDelta);
}

function countReviewNonIgniteDepartures(
  prev: FireSnapshot,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
): number {
  return prev.tasks.filter((p) => {
    if (p.lane !== 'review') return false;
    const n = nextMap.get(p.id);
    return n && n.lane !== 'review' && !n.incident;
  }).length;
}

function reviewProcessedInTick(
  prev: FireSnapshot,
  next: FireSnapshot,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
): boolean {
  const definiteReviewWork = prev.tasks.some((p) => {
    if (p.lane !== 'review') return false;
    const n = nextMap.get(p.id);
    if (!n || n.lane === 'review') return false;
    return n.lane === 'done' || (n.lane === 'rework' && !n.incident);
  });
  if (definiteReviewWork) return true;

  const prevReviewCount = prev.tasks.filter((t) => t.lane === 'review').length;
  const nextReviewCount = next.tasks.filter((t) => t.lane === 'review').length;
  if (prevReviewCount <= 1) {
    return next.reviewAccumulator < prev.reviewAccumulator;
  }

  const reviewDepartures = prev.tasks.filter(
    (p) => p.lane === 'review' && nextMap.get(p.id)?.lane !== 'review',
  ).length;
  return reviewDepartures > 0 && nextReviewCount < prevReviewCount;
}

function spreadCandidateIgnites(
  reviewIgnites: FireSnapshot['tasks'],
  prev: FireSnapshot,
  next: FireSnapshot,
  prevMap: Map<number, FireSnapshot['tasks'][number]>,
): FireSnapshot['tasks'] {
  return reviewIgnites.filter((n) => {
    const prevLane = prevMap.get(n.id)?.lane;
    if (prevLane === 'review') return true;
    if (prevLane === 'coding') return next.reviewAccumulator >= prev.reviewAccumulator;
    return false;
  });
}

function pickReviewLaneSpreadCount(
  reviewLaneIgnites: FireSnapshot['tasks'],
  spreadDelta: number,
  prevReviewCount: number,
  nonIgniteDepartures: number,
): number {
  const n = reviewLaneIgnites.length;
  const remainingSlots = prevReviewCount - nonIgniteDepartures;
  for (let k = Math.min(spreadDelta, n); k >= 0; k -= 1) {
    const queueAtSpread = remainingSlots - (n - k);
    if (queueAtSpread >= k) return k;
  }
  return 0;
}

/** advanceReview 後に Review へ残っていたタスクだけが延焼先になりうる。 */
function pickSpreadTargets(
  prev: FireSnapshot,
  next: FireSnapshot,
  reviewIgnites: FireSnapshot['tasks'],
  spreadDelta: number,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
  prevMap: Map<number, FireSnapshot['tasks'][number]>,
): FireSnapshot['tasks'] {
  if (spreadDelta <= 0) return [];

  const candidates = spreadCandidateIgnites(reviewIgnites, prev, next, prevMap);
  if (candidates.length === 0) return [];

  const reviewLaneIgnites = candidates.filter((n) => prevMap.get(n.id)?.lane === 'review');
  const codingCandidates = candidates.filter((n) => prevMap.get(n.id)?.lane === 'coding');

  const prevReviewCount = prev.tasks.filter((t) => t.lane === 'review').length;
  const nonIgniteDepartures = countReviewNonIgniteDepartures(prev, nextMap);

  let reviewSpreadCount = pickReviewLaneSpreadCount(
    reviewLaneIgnites,
    spreadDelta,
    prevReviewCount,
    nonIgniteDepartures,
  );

  if (
    prevReviewCount === 1 &&
    reviewLaneIgnites.length === 1 &&
    codingCandidates.length === 0 &&
    reviewProcessedInTick(prev, next, nextMap)
  ) {
    reviewSpreadCount = 0;
  }

  const codingSpreadCount = Math.min(spreadDelta - reviewSpreadCount, codingCandidates.length);

  const reviewSpreadTargets =
    reviewSpreadCount <= 0 ? [] : reviewLaneIgnites.slice(-reviewSpreadCount);
  const targets = [
    ...reviewSpreadTargets,
    ...codingCandidates.slice(0, codingSpreadCount),
  ].sort(
    (a, b) =>
      prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
  );

  return targets;
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
  const spreadSourceIds = new Set<number>();

  const reviewIgnites = newlyIgnited
    .filter((n) => {
      const prevLane = prevMap.get(n.id)?.lane;
      return prevLane === 'review' || prevLane === 'coding';
    })
    .sort(
      (a, b) =>
        prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
    );

  if (spreadDelta > 0) {
    const expiredInOrder = prev.tasks.filter((p) => isExpiredReworkFire(p, nextMap.get(p.id)));
    const spreadSources = pickSpreadSources(expiredInOrder, spreadDelta, containedDelta, nextMap);
    const spreadTargets = pickSpreadTargets(
      prev,
      next,
      reviewIgnites,
      spreadDelta,
      nextMap,
      prevMap,
    );

    const spreadCount = Math.min(spreadDelta, spreadSources.length, spreadTargets.length);
    for (let i = 0; i < spreadCount; i += 1) {
      const from = spreadSources[i];
      const to = spreadTargets[i];
      spreadSourceIds.add(from.id);
      spreadTargetIds.add(to.id);
      effects.push({ kind: 'spread', fromTaskId: from.id, toTaskId: to.id });
    }
  }

  for (const n of reviewIgnites) {
    if (!spreadTargetIds.has(n.id)) {
      effects.push({ kind: 'ignite', taskId: n.id });
    }
  }

  if (containedDelta > 0) {
    const firefightDelta = next.firefightCount - prev.firefightCount;
    const firefightRemaining = Math.max(0, firefightDelta);

    const extinguishCandidates = prev.tasks
      .filter((p) => {
        const n = nextMap.get(p.id);
        if (!n || !p.incident || n.incident) return false;
        if (spreadSourceIds.has(p.id)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          (a.burnTicksLeft ?? Number.POSITIVE_INFINITY) -
            (b.burnTicksLeft ?? Number.POSITIVE_INFINITY) ||
          prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
      );

    const firefightIds = new Set(
      extinguishCandidates.slice(0, firefightRemaining).map((p) => p.id),
    );

    for (let i = 0; i < containedDelta && i < extinguishCandidates.length; i += 1) {
      const p = extinguishCandidates[i];
      effects.push({
        kind: 'extinguish',
        taskId: p.id,
        source: firefightIds.has(p.id) ? 'firefight' : 'auto',
      });
    }
  }

  return effects;
}

/** 設計 px → 盤面内の % 文字列。Board と同式。 */
export function firePct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function laneFallbackPosition(tasks: readonly Task[], lane: Lane): { x: number; y: number } | null {
  const station = planBoardScene(tasks).stations.find((s) => s.lane === lane);
  if (!station) return null;
  return { x: station.overflowX, y: station.overflowY };
}

function dotPosition(tasks: readonly Task[], taskId: number): { x: number; y: number } | null {
  const dot = planBoardScene(tasks).dots.find((d) => d.id === taskId);
  if (dot) return { x: dot.x, y: dot.y };

  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  return laneFallbackPosition(tasks, task.lane);
}

function spreadTargetPosition(
  tasks: readonly Task[],
  taskId: number,
  prevTasks: readonly Task[],
): { x: number; y: number } | null {
  const prevTask = prevTasks.find((t) => t.id === taskId);
  if (prevTask?.lane === 'coding') {
    return laneFallbackPosition(prevTasks, 'review') ?? dotPosition(tasks, taskId);
  }
  return dotPosition(prevTasks, taskId) ?? dotPosition(tasks, taskId);
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
        const to = spreadTargetPosition(nextTasks, effect.toTaskId, prevTasks);
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
