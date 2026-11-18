import { describe, expect, it } from 'vitest';
import { getCard } from '../data/cards';
import { applyAction } from '../sim/actions';
import { playCardFromHand } from '../sim/cards';
import { createRngFromState, getRngState } from '../sim/rng';
import { stepSprint } from '../sim/sprint';
import {
  BUILD_LAB_LIMITS,
  BuildLaboratory,
  restoreBuildLaboratory,
  type BuildSide,
} from './buildLaboratory';

type Saved = {
  runs: Record<BuildSide, ReturnType<BuildLaboratory['view']>>;
  ruleset: { prototype: string };
  schema: number;
  extra?: boolean;
};

function start(lab: BuildLaboratory) {
  for (const side of ['coding', 'verification'] as const)
    expect(lab.act(side, { type: 'start' }).ok).toBe(true);
}
function finish(lab: BuildLaboratory, side: BuildSide) {
  for (let i = 0; i < 4 && !lab.view(side).sprint.complete; i++)
    expect(lab.advance(side, 120).ok).toBe(true);
  expect(lab.view(side).sprint.complete).toBe(true);
}

describe('RI-270 build laboratory', () => {
  it('matches the full initial work, resources, period and RNG before a single paid build change', () => {
    const lab = new BuildLaboratory();
    expect(lab.view('coding')).toEqual(lab.view('verification'));
    expect(lab.compare().identity).toEqual({
      tasks: true,
      resources: true,
      rng: true,
      period: true,
    });
    const initial = lab.view('coding');
    expect(initial.sprint.tasks).toHaveLength(24);
    expect(initial.sprint.tasks.map((t) => t.id)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    for (const kind of ['routine', 'normal', 'complex'])
      expect(initial.sprint.tasks.filter((t) => t.kind === kind)).toHaveLength(8);
    expect(
      new BuildLaboratory({ seed: 'other', maxTicks: 180, budget: 45 }).view('coding').sprint.tasks,
    ).toEqual(initial.sprint.tasks);
    start(lab);
    for (const side of ['coding', 'verification'] as const) {
      const run = lab.view(side);
      const card = getCard(side === 'coding' ? 'claude-code' : 'auto-test')!;
      expect(run.sprint.tasks).toEqual(initial.sprint.tasks);
      expect(run.rngState).toBe(initial.rngState);
      expect(run.budget).toBe(initial.budget - card.cost);
      expect(run.investment).toEqual({
        card: card.id,
        budgetSpent: card.cost,
        focusSpent: card.focusCost,
      });
      expect(run.sprint.metrics.focusSpent).toBe(card.focusCost);
    }
  });

  it('uses real card/action/step processing and counts pre-step occupancy even when a batch completes early', () => {
    const lab = new BuildLaboratory();
    const initial = lab.view('coding');
    const deck = [{ defId: 'claude-code', level: 1 }];
    initial.sprint.cardPiles.hand = [0];
    expect(playCardFromHand(initial.sprint, initial.org, deck, 0).ok).toBe(true);
    const rng = createRngFromState(initial.rngState);
    expect(lab.act('coding', { type: 'start' }).ok).toBe(true);
    const observed = { backlog: 0, coding: 0, review: 0, rework: 0, done: 0 };
    for (let tick = 1; tick <= 10; tick++) {
      for (const task of initial.sprint.tasks) observed[task.lane]++;
      stepSprint(initial.sprint, initial.org, rng, tick);
    }
    expect(lab.advance('coding', 10).ok).toBe(true);
    expect(lab.view('coding').occupancy).toEqual(observed);
    expect(lab.view('coding').sprint).toEqual(initial.sprint);
    expect(lab.view('coding').org).toEqual(initial.org);
    const action = { type: 'intervene', id: 'overtime' } as const;
    expect(applyAction(action.id, initial.sprint, initial.org, rng, 10).ok).toBe(true);
    expect(lab.act('coding', action).ok).toBe(true);
    expect(lab.view('coding').sprint).toEqual(initial.sprint);
    expect(lab.view('coding').org).toEqual(initial.org);
    expect(lab.view('coding').rngState).toBe(getRngState(rng));
    finish(lab, 'coding');
    const run = lab.view('coding');
    expect(Object.values(run.occupancy).reduce((a, b) => a + b, 0)).toBe(run.tick * 24);
    expect(lab.compare().coding.unfinished + lab.compare().coding.done).toBe(24);
    const short = new BuildLaboratory({ seed: 'short', maxTicks: 1, budget: 45 });
    start(short);
    expect(short.advance('coding', 120).ok).toBe(true);
    expect(short.view('coding').tick).toBe(1);
    expect(short.view('coding').occupancy.backlog).toBe(24);
    expect(short.compare().coding.timedOut).toBe(true);
    expect(short.compare().coding.unfinished).toBe(24);
  });

  it('allows independent input sequences, resources, RNG and JSON resumption with defensive views', () => {
    const lab = new BuildLaboratory();
    const untouched = lab.view('verification');
    expect(lab.act('coding', { type: 'start' }).ok).toBe(true);
    lab.advance('coding', 37);
    const priorRng = lab.view('coding').rngState;
    expect(lab.act('coding', { type: 'intervene', id: 'pairReview' }).ok).toBe(true);
    expect(lab.view('coding').rngState).not.toBe(priorRng);
    expect(lab.view('verification')).toEqual(untouched);
    const resumed = restoreBuildLaboratory(lab.serialize());
    expect(resumed.serialize()).toBe(lab.serialize());
    lab.act('verification', { type: 'start' });
    resumed.act('verification', { type: 'start' });
    lab.advance('verification', 83);
    resumed.advance('verification', 83);
    expect(resumed.serialize()).toBe(lab.serialize());
    const copied = lab.view('coding');
    copied.org.seniorHp = -999;
    copied.initial.sprint.tasks.length = 0;
    copied.commands.length = 0;
    const comparison = lab.compare();
    comparison.initial.org.morale = -99;
    expect(resumed.serialize()).toBe(lab.serialize());
    // 呼び出し順を逆転しても各側の最終結果は同じ。
    for (const side of ['verification', 'coding'] as const) finish(lab, side);
    for (const side of ['coding', 'verification'] as const) finish(resumed, side);
    expect(resumed.serialize()).toBe(lab.serialize());
    expect(restoreBuildLaboratory(lab.serialize()).compare()).toEqual(lab.compare());
  });

  it('rejects invalid, contradictory, duplicate and terminal commands without spending or logging', () => {
    const lab = new BuildLaboratory();
    const rejected = (operation: () => { ok: boolean }) => {
      const before = lab.serialize();
      expect(operation().ok).toBe(false);
      expect(lab.serialize()).toBe(before);
    };
    rejected(() => lab.advance('coding', 1));
    rejected(() => lab.act('coding', { type: 'intervene', id: 'overtime' }));
    rejected(() => lab.act('other' as BuildSide, { type: 'start' }));
    rejected(() => lab.act('coding', { type: 'start', reward: 100 }));
    start(lab);
    rejected(() => lab.act('coding', { type: 'start' }));
    for (const ticks of [0, -1, 1.5, Infinity, NaN, 121])
      rejected(() => lab.advance('coding', ticks));
    for (const input of [
      null,
      { type: 'unknown' },
      Object.create({ type: 'start' }),
      { type: 'start', [Symbol('unknown')]: true },
      {
        get type() {
          return 'start';
        },
      },
      { type: 'intervene', id: 'unknown' },
      { type: 'intervene', id: 'overtime', target: { taskId: 0 } },
      { type: 'intervene', id: 'assignTask', target: { taskId: 100 } },
      { type: 'intervene', id: 'assignTask', target: { taskId: 0, lane: 'done' } },
      { type: 'intervene', id: 'assignTask', target: { taskId: 0, assignee: 'both' } },
      { type: 'intervene', id: 'splitPr', target: { taskId: 0, lane: 'review' } },
      { type: 'intervene', id: 'interruptReview' },
    ])
      rejected(() => lab.act('coding', input));
    const targetInput = {
      type: 'intervene',
      id: 'assignTask',
      target: { taskId: 0, lane: 'coding', assignee: 'ai' },
    };
    expect(lab.act('coding', targetInput).ok).toBe(true);
    const saved = lab.serialize();
    targetInput.target.taskId = 23;
    expect(lab.serialize()).toBe(saved);
    rejected(() => lab.act('coding', { type: 'intervene', id: 'assignTask' }));
    finish(lab, 'coding');
    rejected(() => lab.act('coding', { type: 'start' }));
    rejected(() => lab.act('coding', { type: 'intervene', id: 'overtime' }));
    rejected(() => lab.advance('coding', 1));
    expect(lab.compare().complete).toBe(false);
    finish(lab, 'verification');
    expect(lab.compare().complete).toBe(true);
  });

  it('keeps unaffordable builds ready, checks limits and rejects altered saves', () => {
    const poor = new BuildLaboratory({ seed: 'poor', maxTicks: 90, budget: 4 });
    const before = poor.serialize();
    expect(poor.act('verification', { type: 'start' })).toEqual({ ok: false, reason: 'budget' });
    expect(poor.serialize()).toBe(before);
    expect(poor.act('coding', { type: 'start' }).ok).toBe(true);
    finish(poor, 'coding');
    expect(poor.view('verification').commands).toEqual([]);
    for (const config of [
      { seed: '', maxTicks: 1, budget: 45 },
      { seed: 'a'.repeat(129), maxTicks: 1, budget: 45 },
      { seed: 'x', maxTicks: 361, budget: 45 },
      { seed: 'x', maxTicks: 1, budget: -1 },
      { seed: 'x', maxTicks: 1, budget: 45, unexpected: true },
    ])
      expect(() => new BuildLaboratory(config)).toThrow();
    const lab = new BuildLaboratory();
    start(lab);
    lab.advance('coding', 17);
    const raw = lab.serialize();
    for (const mutate of [
      (v: Saved) => v.runs.coding.rngState++,
      (v: Saved) => v.runs.coding.initial.sprint.tasks[0].progress++,
      (v: Saved) => v.runs.coding.sprint.tasks[0].progress++,
      (v: Saved) => v.runs.verification.org.seniorHp++,
      (v: Saved) => v.runs.coding.occupancy.review++,
      (v: Saved) => v.runs.coding.sprint.metrics.delivered++,
      (v: Saved) => v.runs.coding.commands.push({ type: 'start' }),
      (v: Saved) =>
        v.runs.coding.commands.push(
          Object.assign({ type: 'advance' as const, ticks: 1 }, { extra: true }),
        ),
      (v: Saved) =>
        (v.runs.coding.commands = Array.from({ length: 1025 }, () => ({ type: 'start' }))),
      (v: Saved) => (v.ruleset.prototype = 'future'),
      (v: Saved) => v.schema++,
      (v: Saved) => (v.extra = true),
    ]) {
      const altered = JSON.parse(raw);
      mutate(altered);
      expect(() => restoreBuildLaboratory(JSON.stringify(altered))).toThrow();
    }
    expect(() => restoreBuildLaboratory('x'.repeat(BUILD_LAB_LIMITS.saveBytes + 1))).toThrow(
      'save-limit',
    );
    expect(() => restoreBuildLaboratory('あ'.repeat(400_000))).toThrow('save-limit');
    expect(() => restoreBuildLaboratory('{')).toThrow();
  });

  it('repeats both builds deterministically across seeds and one-factor period sensitivity', () => {
    for (const seed of ['RI-270', 'RI-270:1', 'RI-270:2']) {
      for (const maxTicks of [90, 180, 360]) {
        const config = { seed, maxTicks, budget: 45 };
        const first = new BuildLaboratory(config);
        const second = new BuildLaboratory(config);
        start(first);
        start(second);
        for (const side of ['coding', 'verification'] as const) {
          finish(first, side);
          finish(second, side);
        }
        expect(second.serialize()).toBe(first.serialize());
        expect(first.compare().complete).toBe(true);
      }
    }
  });
});
