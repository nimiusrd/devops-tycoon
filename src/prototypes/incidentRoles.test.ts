import { describe, expect, it } from 'vitest';
import {
  applyIncidentRoles as apply,
  chooseIncidentAction,
  compareIncidentInvestigationSwitch,
  compareIncidentRoles,
  createIncidentRoles as create,
  summarizeIncidentRoles,
  viewIncidentRoles,
} from './incidentRoles';
import comparison from '../../docs/prototypes/incident-roles-comparison.json';
import investigation from '../../docs/prototypes/incident-roles-investigation-comparison.json';

describe('RI-253 障害の役割分担', () => {
  it('担当枠と切替費用を先に示し、選択だけでは復旧しない', () => {
    const first = create('RI-253', 'brief');
    expect(create('RI-253', 'brief')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewIncidentRoles(first);
    for (let i = 0; i < 8; i++) expect(viewIncidentRoles(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      slots: 3,
      baselineRecovery: 1,
      reassignmentSlotCost: 1,
      recoveryNeed: 6,
      investigationNeed: 4,
      explanationNeed: 4,
      spreadCapConnected: false,
      shipFloorConnected: false,
      integration: 'keep-spread-cap-and-ship-floor',
      choices: ['recovery', 'split'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.recoveryTime])).toEqual([
      ['recovery', 12, 1],
      ['split', 2, 2],
    ]);
    const chosen = apply(first, { type: 'recovery' });
    expect(chosen).toMatchObject({ strategy: 'recovery', recovery: 0, ship: 0 });
    expect(apply(chosen, { type: 'split' })).toBe(chosen);
    expect(viewIncidentRoles(chosen).choices).toEqual([]);
    expect(
      viewIncidentRoles(create('RI-253', 'lasting')).forecasts.map((item) => item.score),
    ).toEqual([-18, 2]);
  });

  it('短い障害は復旧全振り、長い障害は分担が上回る', () => {
    const rows = compareIncidentRoles(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('brief', 'recovery').result).toMatchObject({
      score: 12,
      ship: 16,
      recoveryTime: 1,
      recurrence: 4,
      trustGap: 4,
      recurrencePenalty: 2,
      trustPenalty: 2,
      reassignmentCost: 0,
      lost: false,
    });
    expect(row('brief', 'split').result).toMatchObject({
      score: 2,
      ship: 4,
      recoveryTime: 2,
      recurrence: 0,
      trustGap: 0,
      reassignmentCost: 0,
    });
    expect(row('lasting', 'split').result).toMatchObject({
      score: 2,
      ship: 12,
      recoveryTime: 2,
      recurrence: 0,
      trustGap: 0,
      recurrencePenalty: 5,
      trustPenalty: 5,
    });
    expect(row('lasting', 'recovery').result).toMatchObject({
      score: -18,
      recoveryTime: 1,
      recurrence: 4,
      trustGap: 4,
      recurrencePenalty: 15,
      trustPenalty: 15,
    });
    expect(row('brief', 'recovery').result.score).toBeGreaterThan(
      row('brief', 'split').result.score,
    );
    expect(row('lasting', 'split').result.score).toBeGreaterThan(
      row('lasting', 'recovery').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.spreadCapConnected).toBe(false);
      expect(item.result.shipFloorConnected).toBe(false);
    }
  });

  it('担当なしでも復旧は進み、同じ枠を二つの役割に使えない', () => {
    const fresh = create('RI-253', 'brief');
    expect(apply(fresh, { type: 'assign', recovery: 0, investigation: 0, explanation: 0 })).toBe(
      fresh,
    );
    const opened = apply(fresh, { type: 'recovery' });
    const idle = apply(opened, { type: 'assign', recovery: 0, investigation: 0, explanation: 0 });
    expect(idle).toMatchObject({ recovery: 1, investigation: 0, explanation: 0 });
    const investigation = apply(opened, {
      type: 'assign',
      recovery: 0,
      investigation: 3,
      explanation: 0,
    });
    expect(investigation).toMatchObject({ recovery: 1, investigation: 6, explanation: 0 });
    expect(apply(fresh, { type: 'assign', recovery: 2, investigation: 2, explanation: 0 })).toBe(
      fresh,
    );

    const focused = apply(apply(fresh, { type: 'recovery' }), { type: 'work' });
    expect(focused.periods.map((period) => period.assignment)).toEqual([
      { recovery: 0, investigation: 0, explanation: 0 },
      { recovery: 3, investigation: 0, explanation: 0 },
    ]);
    expect(apply(focused, { type: 'assign', recovery: 0, investigation: 0, explanation: 3 })).toBe(
      focused,
    );
    const switched = apply(focused, {
      type: 'assign',
      recovery: 0,
      investigation: 0,
      explanation: 2,
    });
    expect(switched).toMatchObject({ explanation: 4, reassignmentCost: 1, recovery: 8 });
    expect(switched.periods[switched.periods.length - 1]?.assignment).toEqual({
      recovery: 0,
      investigation: 0,
      explanation: 2,
    });
    const lasting = apply(apply(create('RI-253', 'lasting'), { type: 'recovery' }), {
      type: 'work',
    });
    const lastingSwitched = apply(lasting, {
      type: 'assign',
      recovery: 0,
      investigation: 0,
      explanation: 2,
    });
    const restored = apply(lastingSwitched, {
      type: 'assign',
      recovery: 0,
      investigation: 0,
      explanation: 3,
    });
    expect(restored).toMatchObject({ explanation: 10, reassignmentCost: 1, recovery: 9 });
    const manual = apply(lasting, {
      type: 'assign',
      recovery: 0,
      investigation: 0,
      explanation: 2,
    });
    expect(chooseIncidentAction(manual, 'recovery')).toEqual({
      type: 'assign',
      recovery: 2,
      investigation: 0,
      explanation: 0,
    });
    const continued = apply(manual, chooseIncidentAction(manual, 'recovery'));
    expect(continued.tick).toBe(manual.tick + 1);
    expect(continued.reassignmentCost).toBe(manual.reassignmentCost + 1);
    const splitOpened = apply(create('RI-253', 'lasting'), { type: 'split' });
    const narrowed = apply(splitOpened, {
      type: 'assign',
      recovery: 2,
      investigation: 0,
      explanation: 0,
    });
    expect(chooseIncidentAction(narrowed, 'split')).toEqual({
      type: 'assign',
      recovery: 1,
      investigation: 1,
      explanation: 0,
      intent: { recovery: 1, investigation: 1, explanation: 1 },
    });
    const partial = apply(narrowed, chooseIncidentAction(narrowed, 'split'));
    expect(partial.switchIntent).toEqual({ recovery: 1, investigation: 1, explanation: 1 });
    expect(partial.explanation).toBe(0);
    expect(chooseIncidentAction(partial, 'split')).toEqual({ type: 'work' });
    const splitRestored = apply(partial, { type: 'work' });
    expect(splitRestored.previous).toEqual({ recovery: 1, investigation: 1, explanation: 1 });
    expect(splitRestored.explanation).toBe(2);
    expect(splitRestored.switchIntent).toBeNull();
    const planted = apply(splitOpened, {
      type: 'assign',
      recovery: 2,
      investigation: 0,
      explanation: 0,
      intent: { recovery: 1, investigation: 1, explanation: 1 },
    });
    expect(planted.switchIntent).toBeNull();
    expect(planted.reassignmentCost).toBe(0);
    expect(apply(planted, { type: 'work' })).toBe(planted);
    const mixed = apply(splitOpened, {
      type: 'assign',
      recovery: 2,
      investigation: 1,
      explanation: 0,
    });
    const paid = apply(mixed, chooseIncidentAction(mixed, 'split'));
    expect(paid.reassignmentCost).toBe(1);
    expect(paid.switchIntent).toEqual({ recovery: 1, investigation: 1, explanation: 1 });
    const forged = apply(apply(create('RI-253', 'brief'), { type: 'recovery' }), {
      type: 'assign',
      recovery: 3,
      investigation: 0,
      explanation: 0,
      intent: { recovery: 0, investigation: 0, explanation: 3 },
    });
    expect(forged.switchIntent).toBeNull();
    expect(apply(forged, { type: 'assign', recovery: 0, investigation: 0, explanation: 3 })).toBe(
      forged,
    );
    expect(
      apply(forged, { type: 'assign', recovery: 0, investigation: 0, explanation: 2 }),
    ).toMatchObject({ reassignmentCost: 1 });
    const mutable = chooseIncidentAction(narrowed, 'split');
    const replayed = apply(narrowed, mutable);
    if (mutable.type === 'assign' && mutable.intent) mutable.intent.explanation = 9;
    expect(replayed.inputs[replayed.inputs.length - 1]).toMatchObject({
      intent: { recovery: 1, investigation: 1, explanation: 1 },
    });
    expect(replayed.switchIntent).toEqual({ recovery: 1, investigation: 1, explanation: 1 });
    const skipped = structuredClone(fresh);
    skipped.tick = 1;
    expect(chooseIncidentAction(skipped, 'recovery')).toEqual({ type: 'view' });
    expect(viewIncidentRoles(skipped).choices).toEqual([]);
    expect(viewIncidentRoles(skipped).forecasts).toEqual([]);
    expect(apply(skipped, { type: 'recovery' })).toBe(skipped);
    expect(apply(skipped, { type: 'assign', recovery: 3, investigation: 0, explanation: 0 })).toBe(
      skipped,
    );
    const chosen = apply(create('RI-253', 'brief'), { type: 'recovery' });
    const saved = chosen.periods[0];
    if (saved) saved.assignment.recovery = 9;
    const another = apply(create('RI-253', 'brief'), { type: 'recovery' });
    expect(another.periods[0]?.assignment.recovery).toBe(0);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareIncidentRoles(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseIncidentAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        for (const period of live.periods) {
          const used =
            period.assignment.recovery +
            period.assignment.investigation +
            period.assignment.explanation;
          expect(used).toBeLessThanOrEqual(live.slots);
        }
      }
      expect(summarizeIncidentRoles(live)).toEqual(row.result);
    }
  });
});

