import { describe, expect, it } from 'vitest';
import { REVIEW_HOT_QUEUE, planBoardScene } from '../../../src/render/boardScene';
import { hitTestDropLane } from '../../../src/render/boardDragPlan';
import {
  RD_FIRE_TASK_ID,
  RD_SPREAD_TARGET_TASK_ID,
  createRdStressOverlay,
  createRdStressTasks,
  hitTestRdBoardDot,
  planRdHitAreas,
  planRdSignalMarkers,
  planRdSpreadLink,
  rdHitAreasOverlap,
  resolveRdStressView,
} from '../../../src/render/rdBoardPrototype';

describe('rdBoardPrototype（固定場面とヒット）', () => {
  it('同一タスク列に炎上・渋滞・延焼が同時にある', () => {
    const overlay = createRdStressOverlay();
    const review = overlay.tasks.filter((task) => task.lane === 'review');
    const fire = overlay.tasks.find((task) => task.id === RD_FIRE_TASK_ID);
    const spread = overlay.tasks.find((task) => task.id === RD_SPREAD_TARGET_TASK_ID);

    expect(review.length).toBe(REVIEW_HOT_QUEUE);
    expect(fire?.incident).toBe(true);
    expect(fire?.lane).toBe('rework');
    expect(spread?.incident).toBe(true);
    expect(spread?.lane).toBe('review');
    expect(overlay.metrics.spread).toBe(1);
    expect(overlay.events.some((event) => event.kind === 'spread')).toBe(true);
  });

  it('iso / lane で同じタスク列を計画でき、信号ラベルが揃う', () => {
    const tasks = createRdStressTasks();
    const iso = planBoardScene(tasks, undefined, 'iso');
    const lane = planBoardScene(tasks, undefined, 'lane');

    expect(iso.layout).toBe('iso');
    expect(lane.layout).toBe('lane');
    expect(planRdSignalMarkers(iso).map((marker) => marker.id)).toEqual([
      'fire',
      'congestion',
      'spread',
    ]);
    expect(planRdSignalMarkers(lane).map((marker) => marker.id)).toEqual([
      'fire',
      'congestion',
      'spread',
    ]);
    expect(planRdSpreadLink(iso)).not.toBeNull();
    expect(planRdSpreadLink(lane)).not.toBeNull();
  });

  it('レーン盤面では粒のヒット円が重ならない（iso の山は重なり得る）', () => {
    const tasks = createRdStressTasks();
    const isoHits = planRdHitAreas(planBoardScene(tasks, undefined, 'iso').dots);
    const laneHits = planRdHitAreas(planBoardScene(tasks, undefined, 'lane').dots);

    expect(rdHitAreasOverlap(isoHits)).toBe(true);
    expect(rdHitAreasOverlap(laneHits)).toBe(false);
  });

  it('粒中心のヒット判定はレイアウトが変わっても同じ ID を返す', () => {
    const tasks = createRdStressTasks();
    const isoDot = planBoardScene(tasks, undefined, 'iso').dots.find(
      (dot) => dot.id === RD_FIRE_TASK_ID,
    )!;
    const laneDot = planBoardScene(tasks, undefined, 'lane').dots.find(
      (dot) => dot.id === RD_FIRE_TASK_ID,
    )!;

    expect(hitTestRdBoardDot(isoDot, planBoardScene(tasks, undefined, 'iso').dots)).toBe(
      RD_FIRE_TASK_ID,
    );
    expect(hitTestRdBoardDot(laneDot, planBoardScene(tasks, undefined, 'lane').dots)).toBe(
      RD_FIRE_TASK_ID,
    );
  });

  it('ドロップ円はレイアウトに追従する', () => {
    expect(hitTestDropLane(620, 260, ['coding'], 'iso')).toBe('coding');
    expect(hitTestDropLane(150, 166, ['coding'], 'lane')).toBe('coding');
    expect(hitTestDropLane(150, 166, ['coding'], 'iso')).toBeNull();
  });

  it('固定場面は sim を書き換えず、同じタスク列を iso/lane に載せられる', () => {
    const overlay = createRdStressOverlay();
    const iso = planBoardScene(overlay.tasks, undefined, 'iso');
    const lane = planBoardScene(overlay.tasks, undefined, 'lane');
    expect(iso.dots.some((dot) => dot.id === RD_FIRE_TASK_ID && dot.fire)).toBe(true);
    expect(lane.dots.some((dot) => dot.id === RD_SPREAD_TARGET_TASK_ID && dot.fire)).toBe(true);
    expect(overlay.metrics.spread).toBe(1);
  });

  it('既定の location では固定場面を載せない', () => {
    expect(resolveRdStressView()).toBeNull();
  });
});
