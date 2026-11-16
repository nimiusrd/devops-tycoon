import { describe, expect, it } from 'vitest';
import {
  applyOnCallRotation as apply,
  assignOnCall,
  baselineOnCallRules,
  chooseOnCallAction,
  compareOnCallFactorReversals,
  compareOnCallRotations,
  createOnCallRotation as create,
  summarizeOnCallRotation,
  viewOnCallRotation,
} from './onCallRotation';
import comparison from '../../docs/prototypes/oncall-rotation-comparison.json';
import factors from '../../docs/prototypes/oncall-rotation-factor-comparison.json';

describe('RI-221 当番の持ち回り', () => {
  it('当番、期間、通常作業へ残る余力を事前に示す', () => {
    const first = create('RI-221', 'quiet');
    expect(create('RI-221', 'quiet')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewOnCallRotation(first);
    for (let i = 0; i < 8; i++) expect(viewOnCallRotation(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ onCall: null, period: 0, horizon: 2, ordinaryCapacity: 6 });
    const ace = apply(first, { type: 'assign', id: 'ace' });
    expect(viewOnCallRotation(ace)).toMatchObject({
      onCall: 'ace',
      period: 1,
      ordinaryCapacity: 2,
    });
  });

  it('同じ期間に二人を当番にせず、消耗と経験は一度だけ足す', () => {
    const fresh = create('RI-221', 'mixed');
    expect(assignOnCall(fresh, ['ace', 'jun'])).toBe(fresh);
    expect(assignOnCall(fresh, [])).toBe(fresh);
    const once = apply(fresh, { type: 'assign', id: 'jun' });
    expect(once.people).toEqual([
      expect.objectContaining({ id: 'ace', fatigue: 0, experience: 0 }),
      expect.objectContaining({ id: 'jun', fatigue: 1, experience: 1 }),
    ]);
    expect(once.incidentLeft).toBe(3);
    const twice = apply(once, { type: 'assign', id: 'ace' });
    expect(twice.people).toEqual([
      expect.objectContaining({ id: 'ace', fatigue: 2, experience: 0 }),
      expect.objectContaining({ id: 'jun', fatigue: 1, experience: 1 }),
    ]);
    expect(twice.incidentLeft).toBe(0);
    expect(apply(twice, { type: 'view' })).toBe(twice);
  });

  it('未解決の罰は期末に確定するまで集計しない', () => {
    const initial = create('RI-221', 'severe');
    expect(summarizeOnCallRotation(initial)).toMatchObject({
      unresolved: 0,
      score: 0,
      lost: false,
    });
    const mid = apply(initial, { type: 'assign', id: 'jun' });
    expect(mid.tick).toBeLessThan(mid.horizon);
    expect(mid.penaltyApplied).toBe(false);
    expect(summarizeOnCallRotation(mid)).toMatchObject({ unresolved: 0, incidentLeft: 4 });
  });

  it('同じ人を当番に固定でき、未解決でも敗北にしない', () => {
    let ace = create('RI-221', 'severe');
    while (ace.tick < ace.horizon) ace = apply(ace, { type: 'assign', id: 'ace' });
    expect(ace.inputs).toEqual([
      { type: 'assign', id: 'ace' },
      { type: 'assign', id: 'ace' },
    ]);
    expect(summarizeOnCallRotation(ace).lost).toBe(false);
    const junior = compareOnCallRotations('RI-221').find(
      (row) => row.board === 'severe' && row.strategy === 'junior',
    )!;
    expect(junior.result.score).toBeLessThan(0);
    expect(junior.result.lost).toBe(false);
    expect(summarizeOnCallRotation(ace)).toEqual(summarizeOnCallRotation(ace));
  });

  it('静穏は新人、重大は主力、中間は持ち回りの差引が上回る', () => {
    const rows = compareOnCallRotations(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('quiet', 'junior'), score('quiet', 'rotate'), score('quiet', 'ace')]).toEqual([
      6, 3, 0,
    ]);
    expect([score('severe', 'ace'), score('severe', 'junior'), score('severe', 'rotate')]).toEqual([
      0, -6, -9,
    ]);
    expect([score('mixed', 'rotate'), score('mixed', 'ace'), score('mixed', 'junior')]).toEqual([
      3, 0, -2,
    ]);
    const rotated = rows.find((row) => row.board === 'mixed' && row.strategy === 'rotate')!;
    expect(rotated.result.experience).toEqual([
      { id: 'ace', experience: 0 },
      { id: 'jun', experience: 1 },
    ]);
    expect(rotated.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareOnCallRotations(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseOnCallAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeOnCallRotation(live)).toEqual(row.result);
    }
  });
});

