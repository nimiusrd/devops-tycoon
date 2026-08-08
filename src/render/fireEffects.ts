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

  const ambiguous = expiredInOrder.filter((p) => !isSpreadSource(p, nextMap.get(p.id)!));
  const ambiguousNeeded = Math.max(
    0,
    spreadDelta - expiredInOrder.filter((p) => isSpreadSource(p, nextMap.get(p.id)!)).length,
  );
  const ambiguousSpread = ambiguous.slice(-ambiguousNeeded);
  const picked: FireSnapshot['tasks'][number][] = [];
  for (const p of expiredInOrder) {
    if (picked.length >= spreadDelta) break;
    if (isSpreadSource(p, nextMap.get(p.id)!)) {
      picked.push(p);
    } else if (ambiguousSpread.includes(p)) {
      picked.push(p);
    }
  }
  return picked;
}

function sortByTaskOrder(prev: FireSnapshot, tasks: FireSnapshot['tasks']): FireSnapshot['tasks'] {
  return [...tasks].sort(
    (a, b) =>
      prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
  );
}

function sortByBurnUrgency(
  prev: FireSnapshot,
  tasks: FireSnapshot['tasks'],
): FireSnapshot['tasks'] {
  return [...tasks].sort(
    (a, b) =>
      (a.burnTicksLeft ?? Number.POSITIVE_INFINITY) -
        (b.burnTicksLeft ?? Number.POSITIVE_INFINITY) ||
      prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
  );
}

