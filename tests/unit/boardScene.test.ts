import { describe, expect, it } from 'vitest';
import {
  BOARD_VIEW,
  REVIEW_HEAT_START,
  REVIEW_HOT_QUEUE,
  planBoardScene,
  reviewHeat,
} from '../../src/render/boardScene';
import { BURN_TICKS } from '../../src/sim/model';
import type { Lane, Task } from '../../src/sim/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'coding',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

/** lane に n 件のタスクを作る（id 連番）。 */
function tasksIn(lane: Lane, n: number, overrides: Partial<Task> = {}): Task[] {
  return Array.from({ length: n }, (_, i) => task({ id: i + 1, lane, ...overrides }));
}

describe('planBoardScene（盤面シーン計画）', () => {
  it('5 工程のステーションを常に描く（count 0 でも存在）', () => {
    const scene = planBoardScene([]);
    expect(scene.stations.map((s) => s.lane)).toEqual([
      'backlog',
      'coding',
      'review',
      'rework',
      'done',
    ]);
    for (const s of scene.stations) {
      expect(s.count).toBe(0);
      expect(s.mood).toBe('neutral');
    }
  });

  it('設計座標空間を mockup と同じ 1404×573 で返す', () => {
    const scene = planBoardScene([]);
    expect(scene.view).toEqual({ w: BOARD_VIEW.w, h: BOARD_VIEW.h });
  });

  it('レーンごとに件数を集計する', () => {
    const scene = planBoardScene([
      ...tasksIn('backlog', 3),
      ...tasksIn('review', 5),
      ...tasksIn('done', 2),
    ]);
    const count = (lane: Lane) => scene.stations.find((s) => s.lane === lane)!.count;
    expect(count('backlog')).toBe(3);
    expect(count('review')).toBe(5);
    expect(count('done')).toBe(2);
    expect(count('coding')).toBe(0);
  });

  it('Review が閾値以上で hot＋パニック表情＋吹き出しになる', () => {
    const calm = planBoardScene(tasksIn('review', REVIEW_HOT_QUEUE - 1));
    const review = (s: ReturnType<typeof planBoardScene>) =>
      s.stations.find((x) => x.lane === 'review')!;
    expect(review(calm).hot).toBe(false);
    expect(review(calm).mood).toBe('tired');

    const hell = planBoardScene(tasksIn('review', REVIEW_HOT_QUEUE));
    expect(review(hell).hot).toBe(true);
    expect(review(hell).mood).toBe('panic');
    expect(review(hell).bubble).toBe('レビュー終わらん…');
  });

  it('Coding は AI タスクがあると happy／吹き出しを出す', () => {
    const plain = planBoardScene(tasksIn('coding', 2));
    const ai = planBoardScene(tasksIn('coding', 2, { aiAssisted: true }));
    const coding = (s: ReturnType<typeof planBoardScene>) =>
      s.stations.find((x) => x.lane === 'coding')!;
    expect(coding(plain).mood).toBe('neutral');
    expect(coding(ai).mood).toBe('happy');
    expect(coding(ai).bubble).toBe('AIサイコー！');
  });

  it('Rework は差し戻しがあると sad、炎上中は panic', () => {
    const sad = planBoardScene(tasksIn('rework', 1));
    expect(sad.stations.find((s) => s.lane === 'rework')!.mood).toBe('sad');

    const panic = planBoardScene(tasksIn('rework', 1, { incident: true, burnTicksLeft: 10 }));
    const rework = panic.stations.find((s) => s.lane === 'rework')!;
    expect(rework.mood).toBe('panic');
    expect(rework.bubble).toBe('燃えてる！');
  });

  it('Done は出荷があると cheer', () => {
    const scene = planBoardScene(tasksIn('done', 1));
    expect(scene.stations.find((s) => s.lane === 'done')!.mood).toBe('cheer');
  });

  it('Backlog は山積みのとき tired／吹き出しを出す', () => {
    expect(planBoardScene(tasksIn('backlog', 3)).stations[0].mood).toBe('neutral');
    expect(planBoardScene(tasksIn('backlog', 8)).stations[0].mood).toBe('tired');
    expect(planBoardScene(tasksIn('backlog', 8)).stations[0].bubble).toBe('山積みだ…');
  });

  it('粒の配置は決定論（同一入力＝同一座標）', () => {
    const tasks = tasksIn('review', 8);
    const a = planBoardScene(tasks).dots;
    const b = planBoardScene(tasks).dots;
    expect(a).toEqual(b);
  });

  it('粒は工程内で必ず一意の id を持つ（描画キー衝突なし）', () => {
    const scene = planBoardScene([...tasksIn('review', 5), ...tasksIn('done', 5)]);
    const keys = scene.dots.map((d) => `${d.lane}-${d.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('上限超過はステーションの overflow に集約し、描く粒は cap 以内に収まる', () => {
    const scene = planBoardScene(tasksIn('review', 30));
    const drawn = scene.dots.filter((d) => d.lane === 'review').length;
    const review = scene.stations.find((s) => s.lane === 'review')!;
    expect(drawn).toBeLessThanOrEqual(20);
    expect(review.overflow).toBe(30 - drawn);
  });

  it('上限内なら overflow は 0（+N を出さない）', () => {
    const scene = planBoardScene(tasksIn('done', 5));
    expect(scene.stations.find((s) => s.lane === 'done')!.overflow).toBe(0);
  });

  it('overflow バッジ位置は山の頂点付近（ラベルと衝突しない高さ）', () => {
    const scene = planBoardScene(tasksIn('review', 30));
    const review = scene.stations.find((s) => s.lane === 'review')!;
    // 山は上へ伸びるので、頂点バッジは pile より上（labelY 付近より下）に出る。
    expect(review.overflowY).toBeLessThan(review.y);
  });

  it('炎上タスクは fire を立て、最後（最上段）に積む', () => {
    const scene = planBoardScene([
      ...tasksIn('review', 3),
      task({ id: 99, lane: 'review', incident: true }),
    ]);
    const reviewDots = scene.dots.filter((d) => d.lane === 'review');
    const fire = reviewDots.find((d) => d.fire);
    expect(fire).toBeDefined();
    expect(fire!.id).toBe(99);
    // incident は手前（配列末尾）に来る。
    expect(reviewDots[reviewDots.length - 1].id).toBe(99);
  });

  it('上限超過レーンでも炎上タスクは必ず描く（cap で切り捨てない）', () => {
    // Rework は cap 12。通常 20 件＋炎上 1 件 → 通常が前に並んでも炎上は残す。
    const scene = planBoardScene([
      ...tasksIn('rework', 20),
      task({ id: 777, lane: 'rework', incident: true }),
    ]);
    const reworkDots = scene.dots.filter((d) => d.lane === 'rework');
    expect(reworkDots.length).toBeLessThanOrEqual(12);
    expect(reworkDots.some((d) => d.fire && d.id === 777)).toBe(true);
    // 炎上は最上段（末尾）に積む。
    expect(reworkDots[reworkDots.length - 1].id).toBe(777);
    // 隠れたのは通常タスクのみ（21 件中 12 件表示 → 9 件超過）。
    expect(scene.stations.find((s) => s.lane === 'rework')!.overflow).toBe(9);
  });

  it('炎上タスクは burnUrgency を付与する（RI-06）', () => {
    const scene = planBoardScene([
      task({ id: 1, lane: 'rework', incident: true, burnTicksLeft: BURN_TICKS / 2 }),
    ]);
    const dot = scene.dots.find((d) => d.id === 1);
    expect(dot?.burnUrgency).toBeCloseTo(0.5);
  });

  it('粒の中心は設計空間の内側に収まる', () => {
    const scene = planBoardScene([
      ...tasksIn('backlog', 6),
      ...tasksIn('review', 18),
      ...tasksIn('done', 10),
    ]);
    for (const d of scene.dots) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(BOARD_VIEW.w);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(BOARD_VIEW.h);
    }
  });

  it('フローは Coding→Review と差し戻し（Review→Rework）を含む', () => {
    const { flows } = planBoardScene([]);
    expect(flows.some((f) => f.from === 'coding' && f.to === 'review')).toBe(true);
    expect(flows.some((f) => f.from === 'review' && f.to === 'rework' && f.rework)).toBe(true);
  });
});

describe('reviewHeat（渋滞の段階強度・hot 手前の早期警告）', () => {
  it('起点以下は 0、hot 閾値以上は 1', () => {
    expect(reviewHeat(0)).toBe(0);
    expect(reviewHeat(REVIEW_HEAT_START)).toBe(0);
    expect(reviewHeat(REVIEW_HOT_QUEUE)).toBe(1);
    expect(reviewHeat(REVIEW_HOT_QUEUE + 5)).toBe(1);
  });

  it('起点〜hot の間は単調増加（8〜11 件で徐々に赤くなる）', () => {
    const mid = reviewHeat(8);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(reviewHeat(11)).toBeGreaterThan(reviewHeat(9));
    expect(reviewHeat(9)).toBeGreaterThan(reviewHeat(7));
  });

  it('ステーションの heat は Review のみ非ゼロ', () => {
    const scene = planBoardScene([...tasksIn('review', 9), ...tasksIn('coding', 9)]);
    const review = scene.stations.find((s) => s.lane === 'review')!;
    const coding = scene.stations.find((s) => s.lane === 'coding')!;
    expect(review.heat).toBeGreaterThan(0);
    expect(review.heat).toBeLessThan(1);
    expect(coding.heat).toBe(0);
  });

  it('hot 到達時は heat が 1（最大）', () => {
    const scene = planBoardScene(tasksIn('review', REVIEW_HOT_QUEUE));
    expect(scene.stations.find((s) => s.lane === 'review')!.heat).toBe(1);
  });
});
