import { describe, expect, it } from 'vitest';
import { formatRecentSprintEvents, formatSprintEvent } from '../../../src/render/sprintEventView';
import { applyAction } from '../../../src/sim/actions';
import { INCIDENT_CONTAIN_HP } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import {
  createSprint,
  resolveSprintConfig,
  reviewOne,
  stepSprint,
  summarizeSprint,
} from '../../../src/sim/sprint';
import { SPRINT_EVENT_LIMIT, appendSprintEvent } from '../../../src/sim/sprintEvents';
import type { SprintEvent } from '../../../src/sim/types';
import { burningTask, makeSprint, makeTask } from '../helpers/sprintFixtures';

describe('sprintEventView（RI-52）', () => {
  it('割り込みレビュー介入を文言化する', () => {
    const event: SprintEvent = {
      tick: 10,
      kind: 'intervention',
      combo: 2,
      effect: {
        actionId: 'interruptReview',
        focusCost: 3,
        gaugeGain: 0.34,
        reviewedCount: 4,
        affectedTaskIds: [0, 1, 2, 3],
        hpCost: 3,
      },
    };
    const view = formatSprintEvent(event);
    expect(view.icon).toBe('🛂');
    expect(view.text).toContain('割り込みレビュー');
    expect(view.text).toContain('PR4件処理');
    expect(view.text).toContain('シニアHP -3');
  });

  it('鎮火成功とコンボ途切れを文言化する', () => {
    expect(formatSprintEvent({ tick: 5, kind: 'contain', taskId: 1, combo: 4 }).text).toBe(
      '鎮火成功 → コンボ x4 継続',
    );
    expect(
      formatSprintEvent({
        tick: 5,
        kind: 'contain',
        taskId: 1,
        combo: 0,
        brokeCombo: true,
      }).text,
    ).toBe('先消し鎮火 → コンボ切断');
    expect(
      formatSprintEvent({ tick: 6, kind: 'combo-break', reason: 'rework', taskId: 2 }).text,
    ).toBe('コンボ途切れ: 手戻り発生');
    expect(
      formatSprintEvent({
        tick: 6,
        kind: 'combo-break',
        reason: 'light-firefight',
        taskId: 2,
      }).text,
    ).toBe('コンボ途切れ: 余裕のある先消し');
    expect(
      formatSprintEvent({
        tick: 7,
        kind: 'spread',
        taskId: 1,
        spreadToTaskId: 3,
      }).text,
    ).toBe('延焼! 隣の Review 待ち PR に連鎖');
    expect(formatSprintEvent({ tick: 8, kind: 'ignite', taskId: 0, source: 'review' }).text).toBe(
      '点火! Review 落ち PR が炎上',
    );
    expect(formatSprintEvent({ tick: 9, kind: 'ignite', taskId: 1, source: 'spread' }).text).toBe(
      '点火! 延焼で隣の PR が炎上',
    );
  });

  it('直近 N 件を新しい順で返す', () => {
    const events: SprintEvent[] = [
      { tick: 1, kind: 'ignite', taskId: 0, source: 'review' },
      { tick: 2, kind: 'combo-break', reason: 'rework', taskId: 1 },
      { tick: 3, kind: 'contain', taskId: 2, combo: 1 },
    ];
    const rows = formatRecentSprintEvents(events, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toContain('鎮火成功');
    expect(rows[1].text).toContain('コンボ途切れ');
  });
});

describe('SprintState.events 記録（RI-52）', () => {
  it('createSprint は空の events / interventionEvents / fireEvents で始まる', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    expect(sprint.events).toEqual([]);
    expect(sprint.interventionEvents).toEqual([]);
    expect(sprint.fireEvents).toEqual([]);
  });

  it('介入成功で intervention イベントを記録する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), makeTask(1), makeTask(2), makeTask(3)]);
    const outcome = applyAction('interruptReview', sprint, org, () => 0.99, 12);
    expect(outcome.ok).toBe(true);
    const intervention = sprint.events.find((e) => e.kind === 'intervention');
    expect(intervention).toMatchObject({
      tick: 12,
      kind: 'intervention',
      effect: { actionId: 'interruptReview' },
    });
  });

  it('緊急対応で contain + intervention を記録する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0, 2)]);
    sprint.metrics.combo = 4;
    const outcome = applyAction('firefight', sprint, org, () => 0.5, 20);
    expect(outcome.ok).toBe(true);
    expect(sprint.events.some((e) => e.kind === 'contain' && e.combo === 4)).toBe(true);
    expect(sprint.events.some((e) => e.kind === 'intervention')).toBe(true);
  });

  it('手戻りで combo-break を記録する', () => {
    // 1 回目の乱数（incident）は外し、2 回目（rework）に当てる。
    const values = [0.99, 0];
    let i = 0;
    const rng = () => values[Math.min(i++, values.length - 1)];
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.metrics.combo = 3;
    reviewOne(sprint.tasks[0], sprint, org, rng, 8);
    expect(sprint.tasks[0].lane).toBe('rework');
    expect(sprint.events).toContainEqual({
      tick: 8,
      kind: 'combo-break',
      reason: 'rework',
      taskId: 0,
    });
  });

  it('自動鎮火で auto-contain と combo-break を記録する', () => {
    const org = createOrgState('default', true);
    org.seniorHp = INCIDENT_CONTAIN_HP;
    const sprint = makeSprint(org, [burningTask(0, 1)]);
    sprint.metrics.combo = 2;
    stepSprint(sprint, org, () => 0.5, 1);
    expect(sprint.events.some((e) => e.kind === 'auto-contain')).toBe(true);
    expect(sprint.events.some((e) => e.kind === 'combo-break' && e.reason === 'auto-contain')).toBe(
      true,
    );
    expect(sprint.metrics.contained).toBe(1);
    expect(sprint.metrics.autoContainCount).toBe(1);
  });

  it('ring buffer は上限を超えない', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (let i = 0; i < SPRINT_EVENT_LIMIT + 10; i += 1) {
      appendSprintEvent(sprint, { tick: i, kind: 'ignite', taskId: i, source: 'review' });
    }
    expect(sprint.events).toHaveLength(SPRINT_EVENT_LIMIT);
    expect(sprint.events[0].tick).toBe(10);
  });

  it('ring buffer 超過でも interventionEvents は全件保持する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    const intervention: SprintEvent = {
      tick: 1,
      kind: 'intervention',
      combo: 0,
      effect: {
        actionId: 'interruptReview',
        focusCost: 3,
        gaugeGain: 0.34,
        reviewedCount: 4,
      },
    };
    appendSprintEvent(sprint, intervention);
    for (let i = 0; i < SPRINT_EVENT_LIMIT + 20; i += 1) {
      appendSprintEvent(sprint, { tick: i + 10, kind: 'ignite', taskId: i, source: 'review' });
    }
    expect(sprint.events).toHaveLength(SPRINT_EVENT_LIMIT);
    expect(sprint.interventionEvents).toHaveLength(1);
    expect(sprint.interventionEvents[0].tick).toBe(1);
  });

  it('ring buffer 超過でも fireEvents は全件保持する（RI-34′）', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    const total = SPRINT_EVENT_LIMIT + 20;
    for (let i = 0; i < total; i += 1) {
      appendSprintEvent(sprint, { tick: i, kind: 'ignite', taskId: i, source: 'review' });
    }
    expect(sprint.events).toHaveLength(SPRINT_EVENT_LIMIT);
    expect(sprint.fireEvents).toHaveLength(total);
    expect(sprint.fireEvents[0].tick).toBe(0);
    expect(sprint.fireEvents[total - 1].tick).toBe(total - 1);
    const result = summarizeSprint(sprint, org);
    expect(result.fireEvents).toHaveLength(total);
    expect(result.fireEvents).not.toBe(sprint.fireEvents);
  });

  it('ring buffer 超過でも autoContainCount は metrics で保持する', () => {
    const org = createOrgState('default', true);
    org.seniorHp = INCIDENT_CONTAIN_HP * 3;
    const sprint = makeSprint(org, [burningTask(0, 1), burningTask(1, 1), burningTask(2, 1)]);
    stepSprint(sprint, org, () => 0.5, 1);
    expect(sprint.metrics.autoContainCount).toBe(3);
    // ティッカー用 ring buffer を溢れさせ、古い auto-contain を落とす。
    for (let i = 0; i < SPRINT_EVENT_LIMIT + 5; i += 1) {
      appendSprintEvent(sprint, {
        tick: i + 100,
        kind: 'ignite',
        taskId: i + 100,
        source: 'review',
      });
    }
    expect(sprint.events.some((e) => e.kind === 'auto-contain')).toBe(false);
    // fireEvents には auto-contain が残る（RI-34′）。
    expect(sprint.fireEvents.filter((e) => e.kind === 'auto-contain')).toHaveLength(3);
    const result = summarizeSprint(sprint, org);
    expect(result.autoContainCount).toBe(3);
    expect(result.fireEvents.filter((e) => e.kind === 'auto-contain')).toHaveLength(3);
  });

  it('maxTicks 到達の abandonInFlight 鎮火も autoContainCount と fireEvents に含める', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0, 5), burningTask(1, 5)]);
    sprint.config.maxTicks = 0;
    stepSprint(sprint, org, () => 0.5, 0);
    expect(sprint.complete).toBe(true);
    expect(sprint.metrics.autoContainCount).toBe(2);
    expect(sprint.fireEvents.filter((e) => e.kind === 'auto-contain')).toHaveLength(2);
    const result = summarizeSprint(sprint, org);
    expect(result.autoContainCount).toBe(2);
    expect(result.fireEvents.filter((e) => e.kind === 'auto-contain')).toHaveLength(2);
  });
});