describe('RI-253 調査必要量と途中切替', () => {
  it('必要量4と5のあいだで分担が上になり、6でもそのままで、失った枠の条件を再計算する', () => {
    const report = compareIncidentInvestigationSwitch(investigation.seed);
    expect(report).toEqual(investigation);
    expect(report.evaluation).toEqual({
      fixedStrategies: true,
      humanPlay: false,
      productionIntegration: false,
    });
    expect(report.resources).toEqual({
      slots: 3,
      progressPerPerson: 2,
      baselineRecovery: 1,
      reassignmentSlotCost: 1,
      recoveryNeed: 6,
      explanationNeed: 4,
      investigationNeeds: [4, 5, 6, 7],
    });
    expect(report.reversals).toEqual([
      { board: 'brief', lowerNeed: 4, higherNeed: 5, lower: 'tie', higher: 'split' },
      { board: 'lasting', lowerNeed: 4, higherNeed: 5, lower: 'tie', higher: 'split' },
    ]);
    const row = (board: string, need: number) =>
      report.summary.find((item) => item.board === board && item.investigationNeed === need)!;
    for (const board of ['brief', 'lasting'] as const) {
      expect(row(board, 4).advantage).toBe('tie');
      expect(row(board, 4).slotLowersScore).toBe(false);
      for (const need of [5, 6, 7]) expect(row(board, need).advantage).toBe('split');
    }
    expect(row('brief', 6)).toMatchObject({
      split: 1,
      switch: 0,
      slotKept: 1,
      slotLowersScore: true,
    });
    expect(row('lasting', 6)).toMatchObject({
      split: -3,
      switch: -13,
      slotKept: -3,
      slotLowersScore: true,
      splitInvestigation: 6,
      switchInvestigation: 4,
      slotKeptInvestigation: 8,
    });
    expect(row('brief', 7).slotLowersScore).toBe(false);
    expect(row('lasting', 7)).toMatchObject({
      split: -8,
      switch: -13,
      slotKept: -8,
      slotKeptAdvantage: 'tie',
      slotLowersScore: true,
    });
    expect(row('brief', 4).split).toBe(2);
    expect(row('lasting', 4).split).toBe(2);
  });

  it('切替費用1では3役割を同時に置けず、費用0の同じ開始だけが調査を残す', () => {
    const opened = apply(create('RI-253', 'lasting', { investigationNeed: 6 }), { type: 'split' });
    const heavy = apply(opened, { type: 'assign', recovery: 1, investigation: 2, explanation: 0 });
    expect(apply(heavy, { type: 'assign', recovery: 1, investigation: 1, explanation: 1 })).toBe(
      heavy,
    );
    const kept = apply(
      apply(create('RI-253', 'lasting', { investigationNeed: 6, reassignmentSlotCost: 0 }), {
        type: 'split',
      }),
      { type: 'assign', recovery: 1, investigation: 2, explanation: 0 },
    );
    expect(
      apply(kept, { type: 'assign', recovery: 1, investigation: 1, explanation: 1 }),
    ).toMatchObject({
      investigation: 6,
      reassignmentCost: 0,
    });
  });

  it('調査必要量の全入力を再生し、JSON保存再開と元状態の不変が一致する', () => {
    for (const point of compareIncidentInvestigationSwitch(investigation.seed).points) {
      for (const play of Object.values(point.plays)) {
        let live = play.initial;
        let saved = structuredClone(live);
        let sawSwitchTick = false;
        for (const input of play.inputs) {
          const previous = live;
          const before = structuredClone(live);
          live = apply(live, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
          expect(live).not.toBe(previous);
        }
        expect(live.tick).toBe(play.initial.horizon);
        expect(toResult(live)).toEqual(play.result);
        expect(live.inputs).toEqual(play.inputs);
        for (const period of live.periods) {
          const used =
            period.assignment.recovery +
            period.assignment.investigation +
            period.assignment.explanation;
          expect(used).toBeLessThanOrEqual(play.initial.slots);
          if (period.action === 'assign' && play.decision === 'switch' && period.tick === 2) {
            sawSwitchTick = true;
            expect(used).toBeLessThanOrEqual(
              play.initial.slots - play.initial.reassignmentSlotCost,
            );
          }
        }
        if (play.decision === 'switch') expect(sawSwitchTick).toBe(true);
      }
    }
  });
});

function toResult(state: ReturnType<typeof create>) {
  const summary = summarizeIncidentRoles(state);
  return {
    score: summary.score,
    ship: summary.ship,
    penalty: summary.penalty,
    recoveryTime: summary.recoveryTime,
    recurrence: summary.recurrence,
    trustGap: summary.trustGap,
    reassignmentCost: summary.reassignmentCost,
    investigation: state.investigation,
    explanation: state.explanation,
    path: summary.path,
  };
}
