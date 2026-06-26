import { describe, expect, it } from 'vitest';
import { BOARD_VIEW, REVIEW_HOT_QUEUE, planBoardScene } from '../../src/render/boardScene';
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

  it('Rework は差し戻しがあると sad、Done は出荷があると cheer', () => {
    const scene = planBoardScene([...tasksIn('rework', 1), ...tasksIn('done', 1)]);
    expect(scene.stations.find((s) => s.lane === 'rework')!.mood).toBe('sad');
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

  it('上限超過は overflow に集約し、描く粒は cap 以内に収まる', () => {
    const scene = planBoardScene(tasksIn('review', 30));
    const drawn = scene.dots.filter((d) => d.lane === 'review').length;
    expect(drawn).toBeLessThanOrEqual(20);
    expect(scene.overflow.review).toBe(30 - drawn);
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
