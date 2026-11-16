import { describe, expect, it } from 'vitest';
import {
  applyImprovementLead as apply,
  assignLead,
  chooseLeadAction,
  baselineLeadRules,
  compareImprovementLeadFactors,
  compareImprovementLeads,
  createImprovementLead as create,
  createLeadFactorState,
  summarizeImprovementLead,
  viewImprovementLead,
} from './improvementLead';
import comparison from '../../docs/prototypes/improvement-lead-comparison.json';
import factors from '../../docs/prototypes/improvement-lead-factor-comparison.json';

describe('RI-223 改善の旗振り役', () => {
  it('進捗、再開、現場の危機を操作前に示す', () => {
    const first = create('RI-223', 'near');
    expect(create('RI-223', 'near')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewImprovementLead(first);
    for (let i = 0; i < 8; i++) expect(viewImprovementLead(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      assignee: 'lead',
      progress: 3,
      need: 4,
      remaining: 1,
      restartPending: false,
      periodsOnImprovement: 0,
      crisis: false,
      shipIfField: 4,
      advanceIfImprove: 1,
    });
    expect(viewImprovementLead(create('RI-223', 'urgent'))).toMatchObject({
      crisis: true,
      penaltyIfImprove: 16,
      progress: 2,
    });
  });

  it('専任中は出荷せず、中断の再開は進捗を進めず、担当変更では完成しない', () => {
    const fresh = create('RI-223', 'near');
    expect(apply(fresh, { type: 'swap' })).toBe(fresh);
    expect(assignLead(fresh, 'other')).toBe(fresh);
    const improving = apply(fresh, { type: 'assign', mode: 'improve' });
    expect(summarizeImprovementLead(improving)).toMatchObject({
      shipped: 0,
      improvement: 18,
      periods: 1,
      progress: 4,
      completed: true,
    });
    const again = apply(improving, { type: 'assign', mode: 'improve' });
    expect(again.improvementValue).toBe(18);
    expect(again.shipped).toBe(0);
    expect(again.periodsOnImprovement).toBe(2);

    const urgent = create('RI-223', 'urgent');
    const paused = apply(urgent, { type: 'assign', mode: 'field' });
    expect(paused).toMatchObject({ shipped: 4, progress: 2, restartPending: true, penalty: 0 });
    const restarted = apply(paused, { type: 'assign', mode: 'improve' });
    expect(restarted).toMatchObject({
      progress: 2,
      restartPending: false,
      completed: false,
      shipped: 4,
      periodsOnImprovement: 1,
    });
    expect(apply(restarted, { type: 'view' })).toBe(restarted);
  });

  it('完成間近は継続、現場の危機は中断、改善価値が低い盤面は現場が上回る', () => {
    const rows = compareImprovementLeads(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('near', 'finish'), score('near', 'field'), score('near', 'pause')]).toEqual([
      22, 8, 4,
    ]);
    expect([score('urgent', 'pause'), score('urgent', 'field'), score('urgent', 'finish')]).toEqual(
      [22, 16, 10],
    );
    expect([score('calm', 'field'), score('calm', 'finish'), score('calm', 'pause')]).toEqual([
      16, 10, 4,
    ]);
    const finished = rows.find((row) => row.board === 'urgent' && row.strategy === 'finish')!;
    expect(finished.result).toMatchObject({
      completed: true,
      penalty: 16,
      periods: 2,
      lost: false,
    });
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareImprovementLeads(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseLeadAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeImprovementLead(live)).toEqual(row.result);
    }
  });
});

