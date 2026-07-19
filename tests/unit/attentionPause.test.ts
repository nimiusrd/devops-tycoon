import { describe, expect, it } from 'vitest';
import {
  ATTENTION_COOLDOWN_MS,
  ATTENTION_PAUSE_MS,
  countIgniteEvents,
  hasNewIncidentTask,
  planAttentionPause,
} from '../../src/render/attentionPause';
import { REVIEW_HOT_QUEUE } from '../../src/render/boardScene';
import type { FireSprintEvent, Task } from '../../src/sim/types';

const task = (id: number, opts: { incident?: boolean; lane?: Task['lane'] } = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: opts.lane ?? (opts.incident ? 'rework' : 'dev'),
  progress: 0,
  reworkAttempts: 0,
  wasReworked: Boolean(opts.incident),
  incident: Boolean(opts.incident),
  debt: false,
});

const ignite = (tick: number, taskId: number): FireSprintEvent => ({
  tick,
  kind: 'ignite',
  taskId,
  source: 'review',
});

describe('planAttentionPause（RI-62③）', () => {
  it('尺とクールダウン定数を公開する', () => {
    expect(ATTENTION_PAUSE_MS).toBe(900);
    expect(ATTENTION_COOLDOWN_MS).toBe(2_500);
  });

  it('新規 Incident タスクで点火ポーズを計画する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [task(1), task(2)],
      nextTasks: [task(1, { incident: true }), task(2)],
      prevReviewQueueMax: 3,
      nextReviewQueueMax: 3,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 1,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'ignite',
      title: '点火!',
      meter: 'fire',
    });
  });

  it('件数据え置きでも別タスクの新規点火を検出する', () => {
    // 既存障害が同 tick で自動鎮火し、別タスクが点火 → 件数は変わらない。
    expect(hasNewIncidentTask([task(1, { incident: true })], [task(2, { incident: true })])).toBe(
      true,
    );
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [task(1, { incident: true }), task(2)],
      nextTasks: [task(1, { incident: false, lane: 'done' }), task(2, { incident: true })],
      prevReviewQueueMax: 0,
      nextReviewQueueMax: 0,
      prevIgniteEventCount: 1,
      nextIgniteEventCount: 2,
    });
    expect(plan.kind).toBe('ignite');
  });

  it('UI 同期前に鎮火しても ignite イベント増分で検出する', () => {
    const plan = planAttentionPause({
      isBoss: true,
      prevTasks: [task(1)],
      nextTasks: [task(1)],
      prevReviewQueueMax: 0,
      nextReviewQueueMax: 0,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 1,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'bossIncident',
      title: 'ボス障害発生!',
    });
  });

  it('ボス中の新規点火は bossIncident を優先する', () => {
    const plan = planAttentionPause({
      isBoss: true,
      prevTasks: [task(1)],
      nextTasks: [task(1, { incident: true })],
      prevReviewQueueMax: 0,
      nextReviewQueueMax: 0,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 1,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'bossIncident',
      title: 'ボス障害発生!',
      meter: 'fire',
    });
  });

  it('reviewQueueMax が HOT を越えた立ち上がりで jam ポーズを計画する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [],
      nextTasks: [],
      prevReviewQueueMax: REVIEW_HOT_QUEUE - 1,
      nextReviewQueueMax: REVIEW_HOT_QUEUE,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 0,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'reviewJam',
      title: 'Review渋滞!',
      meter: 'jam',
    });
  });

  it('最終キューが閾値未満でも tick 内ピーク（reviewQueueMax）で渋滞を検出する', () => {
    // advanceReview 後は 11 件に戻っても、処理前ピーク 12 は metrics に残る。
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [],
      nextTasks: [],
      prevReviewQueueMax: REVIEW_HOT_QUEUE - 1,
      nextReviewQueueMax: REVIEW_HOT_QUEUE,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 0,
    });
    expect(plan.active).toBe(true);
    expect(plan.kind).toBe('reviewJam');
  });

  it('既に HOT 到達済みなら再トリガーしない', () => {
    expect(
      planAttentionPause({
        isBoss: false,
        prevTasks: [],
        nextTasks: [],
        prevReviewQueueMax: REVIEW_HOT_QUEUE,
        nextReviewQueueMax: REVIEW_HOT_QUEUE + 2,
        prevIgniteEventCount: 0,
        nextIgniteEventCount: 0,
      }).active,
    ).toBe(false);
  });

  it('点火イベントも新規 Incident も無ければ点火しない', () => {
    expect(
      planAttentionPause({
        isBoss: false,
        prevTasks: [task(1, { incident: true })],
        nextTasks: [task(1, { incident: true })],
        prevReviewQueueMax: 2,
        nextReviewQueueMax: 2,
        prevIgniteEventCount: 1,
        nextIgniteEventCount: 1,
      }).active,
    ).toBe(false);
  });

  it('同フレームで点火と渋滞が重なると点火側を優先する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [task(1)],
      nextTasks: [task(1, { incident: true })],
      prevReviewQueueMax: REVIEW_HOT_QUEUE - 1,
      nextReviewQueueMax: REVIEW_HOT_QUEUE,
      prevIgniteEventCount: 0,
      nextIgniteEventCount: 1,
    });
    expect(plan.kind).toBe('ignite');
  });

  it('ボス最終鎮火スローモが立つフレームでは attention を出さない', () => {
    const plan = planAttentionPause({
      isBoss: true,
      prevTasks: [task(1, { incident: true })],
      nextTasks: [task(1, { incident: false, lane: 'done' })],
      prevReviewQueueMax: REVIEW_HOT_QUEUE - 1,
      nextReviewQueueMax: REVIEW_HOT_QUEUE,
      prevIgniteEventCount: 1,
      nextIgniteEventCount: 1,
    });
    expect(plan.active).toBe(false);
  });

  it('countIgniteEvents は ignite のみ数える', () => {
    expect(
      countIgniteEvents([
        ignite(1, 1),
        { tick: 2, kind: 'spread', fromTaskId: 1, toTaskId: 2 },
        ignite(3, 2),
      ]),
    ).toBe(2);
  });
});
