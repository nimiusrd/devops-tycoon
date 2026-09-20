/**
 * R&D 盤面 A/B の固定場面とヒット可視化（捨て実験）。
 *
 * シミュレーション定数・HUD・ゲームルールは変えない。盤面に載せるタスク列と
 * ラベル／ヒット円の計画だけを決める。
 */
import { BURN_TICKS } from '../sim/model';
import type { SprintEvent, SprintMetrics, Task } from '../sim/types';
import type { BoardDotPlan, BoardScenePlan } from './boardScene';
import { REVIEW_HOT_QUEUE } from './boardScene';
import { hitTestBoardDot, DOT_HIT_MARGIN } from './boardPixiView';
import { TASK_DIAMETER } from './taskView';
import { RD_BOARD_PROTOTYPE_SEED } from './rdBoardLayout';

export { RD_BOARD_PROTOTYPE_SEED };

/** 炎上（Rework で燃焼中）の固定タスク。 */
export const RD_FIRE_TASK_ID = 9001;
/** 延焼先（Review に燃え移った粒）の固定タスク。 */
export const RD_SPREAD_TARGET_TASK_ID = 9002;

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'review',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

/**
 * 炎上・渋滞・延焼が同一フレームに揃う決定論タスク列。
 * Review は hot 閾値ちょうど、Rework に燃焼中、Review に延焼先の incident。
 */
export function createRdStressTasks(): Task[] {
  const reviewQueue: Task[] = Array.from({ length: REVIEW_HOT_QUEUE - 1 }, (_, i) =>
    task(i + 1, { lane: 'review' }),
  );
  return [
    task(20, { lane: 'backlog' }),
    task(21, { lane: 'backlog' }),
    task(30, { lane: 'coding' }),
    task(31, { lane: 'coding', progress: 0.45, aiAssisted: true }),
    ...reviewQueue,
    task(RD_SPREAD_TARGET_TASK_ID, {
      lane: 'review',
      incident: true,
      reworkAttempts: 1,
      wasReworked: true,
    }),
    task(RD_FIRE_TASK_ID, {
      lane: 'rework',
      incident: true,
      burnTicksLeft: Math.max(1, Math.floor(BURN_TICKS * 0.25)),
      reworkAttempts: 1,
      wasReworked: true,
    }),
    task(40, { lane: 'done' }),
  ];
}

export interface RdStressOverlay {
  tasks: Task[];
  metrics: Partial<SprintMetrics>;
  events: SprintEvent[];
}

/** live sprint へ載せる固定場面（メトリクスとティッカー用イベント含む）。 */
export function createRdStressOverlay(): RdStressOverlay {
  const tasks = createRdStressTasks();
  const events: SprintEvent[] = [
    {
      tick: 8,
      kind: 'ignite',
      taskId: RD_FIRE_TASK_ID,
      source: 'review',
    },
    {
      tick: 12,
      kind: 'spread',
      taskId: RD_FIRE_TASK_ID,
      spreadToTaskId: RD_SPREAD_TARGET_TASK_ID,
      debtGain: 1,
      moraleCost: 1,
    },
    {
      tick: 12,
      kind: 'ignite',
      taskId: RD_SPREAD_TARGET_TASK_ID,
      source: 'spread',
    },
  ];
  return {
    tasks,
    metrics: {
      incidentCount: 2,
      spread: 1,
      contained: 0,
      reviewQueueMax: REVIEW_HOT_QUEUE,
    },
    events,
  };
}

export type RdSignalId = 'fire' | 'congestion' | 'spread';

export interface RdSignalMarker {
  id: RdSignalId;
  /** 研究者が指差すラベル（色に頼らない）。 */
  label: string;
  x: number;
  y: number;
}

export interface RdSpreadLink {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface RdHitArea {
  id: number;
  x: number;
  y: number;
  r: number;
  fire: boolean;
}

function dotById(scene: BoardScenePlan, id: number): BoardDotPlan | undefined {
  return scene.dots.find((dot) => dot.id === id);
}

/** 炎上・渋滞・延焼の指差しラベル。無い信号は載せない。 */
export function planRdSignalMarkers(scene: BoardScenePlan): RdSignalMarker[] {
  const markers: RdSignalMarker[] = [];
  const fireDot = dotById(scene, RD_FIRE_TASK_ID) ?? scene.dots.find((dot) => dot.fire);
  if (fireDot) {
    markers.push({ id: 'fire', label: '炎上', x: fireDot.x, y: fireDot.y - 28 });
  }

  const review = scene.stations.find((station) => station.lane === 'review');
  if (review?.hot) {
    markers.push({ id: 'congestion', label: '渋滞', x: review.x, y: review.y - 42 });
  }

  const spreadDot = dotById(scene, RD_SPREAD_TARGET_TASK_ID);
  if (spreadDot) {
    markers.push({ id: 'spread', label: '延焼', x: spreadDot.x, y: spreadDot.y - 28 });
  }
  return markers;
}

/** 延焼の発生元→先。どちらか欠けると null。 */
export function planRdSpreadLink(scene: BoardScenePlan): RdSpreadLink | null {
  const from = dotById(scene, RD_FIRE_TASK_ID);
  const to = dotById(scene, RD_SPREAD_TARGET_TASK_ID);
  if (!from || !to) return null;
  return { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
}

/** 粒の実ヒット円（半径 = 直径/2 + マージン）。 */
export function planRdHitAreas(dots: readonly BoardDotPlan[]): RdHitArea[] {
  return dots.map((dot) => ({
    id: dot.id,
    x: dot.x,
    y: dot.y,
    r: TASK_DIAMETER[dot.size] / 2 + DOT_HIT_MARGIN,
    fire: dot.fire,
  }));
}

/** レーン配置で粒同士のヒット円が重ならないか。 */
export function rdHitAreasOverlap(areas: readonly RdHitArea[]): boolean {
  for (let i = 0; i < areas.length; i += 1) {
    for (let j = i + 1; j < areas.length; j += 1) {
      const a = areas[i];
      const b = areas[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < (a.r + b.r) * (a.r + b.r)) return true;
    }
  }
  return false;
}

export function hitTestRdBoardDot(
  pt: { x: number; y: number },
  dots: readonly BoardDotPlan[],
): number | null {
  const ids = new Set(dots.map((dot) => dot.id));
  return hitTestBoardDot(pt, dots, ids);
}
