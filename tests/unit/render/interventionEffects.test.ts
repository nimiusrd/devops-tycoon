import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../../src/data/actions';
import { ANDON_TICKS, applyAction, OVERTIME_TICKS, THROTTLE_TICKS } from '../../../src/sim/actions';
import { BURN_TICKS, STABILITY_TICKS } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import type { InterventionEffect, OrgState, SprintState, Task } from '../../../src/sim/types';
import {
  deriveActiveBoardAuras,
  INTERVENTION_VIEW,
  planInterventionReactions,
  planPositionedInterventionReactions,
  positionInterventionReactions,
} from '../../../src/render/interventionEffects';
import { findBoardFlow } from '../../../src/render/boardScene';
import { makeSprint as makeSprintWith, makeTask } from '../helpers/sprintFixtures';

const TICK = 42;
const rng = () => 0.99;

/** このファイルの固定 rng を束ねた共通フィクスチャの別名。 */
const makeSprint = (org: OrgState, tasks: Task[]): SprintState => makeSprintWith(org, tasks, rng);

function applyAndGetEffect(id: InterventionEffect['actionId']): {
  effect: InterventionEffect;
  before: Task[];
  after: Task[];
} {
  const org = createOrgState('default', true);
  const tasks =
    id === 'firefight'
      ? [makeTask(0, { lane: 'rework', incident: true, burnTicksLeft: BURN_TICKS }), makeTask(1)]
      : id === 'assignTask'
        ? [makeTask(0, { lane: 'coding', progress: 0.2 })]
        : id === 'splitPr'
          ? [makeTask(0, { kind: 'complex', lane: 'coding', progress: 0.5 })]
          : id === 'interruptReview'
            ? Array.from({ length: 5 }, (_, i) => makeTask(i))
            : id === 'pairReview'
              ? [makeTask(0), makeTask(1), makeTask(2)]
              : [];
  const sprint = makeSprint(org, tasks);
  const before = structuredClone(tasks);
  const outcome = applyAction(id, sprint, org, rng, TICK);
  expect(outcome.ok).toBe(true);
  return { effect: outcome.effect!, before, after: sprint.tasks };
}

