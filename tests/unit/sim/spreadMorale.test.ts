import { describe, expect, it } from 'vitest';
import { formatSprintEvent } from '../../../src/render/sprintEventView';
import { deriveStatusParts } from '../../../src/render/status';
import { SPRINT_BALANCE } from '../../../src/data/balance';
import { SPREAD_MORALE_COST } from '../../../src/sim/model';
import { RunEngine } from '../../../src/sim/run/engine';

/**
 * #365: Daily / Normal / seed daily-2026-08-27 の Sprint 1 無介入。
 * 士気 70→94 は出荷完了の積み上げ。延焼は終盤 1 件で実減がある。
 */
describe('延焼と士気の符号（#365）', () => {
  it('出荷完了で士気が上がり、延焼 tick では下がる', () => {
    const engine = new RunEngine({ seed: 'daily-2026-08-27', difficulty: 'normal' });
    engine.startRun('normal', [], 'daily-2026-08-27', {
      kind: 'daily',
      dailyDate: '2026-08-27',
    });
    engine.beginSetupSprint();

    const start = engine.snapshot();
    expect(start.phase).toBe('sprint');
    expect(start.org.morale).toBe(70);

    let peakHud = Math.round(start.org.morale);
    let moraleAtFirstSpread: number | undefined;
    let hudAtFirstSpread: number | undefined;
    let firstSpreadText: string | undefined;
    let completionsBeforeSpread = 0;
    let burningAtHigh = 0;
    let sawHighRisk = false;

    while (engine.snapshot().phase === 'sprint') {
      const tick = engine.snapshot().sprintTick;
      const before = engine.snapshot();
      engine.step(100);
      const after = engine.snapshot();
      const sprint = after.sprint;
      if (!sprint) break;

      const hud = Math.round(after.org.morale);
      peakHud = Math.max(peakHud, hud);
      const burning = sprint.tasks.filter((t) => t.lane === 'rework' && t.incident).length;
      const status = deriveStatusParts(after.org, sprint.tasks);
      if (status.risk === 'HIGH') {
        sawHighRisk = true;
        burningAtHigh = Math.max(burningAtHigh, burning);
      }

      const spread = sprint.events.find((event) => event.kind === 'spread' && event.tick === tick);
      if (spread && moraleAtFirstSpread === undefined) {
        moraleAtFirstSpread = after.org.morale;
        hudAtFirstSpread = hud;
        firstSpreadText = formatSprintEvent(spread).text;
        completionsBeforeSpread = sprint.metrics.doneCount;
        expect(spread.moraleCost).toBe(SPREAD_MORALE_COST);
        expect(before.org.morale - after.org.morale).toBe(SPREAD_MORALE_COST);
      }
    }

    const end = engine.snapshot();
    expect(end.lastResult?.spread).toBe(1);
    expect(sawHighRisk).toBe(true);
    expect(burningAtHigh).toBeGreaterThanOrEqual(3);
    expect(peakHud).toBe(94);
    expect(completionsBeforeSpread).toBeGreaterThan(
      (94 - 70) / SPRINT_BALANCE.completionMoraleGain.value - 1,
    );
    expect(moraleAtFirstSpread).toBe(89);
    expect(hudAtFirstSpread).toBe(89);
    expect(firstSpreadText).toBe('延焼! 負債 +6 / 士気 -5');
    expect(Math.round(end.org.morale)).toBe(90);
  });
});