describe('RI-221 要因の反転', () => {
  const orderText = (order: readonly (readonly string[])[]) =>
    order.map((group) => group.join('=')).join('>');

  const scoresOf = (axis: keyof typeof factors.sweeps) =>
    factors.sweeps[axis].map((point) => [
      point.parameter,
      ...point.boards.flatMap((board) => [
        board.scores.ace,
        board.scores.junior,
        board.scores.rotate,
        orderText(board.order),
      ]),
    ]);

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareOnCallFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-221',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baseline).toEqual(baselineOnCallRules);
    expect(scoresOf('occurTick')).toEqual([
      [
        '0',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        -6,
        -9,
        'ace>junior>rotate',
        0,
        -2,
        3,
        'rotate>ace>junior',
      ],
      [
        '1',
        0,
        6,
        3,
        'junior>rotate>ace',
        -12,
        -6,
        -9,
        'junior>rotate>ace',
        -8,
        -2,
        -5,
        'junior>rotate>ace',
      ],
      [
        '2',
        0,
        6,
        3,
        'junior>rotate>ace',
        -12,
        -6,
        -9,
        'junior>rotate>ace',
        -8,
        -2,
        -5,
        'junior>rotate>ace',
      ],
    ]);
    expect(scoresOf('recover')).toEqual([
      [
        '0',
        0,
        6,
        3,
        'junior>rotate>ace',
        -12,
        -6,
        -9,
        'junior>rotate>ace',
        0,
        -2,
        -5,
        'ace>junior>rotate',
      ],
      [
        '1',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        -6,
        -9,
        'ace>junior>rotate',
        0,
        -2,
        3,
        'rotate>ace>junior',
      ],
      [
        '2',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        -6,
        3,
        'rotate>ace>junior',
        0,
        6,
        3,
        'junior>rotate>ace',
      ],
      [
        '3',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        6,
        3,
        'junior>rotate>ace',
      ],
      [
        '4',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        6,
        3,
        'junior>rotate>ace',
      ],
    ]);
    expect(scoresOf('fatigue')).toEqual([
      [
        '0',
        4,
        6,
        5,
        'junior>rotate>ace',
        4,
        -6,
        -7,
        'ace>junior>rotate',
        4,
        -2,
        5,
        'rotate>ace>junior',
      ],
      [
        '1',
        2,
        6,
        4,
        'junior>rotate>ace',
        2,
        -6,
        -8,
        'ace>junior>rotate',
        2,
        -2,
        4,
        'rotate>ace>junior',
      ],
      [
        '2',
        0,
        6,
        3,
        'junior>rotate>ace',
        0,
        -6,
        -9,
        'ace>junior>rotate',
        0,
        -2,
        3,
        'rotate>ace>junior',
      ],
      [
        '3',
        -2,
        6,
        2,
        'junior>rotate>ace',
        -2,
        -6,
        -10,
        'ace>junior>rotate',
        -2,
        -2,
        2,
        'rotate>ace=junior',
      ],
      [
        '4',
        -4,
        6,
        1,
        'junior>rotate>ace',
        -4,
        -6,
        -11,
        'ace>junior>rotate',
        -4,
        -2,
        1,
        'rotate>junior>ace',
      ],
      [
        '5',
        -6,
        6,
        0,
        'junior>rotate>ace',
        -6,
        -6,
        -12,
        'ace=junior>rotate',
        -6,
        -2,
        0,
        'rotate>junior>ace',
      ],
      [
        '6',
        -8,
        6,
        -1,
        'junior>rotate>ace',
        -8,
        -6,
        -13,
        'junior>ace>rotate',
        -8,
        -2,
        -1,
        'rotate>junior>ace',
      ],
      [
        '7',
        -10,
        6,
        -2,
        'junior>rotate>ace',
        -10,
        -6,
        -14,
        'junior>ace>rotate',
        -10,
        -2,
        -2,
        'junior=rotate>ace',
      ],
      [
        '8',
        -12,
        6,
        -3,
        'junior>rotate>ace',
        -12,
        -6,
        -15,
        'junior>ace>rotate',
        -12,
        -2,
        -3,
        'junior>rotate>ace',
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        orderText(item.before.order),
        item.after.parameter,
        orderText(item.after.order),
      ]),
    ).toEqual([
      ['occurTick', 'severe', '0', 'ace>junior>rotate', '1', 'junior>rotate>ace'],
      ['occurTick', 'mixed', '0', 'rotate>ace>junior', '1', 'junior>rotate>ace'],
      ['recover', 'severe', '0', 'junior>rotate>ace', '1', 'ace>junior>rotate'],
      ['recover', 'mixed', '0', 'ace>junior>rotate', '1', 'rotate>ace>junior'],
      ['recover', 'severe', '1', 'ace>junior>rotate', '2', 'rotate>ace>junior'],
      ['recover', 'mixed', '1', 'rotate>ace>junior', '2', 'junior>rotate>ace'],
      ['recover', 'severe', '2', 'rotate>ace>junior', '3', 'junior>rotate>ace'],
      ['fatigue', 'mixed', '2', 'rotate>ace>junior', '3', 'rotate>ace=junior'],
      ['fatigue', 'mixed', '3', 'rotate>ace=junior', '4', 'rotate>junior>ace'],
      ['fatigue', 'severe', '4', 'ace>junior>rotate', '5', 'ace=junior>rotate'],
      ['fatigue', 'severe', '5', 'ace=junior>rotate', '6', 'junior>ace>rotate'],
      ['fatigue', 'mixed', '6', 'rotate>junior>ace', '7', 'junior=rotate>ace'],
      ['fatigue', 'mixed', '7', 'junior=rotate>ace', '8', 'junior>rotate>ace'],
    ]);
    expect(data.reversals.some((item) => item.board === 'quiet')).toBe(false);
  });

  it('基準行は初回の3戦略と一致し、動かした規則は一つである', () => {
    const data = compareOnCallFactorReversals();
    const first = compareOnCallRotations(comparison.seed);
    const baselines = [
      data.sweeps.occurTick.find((item) => item.parameter === '0'),
      data.sweeps.recover.find((item) => item.parameter === '1'),
      data.sweeps.fatigue.find((item) => item.parameter === '2'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual({ occurTick: 0, juniorRecover: 1, aceFatigue: 2 });
      for (const board of point.boards) {
        for (const run of board.runs) {
          const original = first.find(
            (row) => row.board === board.board && row.strategy === run.strategy,
          );
          if (!original) throw new Error(`${board.board}:${run.strategy}`);
          expect(run.inputs).toEqual(original.inputs);
          expect(run.result).toEqual(original.result);
        }
      }
    }
    expect(Object.keys(data.sweeps)).toEqual(['occurTick', 'recover', 'fatigue']);
    for (const point of data.sweeps.occurTick) {
      expect(point.rules).toEqual({
        occurTick: Number(point.parameter),
        juniorRecover: 1,
        aceFatigue: 2,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '0');
    }
    for (const point of data.sweeps.recover) {
      expect(point.rules).toEqual({
        occurTick: 0,
        juniorRecover: Number(point.parameter),
        aceFatigue: 2,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '1');
    }
    for (const point of data.sweeps.fatigue) {
      expect(point.rules).toEqual({
        occurTick: 0,
        juniorRecover: 1,
        aceFatigue: Number(point.parameter),
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '2');
    }
    for (const board of ['quiet', 'severe', 'mixed'] as const) {
      const initial = create(comparison.seed, board);
      const recorded = data.conditions.boards[board];
      expect(initial.horizon).toBe(recorded.horizon);
      expect(initial.incidentTotal).toBe(recorded.incident);
      expect(initial.penalty).toBe(recorded.penalty);
      expect(recorded.people).toEqual(
        initial.people.map((candidate) => ({
          id: candidate.id,
          ship: candidate.ship,
          recover: candidate.recover,
          fatigueRate: candidate.fatigueRate,
        })),
      );
    }
  });

  it('発生前は復旧せず、復旧の差と主力の消耗だけが計算に入る', () => {
    const data = compareOnCallFactorReversals();
    for (const point of data.sweeps.occurTick) {
      const periods = [0, 1].filter((tick) => tick >= Number(point.parameter)).length;
      const severe = point.boards.find((board) => board.board === 'severe');
      const ace = severe?.runs.find((run) => run.strategy === 'ace');
      if (!ace) throw new Error(point.parameter);
      expect(ace.result.incidentLeft).toBe(Math.max(0, 5 - periods * 3));
      expect(ace.result.shipped).toBe(4);
      expect(ace.result.fatigue).toBe(4);
    }
    for (const point of data.sweeps.recover) {
      const aceRecover = Number(point.parameter) + 2;
      const severe = point.boards.find((board) => board.board === 'severe');
      const ace = severe?.runs.find((run) => run.strategy === 'ace');
      if (!ace) throw new Error(point.parameter);
      expect(ace.result.incidentLeft).toBe(Math.max(0, 5 - 2 * aceRecover));
    }
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const run of board.runs) {
          const shipped = run.strategy === 'ace' ? 4 : run.strategy === 'junior' ? 8 : 6;
          expect(run.result.shipped).toBe(shipped);
          expect(run.result.lost).toBe(false);
        }
      }
    }
    for (const point of data.sweeps.fatigue) {
      const fatigue = Number(point.parameter);
      for (const board of point.boards) {
        expect(board.runs.find((run) => run.strategy === 'ace')?.result.fatigue).toBe(2 * fatigue);
        expect(board.runs.find((run) => run.strategy === 'junior')?.result.fatigue).toBe(2);
        expect(board.runs.find((run) => run.strategy === 'rotate')?.result.fatigue).toBe(
          1 + fatigue,
        );
      }
    }
  });

  it('閲覧の消耗率は初回のままで、不正な係数は基準へ戻る', () => {
    const rules = { occurTick: 1, juniorRecover: 4, aceFatigue: 8 };
    const first = apply(create('RI-221', 'severe'), { type: 'assign', id: 'ace' }, rules);
    expect(first.incidentLeft).toBe(5);
    expect(first.people).toEqual([
      expect.objectContaining({ id: 'ace', ship: 4, recover: 3, fatigueRate: 2, fatigue: 8 }),
      expect.objectContaining({ id: 'jun', ship: 2, recover: 1, fatigueRate: 1, fatigue: 0 }),
    ]);
    expect(viewOnCallRotation(first).activeFatigueRate).toBe(2);
    const second = apply(first, { type: 'assign', id: 'ace' }, rules);
    expect(second.incidentLeft).toBe(0);
    expect(second.people[0]).toMatchObject({ recover: 3, fatigueRate: 2, fatigue: 16 });
    const fallback = apply(
      create('RI-221', 'severe'),
      { type: 'assign', id: 'ace' },
      {
        occurTick: -1,
        juniorRecover: 1.5,
        aceFatigue: Number.NaN,
      },
    );
    const baseline = apply(create('RI-221', 'severe'), { type: 'assign', id: 'ace' });
    expect(fallback.incidentLeft).toBe(baseline.incidentLeft);
    expect(fallback.people).toEqual(baseline.people);
  });

  it('要因比較の入力を再生すると差引が一致し、元状態は変わらない', () => {
    const data = compareOnCallFactorReversals();
    const first = compareOnCallRotations(comparison.seed);
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const run of board.runs) {
          const original = first.find(
            (row) => row.board === board.board && row.strategy === run.strategy,
          );
          expect(original?.inputs).toEqual(run.inputs);
          let state = create(data.conditions.seed, board.board);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseOnCallAction(state, run.strategy)).toEqual(input);
            state = apply(state, input, point.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, point.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeOnCallRotation(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'assign', id: 'ace' }, point.rules)).toBe(state);
          expect(state.people.map((candidate) => candidate.fatigueRate)).toEqual([2, 1]);
          expect(state.people.map((candidate) => candidate.recover)).toEqual([3, 1]);
        }
      }
    }
  });
});
