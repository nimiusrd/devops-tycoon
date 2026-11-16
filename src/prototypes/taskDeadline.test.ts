import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-deadline-comparison.json';
import factors from '../../docs/prototypes/task-deadline-factor-comparison.json';
import {
  baselineDeadlineFactorRules,
  chooseDeadlineChoice,
  compareDeadlineFactorReversals,
  compareDeadlineStrategies,
  createDeadlineChoice,
  createDeadlinePrototype,
  deadlineChoiceResources,
  deadlinePreviewSentence,
  deadlineValue,
  readDeadlinePreview,
  summarizeDeadlineChoice,
  tickDeadlineChoice,
  tickDeadlinePrototype,
  type DeadlineFactorRules,
  type DeadlineChoiceId,
  type DeadlineChoiceInput,
} from './taskDeadline';

describe('RI-155 期限tickによる単一価値切替', () => {
  it('期限前・同tick・超過の境界を定義し、超過後も出荷できる', () => {
    const initial = createDeadlinePrototype('RI-155', 'recoverable');
    for (const tick of [2, 3, 4]) {
      let state = {
        ...initial,
        board: {
          ...initial.board,
          tick: tick - 1,
          tasks: [{ ...initial.board.tasks[0], workLeft: 1 }],
        },
      };
      state = tickDeadlinePrototype(state, 'work');
      expect(state.board.shipped).toEqual([{ id: 'campaign', tick, value: tick <= 3 ? 12 : 5 }]);
      expect(tickDeadlinePrototype(state, 'boost')).toBe(state);
    }
    expect(deadlineValue(initial, 3)).toBe(12);
    expect(deadlineValue(initial, 4)).toBe(5);
  });
  it('介入で間に合う盤面と介入しても遅れる盤面の代償を比較する', () => {
    const results = compareDeadlineStrategies(comparison.seed);
    expect(results).toEqual(comparison.results);
    expect(results[0].shipped[0]).toEqual({ id: 'campaign', tick: 4, value: 5 });
    expect(results[1].shipped[0]).toEqual({ id: 'campaign', tick: 3, value: 12 });
    expect(results[2].shipped[0].value).toBe(results[3].shipped[0].value);
    expect(results[2].stamina).toBeGreaterThan(results[3].stamina);
    expect(results[2].focus).toBeGreaterThan(results[3].focus);
  });
  it('集中力・体力不足の介入を拒否し、待機で作業を進めない', () => {
    const state = createDeadlinePrototype(1, 'recoverable');
    for (const limited of [
      { ...state, focus: 0 },
      { ...state, stamina: 2 },
    ])
      expect(tickDeadlinePrototype(limited, 'boost')).toBe(limited);
    const waiting = tickDeadlinePrototype(state, 'wait');
    expect(waiting.board.tasks).toEqual(state.board.tasks);
    expect(waiting.board.tick).toBe(1);
    expect(waiting.focus).toBe(2);
  });
  it('ブーストの二重計上を防ぎ、保存再開と入力再生を一致させる', () => {
    const initial = createDeadlinePrototype('RI-155', 'recoverable');
    const snapshot = structuredClone(initial);
    let state = tickDeadlinePrototype(initial, 'boost');
    expect(initial).toEqual(snapshot);
    let restored = JSON.parse(JSON.stringify(state));
    for (const action of ['wait', 'work', 'work', 'boost'] as const) {
      state = tickDeadlinePrototype(state, action);
      restored = tickDeadlinePrototype(restored, action);
    }
    expect(state).toEqual(restored);
    expect(state.board.shipped).toHaveLength(1);
    expect(state.boosts).toEqual([1]);
    const expired = { ...initial, board: { ...initial.board, tick: 8 } };
    expect(tickDeadlinePrototype(expired, 'boost')).toBe(expired);
  });
});

function works(id: DeadlineChoiceId, count: number): DeadlineChoiceInput[] {
  return Array.from({ length: count }, () => ({ type: 'work', id }));
}

function changedFactorKeys(rules: DeadlineFactorRules): (keyof DeadlineFactorRules)[] {
  return (Object.keys(baselineDeadlineFactorRules) as (keyof DeadlineFactorRules)[]).filter(
    (key) => rules[key] !== baselineDeadlineFactorRules[key],
  );
}