describe('RI-223 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareImprovementLeadFactors();
    expect(data).toEqual(factors);
    const scores = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point) => [
        point.parameter,
        ...point.boards.flatMap((board) => [
          board.scores.finish,
          board.scores.pause,
          board.scores.field,
          board.order,
        ]),
      ]);
    expect(data.conditions).toMatchObject({
      seed: 'RI-223',
      assignee: 'lead',
      shipRate: 4,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baseline).toEqual(baselineLeadRules);
    expect(data.conditions.boards.near).toMatchObject({ start: 3, horizon: 2, crisisTick: null });
    expect(data.conditions.boards.urgent).toMatchObject({
      start: 2,
      horizon: 4,
      crisisTick: 0,
      crisisPenalty: 16,
    });
    expect(data.conditions.boards.calm).toMatchObject({ start: 0, horizon: 4, crisisTick: null });
    expect(scores('need')).toEqual([
      [
        '2',
        8,
        8,
        8,
        'finish=pause=field',
        16,
        16,
        16,
        'finish=pause=field',
        18,
        18,
        16,
        'finish=pause>field',
      ],
      [
        '3',
        8,
        8,
        8,
        'finish=pause=field',
        14,
        26,
        16,
        'pause>field>finish',
        14,
        14,
        16,
        'field>finish=pause',
      ],
      [
        '4',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        22,
        16,
        'pause>field>finish',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '5',
        18,
        4,
        8,
        'finish>field>pause',
        6,
        4,
        16,
        'field>finish>pause',
        0,
        4,
        16,
        'field>pause>finish',
      ],
      [
        '6',
        0,
        4,
        8,
        'field>pause>finish',
        2,
        4,
        16,
        'field>pause>finish',
        0,
        4,
        16,
        'field>pause>finish',
      ],
    ]);
    expect(scores('restartCost')).toEqual([
      [
        '0',
        22,
        22,
        8,
        'finish=pause>field',
        10,
        26,
        16,
        'pause>field>finish',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '1',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        22,
        16,
        'pause>field>finish',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '2',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        4,
        16,
        'field>finish>pause',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '3',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        4,
        16,
        'field>finish>pause',
        10,
        4,
        16,
        'field>finish>pause',
      ],
    ]);
    expect(scores('crisisTick')).toEqual([
      [
        'none',
        22,
        4,
        8,
        'finish>field>pause',
        26,
        22,
        16,
        'finish>pause>field',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '0',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        22,
        16,
        'pause>field>finish',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '1',
        22,
        4,
        8,
        'finish>field>pause',
        10,
        6,
        16,
        'field>finish>pause',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '2',
        22,
        4,
        8,
        'finish>field>pause',
        26,
        6,
        16,
        'finish>field>pause',
        10,
        4,
        16,
        'field>finish>pause',
      ],
      [
        '3',
        22,
        4,
        8,
        'finish>field>pause',
        26,
        6,
        16,
        'finish>field>pause',
        10,
        4,
        16,
        'field>finish>pause',
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.order,
        item.after.parameter,
        item.after.order,
      ]),
    ).toEqual([
      ['need', 'urgent', '2', 'finish=pause=field', '3', 'pause>field>finish'],
      ['need', 'calm', '2', 'finish=pause>field', '3', 'field>finish=pause'],
      ['need', 'near', '3', 'finish=pause=field', '4', 'finish>field>pause'],
      ['need', 'calm', '3', 'field>finish=pause', '4', 'field>finish>pause'],
      ['need', 'urgent', '4', 'pause>field>finish', '5', 'field>finish>pause'],
      ['need', 'calm', '4', 'field>finish>pause', '5', 'field>pause>finish'],
      ['need', 'near', '5', 'finish>field>pause', '6', 'field>pause>finish'],
      ['need', 'urgent', '5', 'field>finish>pause', '6', 'field>pause>finish'],
      ['restartCost', 'near', '0', 'finish=pause>field', '1', 'finish>field>pause'],
      ['restartCost', 'urgent', '1', 'pause>field>finish', '2', 'field>finish>pause'],
      ['crisisTick', 'urgent', 'none', 'finish>pause>field', '0', 'pause>field>finish'],
      ['crisisTick', 'urgent', '0', 'pause>field>finish', '1', 'field>finish>pause'],
      ['crisisTick', 'urgent', '1', 'field>finish>pause', '2', 'finish>field>pause'],
    ]);
    expect(
      data.reversals.some((item) => item.axis === 'restartCost' && item.board === 'calm'),
    ).toBe(false);
    expect(
      data.reversals.some(
        (item) => item.axis === 'crisisTick' && (item.board === 'near' || item.board === 'calm'),
      ),
    ).toBe(false);
  });

  it('基準行は初回の3戦略と一致し、動かした規則は一つである', () => {
    const data = compareImprovementLeadFactors();
    const first = compareImprovementLeads(comparison.seed);
    const baselines = [
      data.sweeps.need.find((item) => item.parameter === '4'),
      data.sweeps.restartCost.find((item) => item.parameter === '1'),
      data.sweeps.crisisTick.find((item) => item.parameter === '0'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual({ need: 4, restartCost: 1, urgentCrisisTick: 0 });
      for (const board of point.boards) {
        for (const strategy of ['finish', 'pause', 'field'] as const) {
          const recorded = first.find(
            (row) => row.board === board.board && row.strategy === strategy,
          );
          if (!recorded) throw new Error(`${board.board}:${strategy}`);
          expect(board[strategy].inputs).toEqual(recorded.inputs);
          expect(board[strategy].result).toEqual(recorded.result);
        }
      }
    }
    expect(Object.keys(data.sweeps)).toEqual(['need', 'restartCost', 'crisisTick']);
    for (const point of data.sweeps.need) {
      expect(point.rules).toEqual({
        need: Number(point.parameter),
        restartCost: 1,
        urgentCrisisTick: 0,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '4');
    }
    for (const point of data.sweeps.restartCost) {
      expect(point.rules).toEqual({
        need: 4,
        restartCost: Number(point.parameter),
        urgentCrisisTick: 0,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '1');
    }
    for (const point of data.sweeps.crisisTick) {
      const urgentCrisisTick = point.parameter === 'none' ? null : Number(point.parameter);
      expect(point.rules).toEqual({ need: 4, restartCost: 1, urgentCrisisTick });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '0');
    }
    for (const board of ['near', 'urgent', 'calm'] as const) {
      const initial = create(comparison.seed, board);
      const recorded = data.conditions.boards[board];
      expect(initial.progress).toBe(recorded.start);
      expect(initial.value).toBe(recorded.value);
      expect(initial.horizon).toBe(recorded.horizon);
      expect(initial.crisisTick).toBe(recorded.crisisTick);
      expect(initial.crisisPenalty).toBe(recorded.crisisPenalty);
      expect(initial.shipRate).toBe(recorded.shipRate);
      expect(initial.need).toBe(4);
    }
    const restartBase = data.sweeps.restartCost.find((point) => point.parameter === '1');
    if (!restartBase) throw new Error('restart');
    for (const point of data.sweeps.restartCost) {
      for (const board of point.boards) {
        const base = restartBase.boards.find((item) => item.board === board.board);
        if (!base) throw new Error(board.board);
        expect(board.scores.finish).toBe(base.scores.finish);
        expect(board.scores.field).toBe(base.scores.field);
      }
      const calm = point.boards.find((board) => board.board === 'calm');
      expect(calm?.order).toBe('field>finish>pause');
    }
  });

  it('目標以下では価値が入らず、危機の位置は現場の危機だけを動かす', () => {
    const data = compareImprovementLeadFactors();
    const at = (axis: keyof typeof data.sweeps, parameter: string, boardName: string) => {
      const point = data.sweeps[axis].find((item) => item.parameter === parameter);
      const board = point?.boards.find((item) => item.board === boardName);
      if (!point || !board) throw new Error(`${axis}:${parameter}:${boardName}`);
      return board;
    };
    expect(at('need', '3', 'near').finish.result).toMatchObject({
      completed: false,
      improvement: 0,
      shipped: 8,
      penalty: 0,
      score: 8,
    });
    expect(at('need', '6', 'near').finish.result).toMatchObject({
      completed: false,
      progress: 5,
      improvement: 0,
      shipped: 0,
      score: 0,
    });
    expect(at('need', '2', 'urgent').field.result).toMatchObject({
      shipped: 16,
      improvement: 0,
      penalty: 0,
      score: 16,
    });
    expect(at('restartCost', '0', 'near').pause.result).toMatchObject({
      completed: true,
      improvement: 18,
      shipped: 4,
      restartPending: false,
      score: 22,
    });
    expect(at('restartCost', '2', 'urgent').pause.result).toMatchObject({
      completed: false,
      progress: 3,
      improvement: 0,
      shipped: 4,
      penalty: 0,
      periods: 3,
      score: 4,
    });
    expect(at('crisisTick', '2', 'urgent').finish.result).toMatchObject({
      penalty: 0,
      improvement: 18,
      shipped: 8,
      completed: true,
      score: 26,
    });
    expect(at('crisisTick', '2', 'urgent').pause.result).toMatchObject({
      penalty: 16,
      completed: true,
      score: 6,
    });
    expect(at('crisisTick', '1', 'urgent').pause.result.penalty).toBe(16);
    expect(at('crisisTick', 'none', 'near').scores).toEqual(at('crisisTick', '3', 'near').scores);
    expect(at('crisisTick', 'none', 'calm').scores).toEqual(at('crisisTick', '3', 'calm').scores);
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) expect(board.finish.result.lost).toBe(false);
    }
  });

  it('要因比較の入力を再生すると差引が一致し、閲覧は初回の盤面のまま', () => {
    const freshNear = create(comparison.seed, 'near');
    const freshUrgent = create(comparison.seed, 'urgent');
    const data = compareImprovementLeadFactors();
    for (const point of Object.values(data.sweeps).flat()) {
      const rules = {
        need: point.rules.need,
        restartCost: point.rules.restartCost,
        urgentCrisisTick: point.rules.urgentCrisisTick,
      };
      for (const board of point.boards) {
        if (board.board !== 'near' && board.board !== 'urgent' && board.board !== 'calm') {
          throw new Error(board.board);
        }
        for (const strategy of ['finish', 'pause', 'field'] as const) {
          const run = board[strategy];
          let state = createLeadFactorState(board.board, rules);
          const snapshot = structuredClone(state);
          expect(state.progress).toBe(data.conditions.boards[board.board].start);
          expect(state.value).toBe(data.conditions.boards[board.board].value);
          expect(state.shipRate).toBe(4);
          expect(state.need).toBe(rules.need);
          expect(state.crisisTick).toBe(board.board === 'urgent' ? rules.urgentCrisisTick : null);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseLeadAction(state, strategy)).toEqual(input);
            state = apply(state, input, rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeImprovementLead(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'assign', mode: 'improve' }, rules)).toBe(state);
          expect(apply(state, { type: 'swap' }, rules)).toBe(state);
        }
      }
    }
    expect(viewImprovementLead(freshNear)).toMatchObject({
      progress: 3,
      need: 4,
      crisis: false,
      shipIfField: 4,
      penaltyIfImprove: 0,
    });
    expect(viewImprovementLead(freshUrgent)).toMatchObject({
      progress: 2,
      need: 4,
      crisis: true,
      penaltyIfImprove: 16,
    });
    expect(freshNear).toEqual(create(comparison.seed, 'near'));
    expect(
      apply(freshUrgent, { type: 'view' }, { need: 6, restartCost: 3, urgentCrisisTick: 2 }),
    ).toBe(freshUrgent);
  });
});
