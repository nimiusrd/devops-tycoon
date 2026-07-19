import { describe, expect, it } from 'vitest';
import {
  ATTENTION_COOLDOWN_MS,
  ATTENTION_PAUSE_MS,
  planAttentionPause,
} from '../../src/render/attentionPause';
import { REVIEW_HOT_QUEUE } from '../../src/render/boardScene';
import type { Task } from '../../src/sim/types';

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

describe('planAttentionPause（RI-62③）', () => {
  it('尺とクールダウン定数を公開する', () => {
    expect(ATTENTION_PAUSE_MS).toBe(900);
    expect(ATTENTION_COOLDOWN_MS).toBe(2_500);
  });

  it('Incident 増加で点火ポーズを計画する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [task(1), task(2)],
      nextTasks: [task(1, { incident: true }), task(2)],
      prevQueue: 3,
      nextQueue: 3,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'ignite',
      title: '点火!',
      meter: 'fire',
    });
  });

  it('ボス中の Incident 増加は bossIncident を優先する', () => {
    const plan = planAttentionPause({
      isBoss: true,
      prevTasks: [task(1)],
      nextTasks: [task(1, { incident: true })],
      prevQueue: 0,
      nextQueue: 0,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'bossIncident',
      title: 'ボス障害発生!',
      meter: 'fire',
    });
  });

  it('Review 渋滞の立ち上がりエッジで jam ポーズを計画する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [],
      nextTasks: [],
      prevQueue: REVIEW_HOT_QUEUE - 1,
      nextQueue: REVIEW_HOT_QUEUE,
    });
    expect(plan).toMatchObject({
      active: true,
      kind: 'reviewJam',
      title: 'Review渋滞!',
      meter: 'jam',
    });
  });

  it('既に渋滞中のままでは再トリガーしない', () => {
    expect(
      planAttentionPause({
        isBoss: false,
        prevTasks: [],
        nextTasks: [],
        prevQueue: REVIEW_HOT_QUEUE,
        nextQueue: REVIEW_HOT_QUEUE + 2,
      }).active,
    ).toBe(false);
  });

  it('Incident 数が増えなければ点火しない', () => {
    expect(
      planAttentionPause({
        isBoss: false,
        prevTasks: [task(1, { incident: true })],
        nextTasks: [task(1, { incident: true })],
        prevQueue: 2,
        nextQueue: 2,
      }).active,
    ).toBe(false);
  });

  it('同フレームで点火と渋滞が重なると点火側を優先する', () => {
    const plan = planAttentionPause({
      isBoss: false,
      prevTasks: [task(1)],
      nextTasks: [task(1, { incident: true })],
      prevQueue: REVIEW_HOT_QUEUE - 1,
      nextQueue: REVIEW_HOT_QUEUE,
    });
    expect(plan.kind).toBe('ignite');
  });

  it('ボス最終鎮火スローモが立つフレームでは attention を出さない', () => {
    const plan = planAttentionPause({
      isBoss: true,
      prevTasks: [task(1, { incident: true })],
      nextTasks: [task(1, { incident: false, lane: 'done' })],
      prevQueue: REVIEW_HOT_QUEUE - 1,
      nextQueue: REVIEW_HOT_QUEUE,
    });
    expect(plan.active).toBe(false);
  });
});
