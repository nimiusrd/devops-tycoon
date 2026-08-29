import { describe, expect, it } from 'vitest';
import {
  BOARD_VIEW,
  findBoardFlow,
  flowPointAt,
  REVIEW_TRAIL_BUDGET,
  REVIEW_HEAT_START,
  REVIEW_HOT_QUEUE,
  planBoardScene,
  reviewHeat,
} from '../../../src/render/boardScene';
import { BURN_TICKS } from '../../../src/sim/model';
import type { Lane, Task } from '../../../src/sim/types';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

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

  it('設計座標空間を 1404×573 の固定値で返す', () => {
    const scene = planBoardScene([]);
    expect(scene.view).toEqual({ w: BOARD_VIEW.w, h: BOARD_VIEW.h });
  });

  it('Backlog・Coding・Review は人物幅以上の水平間隔を保つ', () => {
    const stations = planBoardScene([]).stations;
    const station = (lane: Lane) => stations.find((candidate) => candidate.lane === lane)!;
    const actorWidth = (BOARD_VIEW.w * VISUAL_TOKENS.dimensions.sprint.stationWidthPercent) / 100;

    expect(station('coding').x - station('backlog').x).toBeGreaterThan(actorWidth);
    expect(station('review').x - station('coding').x).toBeGreaterThan(actorWidth);
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

  it('moodOverrides はメンバー由来の表情で上書きし、変化時は吹き出しを落とす（RI-08）', () => {
    const ai = tasksIn('coding', 2, { aiAssisted: true });
    const coding = (s: ReturnType<typeof planBoardScene>) =>
      s.stations.find((x) => x.lane === 'coding')!;

    // happy（AIサイコー！）→ exhausted 上書き。文脈が合わない吹き出しは出さない。
    const overridden = planBoardScene(ai, { coding: 'exhausted' });
    expect(coding(overridden).mood).toBe('exhausted');
    expect(coding(overridden).bubble).toBeNull();

    // 同じ表情への上書きは吹き出しを保つ。
    const same = planBoardScene(ai, { coding: 'happy' });
    expect(coding(same).bubble).toBe('AIサイコー！');
  });

  it('moodOverrides でも panic（渋滞・炎上）は勝つ', () => {
    const panic = planBoardScene(tasksIn('rework', 1, { incident: true, burnTicksLeft: 10 }), {
      rework: 'cheer',
    });
    const rework = panic.stations.find((s) => s.lane === 'rework')!;
    expect(rework.mood).toBe('panic');
    expect(rework.bubble).toBe('燃えてる！');
  });

  it('moodOverrides 省略時は従来どおり（後方互換）', () => {
    const a = planBoardScene(tasksIn('done', 1));
    const b = planBoardScene(tasksIn('done', 1), undefined);
    expect(a.stations).toEqual(b.stations);
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

  it('heat が正の間だけReview局所ヒートを計画し、Hell状態を引き継ぐ', () => {
    expect(planBoardScene(tasksIn('review', REVIEW_HEAT_START)).reviewEffects.heatField).toBeNull();

    const congested = planBoardScene(tasksIn('review', 8)).reviewEffects.heatField;
    expect(congested).toMatchObject({ intensity: reviewHeat(8), hell: false });
    expect(congested?.x).toBeGreaterThan(0);
    expect(congested?.radiusX).toBeGreaterThan(congested?.radiusY ?? 0);

    expect(
      planBoardScene(tasksIn('review', REVIEW_HOT_QUEUE)).reviewEffects.heatField,
    ).toMatchObject({ intensity: 1, hell: true });
  });
});

describe('Review流入軌跡（RI-141）', () => {
  it('Coding/Rework→Reviewだけを方向・進捗・AI速度つきで計画する', () => {
    const scene = planBoardScene([
      task({ id: 1, lane: 'coding', progress: 0.4 }),
      task({ id: 2, lane: 'coding', progress: 0.7, aiAssisted: true }),
      task({ id: 3, lane: 'rework', progress: 0.5 }),
      task({ id: 4, lane: 'review', progress: 0 }),
    ]);

    expect(scene.reviewEffects.trails.map((trail) => trail.taskId)).toEqual([2, 3, 1]);
    expect(scene.reviewEffects.trails[0]).toMatchObject({
      progress: 0.7,
      speedMul: 1.35,
      tone: 'ai',
    });
    expect(scene.reviewEffects.trails[1]).toMatchObject({ tone: 'rework' });
    expect(scene.reviewEffects.trails[2]).toMatchObject({ tone: 'normal' });
    expect(scene.reviewEffects.trails.every((trail) => Number.isFinite(trail.angleDeg))).toBe(true);
  });

  it('上限到達時はReview到着に近い粒を決定論的に残す', () => {
    const tasks = Array.from({ length: REVIEW_TRAIL_BUDGET + 6 }, (_, index) =>
      task({
        id: index + 1,
        lane: index % 2 === 0 ? 'coding' : 'rework',
        progress: (index + 1) / (REVIEW_TRAIL_BUDGET + 7),
      }),
    );
    const trails = planBoardScene(tasks).reviewEffects.trails;
    expect(trails).toHaveLength(REVIEW_TRAIL_BUDGET);
    expect(trails[0].taskId).toBe(REVIEW_TRAIL_BUDGET + 6);
    expect(trails.at(-1)?.taskId).toBe(7);
    expect(planBoardScene(tasks).reviewEffects.trails).toEqual(trails);
  });
});

describe('flowPointAt / 工程間フロー補間（RI-05）', () => {
  const codingFlow = findBoardFlow('coding', 'review')!;

  it('t=0 は始点、t=1 は終点に一致する', () => {
    expect(flowPointAt(codingFlow, 0)).toMatchObject({ x: codingFlow.x1, y: codingFlow.y1 });
    expect(flowPointAt(codingFlow, 1)).toMatchObject({ x: codingFlow.x2, y: codingFlow.y2 });
  });

  it('t=0.5 は始点と終点の中間付近になる', () => {
    const mid = flowPointAt(codingFlow, 0.5);
    expect(mid.x).toBeCloseTo((codingFlow.x1 + codingFlow.x2) / 2, 5);
    expect(mid.y).toBeCloseTo((codingFlow.y1 + codingFlow.y2) / 2, 5);
  });
});

describe('planBoardScene 流動粒（RI-05）', () => {
  it('Coding progress>0 の粒はフロー上に motion 付きで配置する', () => {
    const scene = planBoardScene([task({ id: 1, lane: 'coding', progress: 0.6 })]);
    const dot = scene.dots.find((d) => d.id === 1)!;
    const expected = flowPointAt(findBoardFlow('coding', 'review')!, 0.6);
    expect(dot.motion).toMatchObject({ kind: 'flow', from: 'coding', to: 'review', t: 0.6 });
    expect(dot.x).toBeCloseTo(expected.x, 5);
    expect(dot.y).toBeCloseTo(expected.y, 5);
  });

  it('Coding progress=0 の粒は従来どおり山（pile）に積む', () => {
    const scene = planBoardScene([task({ id: 2, lane: 'coding', progress: 0 })]);
    const dot = scene.dots.find((d) => d.id === 2)!;
    expect(dot.motion).toBeUndefined();
    expect(dot.x).toBeGreaterThan(600);
    expect(dot.y).toBeGreaterThan(200);
  });

  it('Rework progress>0 かつ非炎上は rework→review フロー上へ流す', () => {
    const scene = planBoardScene([task({ id: 3, lane: 'rework', progress: 0.4 })]);
    const dot = scene.dots.find((d) => d.id === 3)!;
    const expected = flowPointAt(findBoardFlow('rework', 'review')!, 0.4);
    expect(dot.motion?.from).toBe('rework');
    expect(dot.motion?.to).toBe('review');
    expect(dot.x).toBeCloseTo(expected.x, 5);
    expect(dot.y).toBeCloseTo(expected.y, 5);
  });

  it('炎上中の Rework は progress>0 でも山に残す（手戻り不能）', () => {
    const scene = planBoardScene([task({ id: 4, lane: 'rework', progress: 0.5, incident: true })]);
    const dot = scene.dots.find((d) => d.id === 4)!;
    expect(dot.motion).toBeUndefined();
    expect(dot.fire).toBe(true);
  });

  it('山とフロー粒が同一レーンで共存する', () => {
    const scene = planBoardScene([
      task({ id: 10, lane: 'coding', progress: 0 }),
      task({ id: 11, lane: 'coding', progress: 0.7, aiAssisted: true }),
    ]);
    const codingDots = scene.dots.filter((d) => d.lane === 'coding');
    expect(codingDots).toHaveLength(2);
    expect(codingDots.find((d) => d.id === 10)!.motion).toBeUndefined();
    expect(codingDots.find((d) => d.id === 11)!.motion?.kind).toBe('flow');
    expect(codingDots.find((d) => d.id === 11)!.motion?.speedMul).toBe(1.35);
  });

  it('流動粒の配置は決定論（同一入力＝同一座標）', () => {
    const tasks = [task({ id: 5, lane: 'coding', progress: 0.33 })];
    const a = planBoardScene(tasks).dots;
    const b = planBoardScene(tasks).dots;
    expect(a).toEqual(b);
  });

  it('流動粒だけのレーンでは overflow を出さない', () => {
    const scene = planBoardScene([task({ id: 1, lane: 'coding', progress: 0.5 })]);
    expect(scene.stations.find((s) => s.lane === 'coding')!.overflow).toBe(0);
  });

  it('同一 progress の流動粒は垂直オフセットで重ならない', () => {
    const scene = planBoardScene([
      task({ id: 1, lane: 'coding', progress: 0.5 }),
      task({ id: 2, lane: 'coding', progress: 0.5 }),
    ]);
    const dots = scene.dots.filter((d) => d.lane === 'coding');
    expect(dots).toHaveLength(2);
    expect(dots[0].x).not.toBe(dots[1].x);
    expect(dots[0].y).not.toBe(dots[1].y);
  });
});