describe('RI-155 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源で優劣の反転を再計算し、固定戦略であることを残す', () => {
    const data = compareDeadlineFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-155',
      pressures: ['recoverable', 'missed'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      productionScreen: false,
      otherWork: 4,
    });
    expect(data.conditions.nextUncertainty).toBe(
      '4工数では翌期費用が体力1あたり2まで期限案件優先が上で3から別案件優先に反転し、6工数では別案件価値が期限後の5を超えると別案件優先に反転するが、この二つを同時にずらしたときどちらが残るか、予告文を人が読んで選べるかは未検証。',
    );
    const prefs = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.pressures.map((row) => [
          row.pressure,
          row.deadline.result.net,
          row.other.result.net,
          row.preference,
        ]),
      ]);
    expect(prefs('overdueVersusOther')).toEqual([
      [
        '0',
        [
          ['recoverable', 12, 5, 'deadline'],
          ['missed', 5, 0, 'deadline'],
        ],
      ],
      [
        '4',
        [
          ['recoverable', 16, 9, 'deadline'],
          ['missed', 5, 4, 'deadline'],
        ],
      ],
      [
        '5',
        [
          ['recoverable', 17, 10, 'deadline'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        '6',
        [
          ['recoverable', 18, 11, 'deadline'],
          ['missed', 5, 6, 'other'],
        ],
      ],
      [
        '12',
        [
          ['recoverable', 24, 17, 'deadline'],
          ['missed', 5, 12, 'other'],
        ],
      ],
    ]);
    expect(prefs('nextPeriodStaminaCost')).toEqual([
      [
        '0',
        [
          ['recoverable', 17, 10, 'deadline'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        '1',
        [
          ['recoverable', 14, 10, 'deadline'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        '2',
        [
          ['recoverable', 11, 10, 'deadline'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        '3',
        [
          ['recoverable', 8, 10, 'other'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
    ]);
    expect(prefs('preview')).toEqual([
      [
        'accurate',
        [
          ['recoverable', 17, 10, 'deadline'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        'none',
        [
          ['recoverable', 10, 10, 'tie'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        'swapped',
        [
          ['recoverable', 10, 10, 'tie'],
          ['missed', 5, 5, 'tie'],
        ],
      ],
      [
        'falseMeet',
        [
          ['recoverable', 17, 10, 'deadline'],
          ['missed', 5, 5, 'other'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.pressure,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['overdueVersusOther', 'missed', '4', 'deadline', '5', 'tie'],
      ['overdueVersusOther', 'missed', '5', 'tie', '6', 'other'],
      ['nextPeriodStaminaCost', 'recoverable', '2', 'deadline', '3', 'other'],
      ['preview', 'recoverable', 'accurate', 'deadline', 'none', 'tie'],
      ['preview', 'recoverable', 'swapped', 'tie', 'falseMeet', 'deadline'],
      ['preview', 'missed', 'swapped', 'tie', 'falseMeet', 'other'],
    ]);
    const falseLate = data.reversals.find(
      (item) => item.axis === 'preview' && item.pressure === 'missed',
    );
    expect(falseLate?.before).toMatchObject({ deadlineStamina: 0, otherStamina: 0 });
    expect(falseLate?.after).toMatchObject({
      deadlineNet: 5,
      otherNet: 5,
      deadlineStamina: 3,
      otherStamina: 0,
      preference: 'other',
    });
    expect(
      data.reversals.some(
        (item) => item.pressure === 'recoverable' && item.axis === 'overdueVersusOther',
      ),
    ).toBe(false);
    expect(
      data.reversals.some(
        (item) => item.pressure === 'missed' && item.axis === 'nextPeriodStaminaCost',
      ),
    ).toBe(false);
  });

  it('基準行は同じ結果で、動かした規則は一つであり、初回の温存と急ぐは再出力しない', () => {
    const data = compareDeadlineFactorReversals();
    const first = compareDeadlineStrategies(comparison.seed);
    const baselines = [
      data.sweeps.overdueVersusOther.find((item) => item.parameter === '5'),
      data.sweeps.nextPeriodStaminaCost.find((item) => item.parameter === '0'),
      data.sweeps.preview.find((item) => item.parameter === 'accurate'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedFactorKeys(point.rules)).toEqual([]);
      expect(point.pressures).toEqual(baselines[0]?.pressures);
    }
    const baseline = baselines[0];
    if (!baseline) throw new Error('baseline');
    const recoverable = baseline.pressures.find((item) => item.pressure === 'recoverable');
    const missed = baseline.pressures.find((item) => item.pressure === 'missed');
    expect(recoverable?.deadline.inputs).toEqual([
      { type: 'boost' },
      ...works('campaign', 2),
      ...works('steady', 4),
    ]);
    expect(recoverable?.other.inputs).toEqual([...works('steady', 4), ...works('campaign', 4)]);
    expect(recoverable?.deadline.result.shipped).toEqual([
      { id: 'campaign', tick: 3, value: 12 },
      { id: 'steady', tick: 7, value: 5 },
    ]);
    expect(recoverable?.deadline.result).toMatchObject({ focus: 1, stamina: 7, boosts: [1] });
    expect(recoverable?.deadline.result.shipped[0]).toEqual(first[1]?.shipped[0]);
    expect(recoverable?.other.result.shipped).toEqual([
      { id: 'steady', tick: 4, value: 5 },
      { id: 'campaign', tick: 8, value: 5 },
    ]);
    expect(missed?.deadline.inputs).toEqual([...works('campaign', 6), ...works('steady', 2)]);
    expect(missed?.deadline.result.shipped).toEqual([{ id: 'campaign', tick: 6, value: 5 }]);
    expect(missed?.deadline.result).toMatchObject({
      focus: 2,
      stamina: 10,
      boosts: [],
      remaining: [{ id: 'steady', workLeft: 2 }],
    });
    expect(missed?.deadline.result.shipped[0]).toEqual(first[2]?.shipped[0]);
    expect(missed?.other.result).toMatchObject({
      shipped: [{ id: 'steady', tick: 4, value: 5 }],
      remaining: [{ id: 'campaign', workLeft: 2 }],
      staminaSpent: 0,
    });
    expect(first.some((row) => row.strategy === 'conserve' || row.strategy === 'rush')).toBe(true);
    const only: Record<string, keyof DeadlineFactorRules> = {
      overdueVersusOther: 'otherValue',
      nextPeriodStaminaCost: 'nextPeriodStaminaCost',
      preview: 'preview',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps]) {
        expect(changedFactorKeys(item.rules).every((name) => name === key)).toBe(true);
      }
    }
    const sequences = (axis: 'overdueVersusOther' | 'nextPeriodStaminaCost') =>
      data.sweeps[axis].map((item) =>
        item.pressures.map((row) => [row.deadline.inputs, row.other.inputs]),
      );
    expect(new Set(sequences('overdueVersusOther').map((item) => JSON.stringify(item))).size).toBe(
      1,
    );
    expect(
      new Set(sequences('nextPeriodStaminaCost').map((item) => JSON.stringify(item))).size,
    ).toBe(1);
    const lied = data.sweeps.preview.find((item) => item.parameter === 'falseMeet');
    const liedMissed = lied?.pressures.find((item) => item.pressure === 'missed');
    expect(liedMissed?.deadline.inputs[0]).toEqual({ type: 'boost' });
    expect(liedMissed?.deadline.result.shipped).toEqual([{ id: 'campaign', tick: 5, value: 5 }]);
    expect(liedMissed?.deadline.result.remaining).toEqual([{ id: 'steady', workLeft: 1 }]);
    expect(liedMissed?.previewText).toBe(deadlinePreviewSentence('accurate', 4));
    expect(missed?.previewText).toBe(deadlinePreviewSentence('accurate', 6));
    expect(liedMissed?.previewText).not.toBe(missed?.previewText);
  });

  it('予告は試作内の文だけで、固定戦略はその文だけを読んで追加する', () => {
    expect(deadlinePreviewSentence('none', 4)).toBe('予告はない。');
    expect(deadlinePreviewSentence('accurate', 4)).toBe(
      'tick 3までに出荷すると価値12、過ぎると5。追加作業1回で期限内に届く。',
    );
    expect(deadlinePreviewSentence('accurate', 6)).toBe(
      'tick 3までに出荷すると価値12、過ぎると5。追加作業1回では期限内に届かない。',
    );
    expect(deadlinePreviewSentence('swapped', 4)).toBe(
      'tick 3までに出荷すると価値5、過ぎると12。追加作業1回で期限内に届く。',
    );
    expect(deadlinePreviewSentence('falseMeet', 6)).toBe(deadlinePreviewSentence('accurate', 4));
    for (const kind of ['none', 'accurate', 'swapped', 'falseMeet'] as const) {
      for (const work of [4, 6]) {
        const text = deadlinePreviewSentence(kind, work);
        expect(text).not.toMatch(/[<>]/);
        expect(readDeadlinePreview(text).saysBoostMeets).toBe(
          kind === 'falseMeet' || (kind !== 'none' && work <= 4),
        );
      }
    }
    expect(() => readDeadlinePreview('価値12')).toThrow('予告文を読めない');
    const missed = createDeadlineChoice('missed');
    expect(chooseDeadlineChoice(missed, 'deadline')).toEqual({ type: 'work', id: 'campaign' });
    expect(
      chooseDeadlineChoice(
        { ...missed, previewText: deadlinePreviewSentence('falseMeet', 6) },
        'deadline',
      ),
    ).toEqual({ type: 'boost' });
    const swapped = createDeadlineChoice('recoverable', {
      ...baselineDeadlineFactorRules,
      preview: 'swapped',
    });
    expect(chooseDeadlineChoice(swapped, 'deadline')).toEqual({ type: 'work', id: 'campaign' });
    expect(chooseDeadlineChoice(swapped, 'other')).toEqual({ type: 'work', id: 'steady' });
    let rushed = swapped;
    for (const input of [...works('campaign', 4), ...works('steady', 4)]) {
      rushed = tickDeadlineChoice(rushed, input);
    }
    expect(rushed.shipped.map((item) => item.value)).toEqual([5, 5]);
    expect(deadlineValue(createDeadlinePrototype('RI-155', 'recoverable'), 3)).toBe(12);
  });

  it('要因比較の入力を再生すると差引が一致し、拒否と期末では同じ状態を返す', () => {
    const initial = createDeadlineChoice('recoverable');
    const old = createDeadlinePrototype(deadlineChoiceResources.seed, 'recoverable');
    expect(initial).toMatchObject({
      seed: old.board.seed,
      horizon: old.board.horizon,
      deadlineTick: old.deadlineTick,
      onTimeValue: old.onTimeValue,
      lateValue: old.lateValue,
      focus: old.focus,
      stamina: old.stamina,
    });
    expect(initial.tasks[0]?.workLeft).toBe(old.board.tasks[0]?.workLeft);
    const snapshot = structuredClone(initial);
    expect(tickDeadlineChoice(initial, { type: 'boost' })).not.toBe(initial);
    expect(initial).toEqual(snapshot);
    for (const limited of [
      { ...initial, focus: 0 },
      { ...initial, stamina: 2 },
    ]) {
      expect(tickDeadlineChoice(limited, { type: 'boost' })).toBe(limited);
    }
    let almost = initial;
    for (const input of works('campaign', 3)) almost = tickDeadlineChoice(almost, input);
    const paid = tickDeadlineChoice(almost, { type: 'boost' });
    expect(paid.shipped).toEqual([{ id: 'campaign', tick: 4, value: 5 }]);
    expect(paid).toMatchObject({ focus: 1, stamina: 7, boosts: [4] });
    expect(tickDeadlineChoice(paid, { type: 'boost' })).toBe(paid);
    const data = compareDeadlineFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const row of item.pressures) {
        for (const strategy of ['deadline', 'other'] as const) {
          const run = row[strategy];
          let state = createDeadlineChoice(row.pressure, item.rules);
          expect(state.previewText).toBe(row.previewText);
          for (const input of run.inputs) {
            const before = structuredClone(state);
            expect(chooseDeadlineChoice(state, strategy)).toEqual(input);
            state = tickDeadlineChoice(state, input);
            expect(tickDeadlineChoice(JSON.parse(JSON.stringify(before)), input)).toEqual(state);
            expect(before.tick).toBe(state.tick - 1);
          }
          expect(summarizeDeadlineChoice(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(run.result.net).toBe(
            run.result.shippedValue - item.rules.nextPeriodStaminaCost * run.result.staminaSpent,
          );
          expect(run.result.staminaSpent).toBe(
            deadlineChoiceResources.stamina - run.result.stamina,
          );
          expect(tickDeadlineChoice(state, { type: 'work', id: 'campaign' })).toBe(state);
        }
      }
    }
  });
});
