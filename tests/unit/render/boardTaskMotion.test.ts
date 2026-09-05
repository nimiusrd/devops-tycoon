import { describe, expect, it } from 'vitest';
import {
  BoardTaskMotion,
  shipmentParticle,
  TASK_MOTION,
} from '../../../src/render/boardTaskMotion';
import type { BoardDotPlan } from '../../../src/render/boardScene';
import { BOARD_RENDER_BUDGETS } from '../../../src/render/boardRenderBudget';

const dot = (overrides: Partial<BoardDotPlan> = {}): BoardDotPlan => ({
  id: 1,
  lane: 'review',
  x: 0,
  y: 0,
  variant: 'normal',
  size: 'medium',
  fire: false,
  ...overrides,
});
const pinned = new Set<number>();

describe('タスクの描画補間と出荷', () => {
  it('初回は現在位置に置き、連続更新は描画中の位置からつなぎ、同じ入力では再開しない', () => {
    const motion = new BoardTaskMotion();
    motion.sync([dot()], 0, false, pinned);
    motion.sync([dot({ x: 100, y: 80 })], 10, false, pinned);
    expect(motion.position(1, 10)).toEqual({ x: 0, y: 0 });
    const midway = motion.position(1, 100)!;
    expect(midway.x).toBeGreaterThan(0);
    expect(midway.x).toBeLessThan(100);
    motion.sync([dot({ x: 200, y: 160 })], 100, false, pinned);
    expect(motion.position(1, 100)).toEqual(midway);
    motion.sync([dot({ x: 200, y: 160 })], 150, false, pinned);
    expect(motion.position(1, 100 + TASK_MOTION.travelMs)).toEqual({ x: 200, y: 160 });
  });

  it('Doneへの遷移だけで出荷し、到着後に光り、期限で消える', () => {
    const motion = new BoardTaskMotion();
    motion.sync([dot()], 0, false, pinned);
    const done = dot({ lane: 'done', x: 200, variant: 'gold' });
    motion.sync([done], 10, false, pinned);
    motion.sync([done], 20, false, pinned);
    expect(motion.bursts).toHaveLength(1);
    const burst = motion.bursts[0];
    expect(burst.gold).toBe(true);
    expect(shipmentParticle(burst, 0, 10).alpha).toBe(0);
    const lit = shipmentParticle(burst, 0, burst.startedAt + 100);
    expect(lit.alpha).toBeGreaterThan(0);
    expect(lit.x).toBeGreaterThan(200);
    motion.prune(burst.startedAt + TASK_MOTION.burstMs);
    expect(motion.bursts).toEqual([]);
  });

  it('復元・再出現を出荷と誤認せず、消えたタスクの座標も捨てる', () => {
    const motion = new BoardTaskMotion();
    motion.sync([dot({ lane: 'done' })], 0, false, pinned);
    expect(motion.bursts).toEqual([]);
    motion.sync([], 100, false, pinned);
    expect(motion.position(1, 100)).toBeUndefined();
    motion.sync([dot({ lane: 'done' })], 200, false, pinned);
    expect(motion.bursts).toEqual([]);
  });

  it('操作対象は即時配置し、reduced motion・静止画では補間も光粒も残さない', () => {
    const motion = new BoardTaskMotion();
    motion.sync([dot()], 0, false, pinned);
    motion.sync([dot({ x: 100 })], 10, false, new Set([1]));
    expect(motion.position(1, 10)?.x).toBe(100);
    motion.sync([dot({ x: 200, lane: 'done' })], 20, true, pinned);
    expect(motion.position(1, 20)?.x).toBe(200);
    expect(motion.bursts).toEqual([]);
    motion.sync([dot({ x: 300 })], 30, false, pinned);
    motion.settle();
    expect(motion.position(1, 30)?.x).toBe(300);
    motion.clear();
    expect(motion.position(1, 30)).toBeUndefined();
  });

  it('一斉出荷でも予算を超えず、停止用同期は既存の光粒も消す', () => {
    const motion = new BoardTaskMotion();
    const dots = Array.from({ length: 200 }, (_, id) => dot({ id }));
    motion.sync(dots, 0, false, pinned);
    expect(motion.position(BOARD_RENDER_BUDGETS.dots, 0)).toBeUndefined();
    motion.sync(
      dots.map((d) => ({ ...d, lane: 'done' })),
      10,
      false,
      pinned,
    );
    expect(motion.bursts).toHaveLength(BOARD_RENDER_BUDGETS.shipmentBursts);
    motion.sync(dots, 20, true, pinned);
    expect(motion.bursts).toEqual([]);
  });
});