describe('interventionEffects (RI-50)', () => {
  describe.each(ACTION_DEFS.map((def) => [def.id, def] as const))('%s', (id) => {
    it('planInterventionReactions が非空の plan を返す', () => {
      const { effect } = applyAndGetEffect(id);
      const reactions = planInterventionReactions(effect, TICK);
      expect(reactions.length).toBeGreaterThan(0);
    });

    it('positionInterventionReactions が盤面座標範囲内を返す（boardAura 除く）', () => {
      const { effect, before, after } = applyAndGetEffect(id);
      const positioned = planPositionedInterventionReactions(effect, after, before, TICK);
      expect(positioned.length).toBeGreaterThan(0);
      for (const p of positioned) {
        if (p.kind === 'boardAura') continue;
        const coords =
          p.kind === 'reviewSweep' || p.kind === 'assignDash'
            ? [p.fromX, p.fromY, p.toX, p.toY]
            : [p.x, p.y];
        for (const v of coords) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(Math.max(INTERVENTION_VIEW.w, INTERVENTION_VIEW.h));
        }
      }
    });
  });

  it('interruptReview は reviewSweep を taskIds 件数ぶん座標付けする', () => {
    const { effect, before, after } = applyAndGetEffect('interruptReview');
    const reactions = planInterventionReactions(effect, TICK);
    expect(reactions).toEqual([{ kind: 'reviewSweep', taskIds: [0, 1, 2, 3] }]);
    const positioned = positionInterventionReactions(reactions, after, before);
    expect(positioned).toHaveLength(4);
    expect(positioned.every((p) => p.kind === 'reviewSweep')).toBe(true);
  });

  it('firefight は firefight リアクションを導出する', () => {
    const { effect, before, after } = applyAndGetEffect('firefight');
    expect(planInterventionReactions(effect, TICK)).toEqual([{ kind: 'firefight', taskId: 0 }]);
    const [pos] = positionInterventionReactions(
      planInterventionReactions(effect, TICK),
      after,
      before,
    );
    expect(pos?.kind).toBe('firefight');
  });

  it('aiThrottle / overtime / andon は boardAura を返す', () => {
    for (const [actionId, total] of [
      ['aiThrottle', THROTTLE_TICKS],
      ['overtime', OVERTIME_TICKS],
      ['andon', ANDON_TICKS],
    ] as const) {
      const { effect } = applyAndGetEffect(actionId);
      expect(planInterventionReactions(effect, TICK)).toEqual([
        {
          kind: 'boardAura',
          modifierKind: effect.modifier!.kind,
          durationTicks: total,
        },
      ]);
    }
  });

  it('reviewSweep は post-action lane に応じて Done / Rework / Incident フローを選ぶ', () => {
    const prev = [makeTask(0), makeTask(1), makeTask(2)];
    const next: Task[] = [
      { ...prev[0], lane: 'done' },
      { ...prev[1], lane: 'rework' },
      { ...prev[2], lane: 'rework', incident: true, burnTicksLeft: BURN_TICKS },
    ];
    const reactions = [{ kind: 'reviewSweep' as const, taskIds: [0, 1, 2] }];
    const positioned = positionInterventionReactions(reactions, next, prev);
    expect(positioned).toHaveLength(3);
    expect(positioned.map((p) => (p.kind === 'reviewSweep' ? p.outcome : null))).toEqual([
      'done',
      'rework',
      'incident',
    ]);
    const doneSweep = positioned[0];
    const reworkSweep = positioned[1];
    if (doneSweep.kind === 'reviewSweep' && reworkSweep.kind === 'reviewSweep') {
      expect(doneSweep.toX).not.toBe(reworkSweep.toX);
    }
  });

  it('pairReview は Review 0 件でも literacyGain があれば successPulse を返す', () => {
    const effect: InterventionEffect = {
      actionId: 'pairReview',
      reviewedCount: 0,
      affectedTaskIds: [],
      literacyGain: 4,
      focusCost: 2,
      gaugeGain: 0.15,
    };
    expect(planInterventionReactions(effect, 42)).toEqual([{ kind: 'successPulse' }]);
  });

  it('assignDash は高進捗タスクでも到達点が開始点より先になる', () => {
    const prev = [makeTask(0, { lane: 'coding', progress: 0.82 })];
    const next = [{ ...prev[0], progress: 0.999 }];
    const reactions = [{ kind: 'assignDash' as const, taskId: 0 }];
    const [pos] = positionInterventionReactions(reactions, next, prev);
    expect(pos?.kind).toBe('assignDash');
    if (pos?.kind === 'assignDash') {
      const dx = pos.toX - pos.fromX;
      const dy = pos.toY - pos.fromY;
      const flow = findBoardFlow('coding', 'review')!;
      const flowDx = flow.x2 - flow.x1;
      const flowDy = flow.y2 - flow.y1;
      expect(dx * flowDx + dy * flowDy).toBeGreaterThan(0);
    }
  });

  it('deriveActiveBoardAuras は sprintTick から残り tick を導出する', () => {
    const auras = deriveActiveBoardAuras(
      {
        throttleUntilTick: 70,
        overtimeUntilTick: 0,
        andonUntilTick: 50,
        stabilityUntilTick: 132,
      },
      42,
    );
    expect(auras).toEqual([
      { kind: 'throttle', remainingTicks: 28, totalTicks: THROTTLE_TICKS },
      { kind: 'andon', remainingTicks: 8, totalTicks: ANDON_TICKS },
      { kind: 'stability', remainingTicks: 90, totalTicks: STABILITY_TICKS },
    ]);
  });
});
