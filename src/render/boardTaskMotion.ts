/** Pixi 専用の補間と出荷の光粒。sim を予測せず、受信済みの座標だけを結ぶ。 */
import type { BoardDotPlan } from './boardScene';
import { BOARD_RENDER_BUDGETS } from './boardRenderBudget';

// Canvas 内だけで使う装飾の時間・軌道。ヒット領域や DOM の寸法には使わない。
export const TASK_MOTION = { travelMs: 180, burstMs: 560, particlesPerBurst: 8 } as const;

interface Point {
  x: number;
  y: number;
}

interface Travel {
  dot: BoardDotPlan;
  from: Point;
  startedAt: number;
}

export interface ShipmentBurst extends Point {
  startedAt: number;
  gold: boolean;
}

export function shipmentParticle(burst: ShipmentBurst, index: number, now: number) {
  const progress = Math.max(0, Math.min(1, (now - burst.startedAt) / TASK_MOTION.burstMs));
  const angle = (index / TASK_MOTION.particlesPerBurst) * Math.PI * 2;
  const radius = (1 - (1 - progress) ** 3) * (burst.gold ? 46 : 32);
  return {
    x: burst.x + Math.cos(angle) * radius,
    y: burst.y + Math.sin(angle) * radius * 0.65 - progress * 12,
    alpha: now < burst.startedAt ? 0 : (1 - progress) ** 2,
    scale: (burst.gold ? 1.2 : 0.85) * (1 - progress * 0.7),
  };
}

/** 保持数は描画済みタスクと同時出荷の上限内。消えたタスクの履歴は持ち越さない。 */
export class BoardTaskMotion {
  private travels = new Map<number, Travel>();
  bursts: ShipmentBurst[] = [];

  position(id: number, now: number): Point | undefined {
    const travel = this.travels.get(id);
    if (!travel) return undefined;
    const t = Math.max(0, Math.min(1, (now - travel.startedAt) / TASK_MOTION.travelMs));
    const ease = 1 - (1 - t) ** 3;
    return {
      x: travel.from.x + (travel.dot.x - travel.from.x) * ease,
      y: travel.from.y + (travel.dot.y - travel.from.y) * ease,
    };
  }

  sync(
    dots: readonly BoardDotPlan[],
    now: number,
    immediate: boolean,
    pinned: ReadonlySet<number>,
  ) {
    this.prune(now);
    if (immediate) this.bursts = [];
    const next = new Map<number, Travel>();
    for (const dot of dots.slice(0, BOARD_RENDER_BUDGETS.dots)) {
      const previous = this.travels.get(dot.id);
      const snap = immediate || pinned.has(dot.id) || !previous;
      const changed = previous && (previous.dot.x !== dot.x || previous.dot.y !== dot.y);
      const from = snap ? dot : (this.position(dot.id, now) ?? dot);
      next.set(dot.id, {
        dot,
        from: snap || changed ? { x: from.x, y: from.y } : previous.from,
        startedAt: snap || changed ? now : previous.startedAt,
      });
      // 初回表示・復元・上限から再出現した Done は完了イベントと見なさない。
      if (!immediate && previous && previous.dot.lane !== 'done' && dot.lane === 'done') {
        this.bursts.push({
          x: dot.x,
          y: dot.y,
          startedAt: now + (snap ? 0 : TASK_MOTION.travelMs),
          gold: dot.variant === 'gold',
        });
      }
    }
    this.travels = next;
    this.bursts = this.bursts.slice(-BOARD_RENDER_BUDGETS.shipmentBursts);
  }

  prune(now: number) {
    this.bursts = this.bursts.filter((burst) => now < burst.startedAt + TASK_MOTION.burstMs);
  }

  settle() {
    for (const travel of this.travels.values()) travel.from = travel.dot;
    this.bursts = [];
  }

  clear() {
    this.travels.clear();
    this.bursts = [];
  }
}
