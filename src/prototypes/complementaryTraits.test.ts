import { describe, expect, it } from 'vitest';
import { assignMember } from '../sim/member/roster';
import { incidentProbability, reworkProbability } from '../sim/model';
import { createRngFromState, getRngState } from '../sim/rng';
import { stepSprint } from '../sim/sprint';
import {
  createComplementaryRoster,
  createComplementarySprint,
  runComplementarySprint,
} from './complementaryTraits';

const seed = 'RI-204:1';

describe('RI-204 Coding と Review の組み合わせ', () => {
  it('同じ二人を入れ替えると補正が外れる', () => {
    const paired = createComplementaryRoster('paired');
    const swapped = createComplementaryRoster('swapped');
    expect(swapped.members).toEqual([
      { ...paired.members[0], assignment: 'review' },
      { ...paired.members[1], assignment: 'coding' },
    ]);
    expect(createComplementarySprint(paired, seed, 4, true).affectedTaskIds).toHaveLength(16);
    expect(createComplementarySprint(swapped, seed, 4, true).affectedTaskIds).toEqual([]);
    expect(runComplementarySprint(swapped, seed, 4, true)).toEqual(
      runComplementarySprint(swapped, seed, 4, false),
    );
  });

  it('同席、控え、休職、担当を一意に決められない配置では発動しない', () => {
    const paired = createComplementaryRoster('paired');
    const [maker, reviewer] = paired.members;
    const formations = [
      assignMember(paired, reviewer.id, 'coding'),
      assignMember(paired, maker.id, 'bench'),
      { ...paired, members: [maker, { ...reviewer, onLeave: true }] },
      { ...paired, members: [...paired.members, { ...maker, id: 'second-coder' }] },
    ];
    for (const roster of formations) {
      expect(createComplementarySprint(roster, seed, 4, true).affectedTaskIds).toEqual([]);
    }
  });

  it('大規模PRにだけ手戻り補正を与え、工程全体の係数と障害率は同じに保つ', () => {
    const paired = createComplementaryRoster('paired');
    const before = createComplementarySprint(paired, seed, 2, false);
    const after = createComplementarySprint(paired, seed, 2, true);
    expect(after.affectedTaskIds).toEqual([0, 1, 4, 5, 8, 9, 12, 13]);
    expect(after.org).toEqual(before.org);
    expect(getRngState(after.rng)).toBe(getRngState(before.rng));
    expect(after.sprint).toEqual({
      ...before.sprint,
      tasks: before.sprint.tasks.map((task) =>
        task.kind === 'complex' ? { ...task, split: true } : task,
      ),
    });
    for (const task of after.sprint.tasks) {
      const baseline = before.sprint.tasks[task.id];
      const baselineRework = reworkProbability(before.org, baseline, before.sprint.cardEffects);
      const pairedRework = reworkProbability(after.org, task, after.sprint.cardEffects);
      if (task.kind === 'complex') expect(pairedRework).toBeLessThan(baselineRework);
      else expect(pairedRework).toBe(baselineRework);
      expect(incidentProbability(after.org, task, after.sprint.cardEffects)).toBe(
        incidentProbability(before.org, baseline, before.sprint.cardEffects),
      );
    }
    expect(runComplementarySprint(paired, seed, 0, true)).toEqual(
      runComplementarySprint(paired, seed, 0, false),
    );
  });

  it('シナリオ入力の再生と盤面のJSON再開で同じ結果になる', () => {
    const roster = createComplementaryRoster('paired');
    const trial = createComplementarySprint(roster, seed, 4, true);
    const later = createComplementarySprint(roster, seed, 4, true);
    const resumeTick = 18;
    for (let tick = 0; tick < resumeTick; tick += 1) {
      stepSprint(later.sprint, later.org, later.rng, tick);
    }
    const saved = JSON.stringify({
      sprint: later.sprint,
      org: later.org,
      rngState: getRngState(later.rng),
    });
    const resumed: {
      sprint: typeof later.sprint;
      org: typeof later.org;
      rngState: number;
    } = JSON.parse(saved);
    const resumedRng = createRngFromState(resumed.rngState);
    for (let tick = 0; tick <= trial.sprint.config.maxTicks; tick += 1) {
      stepSprint(trial.sprint, trial.org, trial.rng, tick);
      if (tick >= resumeTick) stepSprint(resumed.sprint, resumed.org, resumedRng, tick);
    }
    expect(resumed.sprint.complete).toBe(true);
    expect(resumed.sprint).toEqual(trial.sprint);
    expect(resumed.org).toEqual(trial.org);
    expect(getRngState(resumedRng)).toBe(getRngState(trial.rng));
  });
});
