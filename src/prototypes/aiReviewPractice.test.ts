import { describe, expect, it } from 'vitest';
import { createGame } from '../game';
import { defaultMeta } from '../state/meta';
import { MemoryMetaStorage } from '../state/metaPersistence';
import { MemoryRunStorage } from '../state/runPersistence';
import { AI_REVIEW_PRACTICE, AiReviewPractice, type AiReviewChoice } from './aiReviewPractice';

function observe(practice: AiReviewPractice) {
  const view = practice.view();
  if (view.phase === 'closed') throw new Error('練習は終了しました');
  return view;
}

function trial(seed: string, choice: AiReviewChoice) {
  const practice = new AiReviewPractice(seed);
  const { current: before } = observe(practice);
  expect(practice.choose(choice)).toBe(true);
  const { current: selected } = observe(practice);
  expect(selected.tick).toBe(before.tick);
  expect(selected.lanes).toEqual(before.lanes);
  expect(before.focus - selected.focus).toBe(3);
  while (observe(practice).current.tick < 10) expect(practice.step()).toBe(true);
  const { current: early } = observe(practice);
  while (practice.step()) {
    const { current } = observe(practice);
    expect(Object.values(current.lanes).reduce((count, n) => count + n, 0)).toBe(
      AI_REVIEW_PRACTICE.taskCount,
    );
  }
  const { phase, current, reviewTaskTicks, timedOut } = observe(practice);
  expect(phase).toBe('complete');
  expect(current.tick).toBeLessThanOrEqual(AI_REVIEW_PRACTICE.endTick);
  expect(current.focusSpent).toBe(AI_REVIEW_PRACTICE.focusMax);
  expect(practice.choose(choice)).toBe(false);
  practice.close();
  expect(practice.view()).toEqual({ phase: 'closed' });
  return {
    before,
    early: { coding: early.lanes.coding, review: early.lanes.review, passed: early.codingPassed },
    result: {
      tick: current.tick,
      delivered: current.delivered,
      reviewTaskTicks,
      incidents: current.incidentCount,
      timedOut,
    },
  };
}

describe('RI-276 AI 加速とレビュー整備の練習', () => {
  it.each([
    {
      seed: 'RI-276',
      accelerate: {
        early: { coding: 4, review: 15, passed: 20 },
        result: { tick: 60, delivered: 194, reviewTaskTicks: 535, incidents: 4, timedOut: true },
      },
      reinforceReview: {
        early: { coding: 5, review: 11, passed: 17 },
        result: { tick: 60, delivered: 223, reviewTaskTicks: 342, incidents: 6, timedOut: true },
      },
    },
    {
      seed: 'RI-276:1',
      accelerate: {
        early: { coding: 3, review: 11, passed: 18 },
        result: { tick: 38, delivered: 280, reviewTaskTicks: 235, incidents: 0, timedOut: false },
      },
      reinforceReview: {
        early: { coding: 5, review: 8, passed: 15 },
        result: { tick: 47, delivered: 227, reviewTaskTicks: 265, incidents: 2, timedOut: false },
      },
    },
    {
      seed: 'RI-276:2',
      accelerate: {
        early: { coding: 5, review: 11, passed: 17 },
        result: { tick: 60, delivered: 233, reviewTaskTicks: 382, incidents: 2, timedOut: true },
      },
      reinforceReview: {
        early: { coding: 2, review: 8, passed: 16 },
        result: { tick: 60, delivered: 238, reviewTaskTicks: 264, incidents: 2, timedOut: true },
      },
    },
  ])('$seed の共通開始盤面で2方針を再現する', ({ seed, accelerate, reinforceReview }) => {
    // レビュー整備から始められ、加速を先に試す必要がない。
    const reviewed = trial(seed, 'reinforceReview');
    const accelerated = trial(seed, 'accelerate');
    expect(reviewed.before).toEqual(accelerated.before);
    expect(reviewed).toMatchObject(reinforceReview);
    expect(accelerated).toMatchObject(accelerate);
    expect(trial(seed, 'accelerate')).toEqual(accelerated);
  });

  it('選択前・不正入力・二重選択では状態を変えず、退出から新規開始できる', () => {
    const practice = new AiReviewPractice();
    const ready = observe(practice);
    expect(ready.phase).toBe('ready');
    ready.before.lanes.coding = 999;
    expect(observe(practice).before.lanes.coding).toBe(4);
    expect(practice.step()).toBe(false);
    expect(practice.choose('unknown' as AiReviewChoice)).toBe(false);
    expect(observe(practice)).toEqual(new AiReviewPractice().view());
    expect(practice.choose('reinforceReview')).toBe(true);
    const running = observe(practice);
    expect(practice.choose('accelerate')).toBe(false);
    expect(observe(practice)).toEqual(running);
    practice.close();
    expect(practice.view()).toEqual({ phase: 'closed' });
    expect(practice.choose('accelerate')).toBe(false);
    expect(practice.step()).toBe(false);
    expect(new AiReviewPractice().view()).toMatchObject({ phase: 'ready', choice: null });
  });

  it('スキップと練習終了の後も既存セーブ・解放状態を維持して再開できる', async () => {
    const seed = 'existing-run';
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const meta = { ...defaultMeta(), points: 15 };
    await metaStorage.save(meta);
    const game = createGame({ seed, runStorage, initialMeta: meta, metaStorage, metaReady: true });
    game.attachRunPersistence(runStorage, null);
    game.startRun('easy', [], seed);
    const saved = await runStorage.load();
    expect(saved?.summary).toMatchObject({ phase: 'setup', seed });
    const before = game.engine.exportPersistState();

    const skipped = new AiReviewPractice();
    skipped.close();
    expect(skipped.view()).toEqual({ phase: 'closed' });
    trial(AI_REVIEW_PRACTICE.seed, 'reinforceReview');

    expect(game.engine.exportPersistState()).toEqual(before);
    expect(game.getMeta()).toEqual(meta);
    expect(await runStorage.load()).toEqual(saved);
    expect(await metaStorage.load()).toEqual(meta);
    const resumed = createGame({ runStorage, initialMeta: meta, metaStorage, metaReady: true });
    resumed.attachRunPersistence(runStorage, saved);
    expect(resumed.resumeRun()).toMatchObject({ phase: 'setup', seed });
  });
});