/** 同 tick 内に firefight 対象が Review 落ちで再点火したタスク ID。 */
function pickFirefightReIgnites(
  prev: FireSnapshot,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
  firefightDelta: number,
  firefightTargetIds: readonly number[],
): number[] {
  if (firefightDelta <= 0) return [];
  return firefightTargetIds.filter((id) => {
    const p = prev.tasks.find((t) => t.id === id);
    return Boolean(p?.incident && nextMap.get(id)?.incident);
  });
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

/** advanceCoding 後に Review 待ちへ入ったタスク ID（sim の tasks 配列順）。 */
function buildReviewQueueAfterCoding(
  prev: FireSnapshot,
  prevMap: Map<number, FireSnapshot['tasks'][number]>,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
  firefightTargetIds: readonly number[] = [],
): number[] {
  const ids: number[] = [];
  for (const p of prev.tasks) {
    if (p.lane === 'review') {
      ids.push(p.id);
    } else if (p.lane === 'coding') {
      const n = nextMap.get(p.id);
      if (n && n.lane !== 'coding') ids.push(p.id);
    } else if (p.lane === 'backlog') {
      const n = nextMap.get(p.id);
      if (n && n.lane !== 'backlog' && n.lane !== 'coding') ids.push(p.id);
    }
  }
  for (const id of firefightTargetIds) {
    const p = prevMap.get(id);
    const n = nextMap.get(id);
    if (!p || !n || ids.includes(id)) continue;
    if (p.incident && p.lane === 'rework' && n.incident) ids.unshift(id);
  }
  return ids;
}

/** 先頭 Review タスクが advanceReview で処理されうるか（accumulator 下限で推定）。 */
function reviewWouldProcessFront(prev: FireSnapshot, next: FireSnapshot, queue: number[]): boolean {
  if (queue.length === 0) return false;
  const minThroughput = Math.max(0, next.reviewAccumulator - prev.reviewAccumulator);
  if (prev.reviewAccumulator >= 1) return true;
  return prev.reviewAccumulator + minThroughput >= 1;
}

/**
 * advanceReview → advanceBurning の順序を Review キューで再現し、延焼先 ID を導出する。
 * spread は metrics だけ増えて対象が無いケース（Review 落ちのみ）も区別する。
 */
function inferSpreadTargetIds(
  prev: FireSnapshot,
  next: FireSnapshot,
  prevMap: Map<number, FireSnapshot['tasks'][number]>,
  nextMap: Map<number, FireSnapshot['tasks'][number]>,
  spreadDelta: number,
  firefightTargetIds: readonly number[] = [],
): number[] {
  if (spreadDelta <= 0) return [];

  const queue = buildReviewQueueAfterCoding(prev, prevMap, nextMap, firefightTargetIds);
  if (queue.length === 0) return [];

  const stillReview = queue.filter((id) => nextMap.get(id)?.lane === 'review');
  const doneSet = new Set(queue.filter((id) => nextMap.get(id)?.lane === 'done'));
  const q = queue.filter((id) => !doneSet.has(id));

  const valid: { s: number; targets: number[] }[] = [];
  for (let s = 0; s <= Math.min(spreadDelta, q.length); s += 1) {
    const queueAtSpreadLen = stillReview.length + s;
    const rpc = q.length - queueAtSpreadLen;
    if (rpc < 0) continue;
    const queueAtSpread = q.slice(rpc);
    if (queueAtSpread.length !== queueAtSpreadLen) continue;
    const targets = queueAtSpread.slice(0, s);
    const suffix = queueAtSpread.slice(s);
    if (suffix.length !== stillReview.length) continue;
    if (!suffix.every((id, i) => id === stillReview[i])) continue;
    if (!targets.every((id) => nextMap.get(id)?.incident)) continue;
    valid.push({ s, targets });
  }

  if (valid.length === 0) return [];

  const zero = valid.find((v) => v.s === 0);
  const max = valid.reduce((best, v) => (v.s > best.s ? v : best));

  if (zero) {
    const freshCompletions = queue.every((id) => {
      const lane = prevMap.get(id)?.lane;
      return lane === 'coding' || lane === 'backlog';
    });
    if (freshCompletions && reviewWouldProcessFront(prev, next, queue)) {
      return zero.targets;
    }
    const prevReviewInQueue = queue.filter((id) => prevMap.get(id)?.lane === 'review');
    const singleReviewTargetlessSpread =
      queue.length === 1 && prevReviewInQueue.length === 1 && max.s > 0;
    if (next.reviewAccumulator < prev.reviewAccumulator && singleReviewTargetlessSpread) {
      return zero.targets;
    }
    if (stillReview.length === 0 && max.s > 0) {
      const minThroughput = Math.max(0, next.reviewAccumulator - prev.reviewAccumulator);
      const minProcessed = prev.reviewAccumulator + minThroughput - next.reviewAccumulator;
      if (minProcessed >= q.length) return zero.targets;
    }
  }
  return max.targets;
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
  const firefightDelta = next.firefightCount - prev.firefightCount;

  const newlyIgnited = next.tasks.filter((n) => {
    const p = prevMap.get(n.id);
    return p && !p.incident && n.incident;
  });

  const spreadTargetIds = new Set<number>();
  const spreadSourceIds = new Set<number>();

  const reviewIgnites = newlyIgnited
    .filter((n) => {
      const prevLane = prevMap.get(n.id)?.lane;
      return prevLane === 'review' || prevLane === 'coding' || prevLane === 'backlog';
    })
    .sort(
      (a, b) =>
        prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
    );

  const firefightTargetIds = sortByBurnUrgency(
    prev,
    prev.tasks.filter((p) => p.incident),
  )
    .slice(0, Math.max(0, firefightDelta))
    .map((p) => p.id);

  let spreadTargetIdsFromSim =
    spreadDelta > 0
      ? inferSpreadTargetIds(prev, next, prevMap, nextMap, spreadDelta, firefightTargetIds)
      : [];

  const prevReviewCount = prev.tasks.filter((t) => t.lane === 'review').length;
  const reviewLaneIgnites = reviewIgnites.filter((n) => prevMap.get(n.id)?.lane === 'review');
  if (
    prevReviewCount === 1 &&
    reviewLaneIgnites.length === 1 &&
    !spreadTargetIdsFromSim.includes(reviewLaneIgnites[0].id) &&
    reviewProcessedInTick(prev, next, nextMap)
  ) {
    spreadTargetIdsFromSim = [];
  }

  if (spreadDelta > 0) {
    const expiredInOrder = prev.tasks.filter((p) => isExpiredReworkFire(p, nextMap.get(p.id)));
    const spreadSources = pickSpreadSources(expiredInOrder, spreadDelta, containedDelta, nextMap);
    const spreadTargetIdSet = new Set(spreadTargetIdsFromSim);
    const spreadTargets = sortByTaskOrder(
      prev,
      [
        ...reviewIgnites,
        ...spreadTargetIdsFromSim
          .filter((id) => prevMap.get(id)?.incident && nextMap.get(id)?.incident)
          .map((id) => nextMap.get(id)!),
      ].filter((n) => spreadTargetIdSet.has(n.id)),
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
    const firefightRemaining = Math.max(0, firefightDelta);
    const firefightReIgnites = new Set(
      pickFirefightReIgnites(prev, nextMap, firefightRemaining, firefightTargetIds),
    );
    const firefightIds = new Set(firefightTargetIds);

    const extinguishCandidates = prev.tasks
      .filter((p) => {
        const n = nextMap.get(p.id);
        if (!n || !p.incident || spreadSourceIds.has(p.id)) return false;
        if (!n.incident) return true;
        return firefightReIgnites.has(p.id);
      })
      .sort(
        (a, b) =>
          (a.burnTicksLeft ?? Number.POSITIVE_INFINITY) -
            (b.burnTicksLeft ?? Number.POSITIVE_INFINITY) ||
          prev.tasks.findIndex((t) => t.id === a.id) - prev.tasks.findIndex((t) => t.id === b.id),
      );

    for (let i = 0; i < containedDelta && i < extinguishCandidates.length; i += 1) {
      const p = extinguishCandidates[i];
      effects.push({
        kind: 'extinguish',
        taskId: p.id,
        source: firefightIds.has(p.id) ? 'firefight' : 'auto',
      });
    }

    for (const taskId of firefightReIgnites) {
      if (!spreadTargetIds.has(taskId)) {
        effects.push({ kind: 'ignite', taskId });
      }
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
  if (prevTask?.lane === 'coding' || prevTask?.lane === 'backlog') {
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
