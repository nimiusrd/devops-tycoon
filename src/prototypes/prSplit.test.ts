import { describe, expect, it } from 'vitest';
import {
  applySplitInput,
  createSplitPrototype,
  compareSplitStrategies,
  compareSplitSensitivities,
  realizeSplitValue,
  runSplitScenario,
  summarizeSplit,
  type SplitScenarioParams,
} from './prSplit';
import comparison from '../../docs/prototypes/pr-split-comparison.json';
import factors from '../../docs/prototypes/pr-split-factor-comparison.json';
describe('RI-166 子タスクへのPR分割', () => {
  it('系譜・価値保存・追加工数・巻き戻しを記録し、再分割しない', () => {
    const initial = createSplitPrototype('RI-166');
    const snapshot = structuredClone(initial);
    const split = applySplitInput(initial, { type: 'split', id: 'parent' });
    expect(split.tasks[0].children).toEqual(['split-1', 'split-2', 'split-3']);
    expect(split.tasks.slice(1).every((t) => t.parentId === 'parent')).toBe(true);
    expect(split.tasks.slice(1).reduce((n, t) => n + t.value, 0)).toBe(12);
    expect(split.tasks.slice(1).reduce((n, t) => n + t.workLeft, 0)).toBe(8);
    expect(split.discardedWork).toBe(2);
    expect(applySplitInput(split, { type: 'split', id: 'parent' })).toBe(split);
    expect(applySplitInput(split, { type: 'split', id: 'split-1' })).toBe(split);
    expect(initial).toEqual(snapshot);
  });
  it('採番は既存IDを避け、未知・資源不足・期末は無消費で拒否する', () => {
    const initial = createSplitPrototype('RI-166');
    initial.tasks.push({ ...initial.tasks[0], id: 'split-1' });
    const split = applySplitInput(initial, { type: 'split', id: 'parent' });
    expect(new Set(split.tasks.map((t) => t.id)).size).toBe(split.tasks.length);
    expect(split.tasks[0].children).toEqual(['split-2', 'split-3', 'split-4']);
    expect(applySplitInput(initial, { type: 'split', id: 'missing' })).toBe(initial);
    const poor = { ...initial, focus: 1 };
    expect(applySplitInput(poor, { type: 'split', id: 'parent' })).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applySplitInput(ended, { type: 'work', id: 'parent' })).toBe(ended);
  });
  it('子の出荷前に統合できず、統合失敗でも先行成果を失わない', () => {
    let state = applySplitInput(createSplitPrototype('RI-166', 10, true), {
      type: 'split',
      id: 'parent',
    });
    expect(applySplitInput(state, { type: 'work', id: 'split-3' })).toBe(state);
    for (const id of ['split-1', 'split-2'])
      for (let i = 0; i < 3; i++) state = applySplitInput(state, { type: 'work', id });
    for (let i = 0; i < 2; i++) state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(summarizeSplit(state)).toMatchObject({
      value: 8,
      failures: 1,
      remaining: [{ id: 'split-3', workLeft: 2 }],
    });
    expect(applySplitInput(state, { type: 'work', id: 'split-1' })).toBe(state);
    for (let i = 0; i < 2; i++) state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(summarizeSplit(state)).toMatchObject({ value: 12, failures: 1, remaining: [] });
  });
  it('期末が近いと分割、余裕があると単一PRが有利になる', () => {
    const rows = compareSplitStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[1].result.netValue).toBeGreaterThan(rows[0].result.netValue);
    expect(rows[4].result.netValue).toBeGreaterThan(rows[5].result.netValue);
  });
  it('全比較を毎入力保存再開・再生し、元状態を変更しない', () => {
    for (const row of compareSplitStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applySplitInput(live, input);
        expect(previous).toEqual(before);
        restored = applySplitInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeSplit(live)).toEqual(row.result);
    }
  });
  it('1工数の同時作業は単発の作業と同じ進みで、過剰・空・期末は無消費で拒否する', () => {
    const initial = createSplitPrototype('RI-166', 3);
    const byWork = applySplitInput(initial, { type: 'work', id: 'parent' });
    const byRound = applySplitInput(createSplitPrototype('RI-166', 3), {
      type: 'round',
      ids: ['parent'],
    });
    expect(byRound.tick).toBe(byWork.tick);
    expect(byRound.tasks).toEqual(byWork.tasks);
    expect(byRound.workSpent).toBe(byWork.workSpent);
    let stepped = createSplitPrototype('RI-166', 3);
    stepped = applySplitInput(stepped, { type: 'work', id: 'parent' });
    stepped = applySplitInput(stepped, { type: 'work', id: 'parent' });
    const parallel = applySplitInput(initial, { type: 'round', ids: ['parent', 'parent'] });
    expect(parallel.tasks[0].workLeft).toBe(stepped.tasks[0].workLeft);
    expect(parallel.workSpent).toBe(stepped.workSpent);
    expect(parallel.tick).toBe(1);
    expect(
      applySplitInput(initial, {
        type: 'round',
        ids: ['parent', 'parent', 'parent', 'parent', 'parent'],
      }),
    ).toBe(initial);
    expect(applySplitInput(initial, { type: 'round', ids: [] })).toBe(initial);
    const ended = { ...initial, tick: initial.horizon };
    expect(applySplitInput(ended, { type: 'round', ids: ['parent'] })).toBe(ended);
  });
  it('統合失敗の再作業でも出荷済みの子の価値を消さず、終わるまで統合を拒む', () => {
    let state = createSplitPrototype('RI-166', 12, true);
    state.childImpairment = 1;
    state = applySplitInput(state, { type: 'split', id: 'parent' });
    for (const id of ['split-1', 'split-2']) {
      for (let step = 0; step < 3; step++) state = applySplitInput(state, { type: 'work', id });
    }
    const shippedTick = state.tasks.find((task) => task.id === 'split-1')!.doneTick;
    state = applySplitInput(state, { type: 'work', id: 'split-3' });
    state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(summarizeSplit(state)).toMatchObject({
      value: 8,
      failures: 1,
      remaining: [
        { id: 'split-1', workLeft: 1 },
        { id: 'split-2', workLeft: 1 },
        { id: 'split-3', workLeft: 2 },
      ],
    });
    expect(state.tasks.find((task) => task.id === 'split-1')!.doneTick).toBe(shippedTick);
    expect(applySplitInput(state, { type: 'work', id: 'split-3' })).toBe(state);
    const reworked = applySplitInput(state, { type: 'work', id: 'split-1' });
    expect(reworked.tasks.find((task) => task.id === 'split-1')).toMatchObject({
      doneTick: shippedTick,
      workLeft: 0,
    });
    expect(summarizeSplit(reworked).value).toBe(8);
  });
  it('独立点は出荷時に残り、未計上分は統合完了まで差引へ入れない', () => {
    let state = applySplitInput(createSplitPrototype('RI-166', 10), {
      type: 'split',
      id: 'parent',
    });
    for (let step = 0; step < 3; step++)
      state = applySplitInput(state, { type: 'work', id: 'split-1' });
    expect(summarizeSplit(state).value).toBe(4);
    expect(realizeSplitValue(state, 0)).toBe(0);
    expect(realizeSplitValue(state, 4)).toBe(4);
    for (let step = 0; step < 3; step++)
      state = applySplitInput(state, { type: 'work', id: 'split-2' });
    for (let step = 0; step < 2; step++)
      state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(realizeSplitValue(state, 0)).toBe(12);
    expect(realizeSplitValue(state, 1)).toBe(12);
    expect(summarizeSplit(state).value).toBe(12);
  });
});

const HAND_NETS: Record<string, [number, number, number, number, number][]> = {
  independence: [
    [0, 0, -2, 12, 10],
    [1, 0, -1, 12, 10],
    [2, 0, 0, 12, 10],
    [3, 0, 1, 12, 10],
    [4, 0, 2, 12, 10],
  ],
  childImpairment: [
    [0, 0, 2, 12, 10],
    [1, 0, 2, 12, 6],
    [2, 0, 2, 12, 6],
  ],
  workers: [
    [1, 0, 2, 12, 10],
    [2, 12, 6, 12, 10],
    [3, 12, 10, 12, 10],
  ],
  carryover: [
    [1, 0, 2, 12, 10],
    [2, 12, 6, 12, 10],
  ],
  splitTiming: [
    [0, 0, 2, 12, 10],
    [1, 0, -2, 12, 10],
    [2, 0, -2, 12, 10],
    [3, 0, 0, 12, 6],
  ],
  focusOpportunity: [
    [0, 0, 4, 12, 12],
    [1, 0, 2, 12, 10],
    [2, 0, 0, 12, 8],
    [3, 0, -2, 12, 6],
  ],
};

function winnerOf(wholeNet: number, splitNet: number) {
  if (splitNet > wholeNet) return 'split' as const;
  if (splitNet < wholeNet) return 'whole' as const;
  return 'tie' as const;
}

const BASELINE_LEVEL = {
  independence: 4,
  childImpairment: 0,
  workers: 1,
  carryover: 1,
  splitTiming: 0,
  focusOpportunity: 1,
} as const;

describe('RI-166 一因子の優劣反転', () => {
  const data = compareSplitSensitivities('RI-166');

  it('比較条件・入力列・結果はJSONと再計算が一致する', () => {
    expect(factors.seed).toBe('RI-166');
    expect(factors.note).toContain('固定戦略');
    expect(factors.note).toContain('人間のプレイ評価はしていない');
    expect(data).toEqual(factors);
  });

  it('手計算した差引と一致し、基準水準は初回の優劣のまま', () => {
    const actual = data.pairs.map((pair) => ({
      factor: pair.factor,
      level: pair.level,
      horizon: pair.horizon,
      wholeNet: pair.wholeNet,
      splitNet: pair.splitNet,
      winner: pair.winner,
    }));
    const expected = Object.entries(HAND_NETS).flatMap(([factor, rows]) =>
      rows.flatMap(([level, whole3, split3, whole10, split10]) => [
        {
          factor,
          level,
          horizon: 3,
          wholeNet: whole3,
          splitNet: split3,
          winner: winnerOf(whole3, split3),
        },
        {
          factor,
          level,
          horizon: 10,
          wholeNet: whole10,
          splitNet: split10,
          winner: winnerOf(whole10, split10),
        },
      ]),
    );
    expect(actual).toEqual(expected);
    for (const pair of data.pairs) {
      if (pair.level !== BASELINE_LEVEL[pair.factor]) continue;
      expect(pair.winner).toBe(pair.anchor);
      expect(pair.reversed).toBe(false);
      expect(pair.advantageChanged).toBe(false);
    }
    const focusTie = data.rows.filter(
      (row) => row.factor === 'focusOpportunity' && row.level === 0 && row.horizon === 10,
    );
    expect(focusTie.find((row) => row.strategy === 'whole')!.result.workSpent).toBe(6);
    expect(focusTie.find((row) => row.strategy === 'split')!.result.workSpent).toBe(10);
  });

  it('各因子は一つの入力だけを動かし、出荷台帳と期末残工数を残す', () => {
    expect(data.note).toContain('固定戦略');
    expect(data.note).toContain('人間のプレイ評価はしていない');
    for (const factor of data.factors) {
      const rows = data.rows.filter((row) => row.factor === factor.id);
      expect(rows.map((row) => row[factor.varies])).toEqual(
        factor.levels.flatMap((level) => [level, level, level, level]),
      );
      for (const row of rows) {
        for (const [key, value] of Object.entries(factor.held)) {
          expect(row[key as keyof SplitScenarioParams]).toBe(value);
        }
      }
    }
    for (const level of [0, 1, 2, 3, 4]) {
      const split = data.rows.find(
        (row) =>
          row.factor === 'independence' &&
          row.level === level &&
          row.horizon === 3 &&
          row.strategy === 'split',
      )!;
      expect(split.result.nominalValue).toBe(4);
      expect(split.result.realizedValue).toBe(level);
    }
    const impaired = data.rows.find(
      (row) =>
        row.factor === 'childImpairment' &&
        row.level === 1 &&
        row.horizon === 10 &&
        row.strategy === 'split',
    )!;
    expect(impaired.result.nominalValue).toBe(8);
    expect(impaired.result.shipped.map((item) => item.value)).toEqual([4, 4]);
    expect(impaired.result.remaining).toEqual([{ id: 'split-3', workLeft: 2 }]);
    const impairedMore = data.rows.find(
      (row) =>
        row.factor === 'childImpairment' &&
        row.level === 2 &&
        row.horizon === 10 &&
        row.strategy === 'split',
    )!;
    expect(impairedMore.result.nominalValue).toBe(8);
    expect(impairedMore.result.remaining).toEqual([
      { id: 'split-2', workLeft: 2 },
      { id: 'split-3', workLeft: 2 },
    ]);
    const carried = data.rows.find(
      (row) =>
        row.factor === 'carryover' &&
        row.level === 2 &&
        row.horizon === 3 &&
        row.strategy === 'whole',
    )!;
    expect(carried.result.checkpoints).toEqual([
      { tick: 3, nominalValue: 0, realizedValue: 0, remaining: [{ id: 'parent', workLeft: 1 }] },
      { tick: 4, nominalValue: 12, realizedValue: 12, remaining: [] },
    ]);
    const carriedSplit = data.rows.find(
      (row) =>
        row.factor === 'carryover' &&
        row.level === 2 &&
        row.horizon === 3 &&
        row.strategy === 'split',
    )!;
    expect(carriedSplit.result.checkpoints).toEqual([
      {
        tick: 3,
        nominalValue: 4,
        realizedValue: 4,
        remaining: [
          { id: 'split-2', workLeft: 3 },
          { id: 'split-3', workLeft: 2 },
        ],
      },
      { tick: 6, nominalValue: 8, realizedValue: 8, remaining: [{ id: 'split-3', workLeft: 2 }] },
    ]);
    const late = data.rows.find(
      (row) =>
        row.factor === 'splitTiming' &&
        row.level === 3 &&
        row.horizon === 3 &&
        row.strategy === 'split',
    )!;
    expect(late.result.splitApplied).toBe(false);
    expect(late.result.discardedWork).toBe(0);
    const delayed = data.rows.find(
      (row) =>
        row.factor === 'splitTiming' &&
        row.level === 1 &&
        row.horizon === 3 &&
        row.strategy === 'split',
    )!;
    expect(delayed.result.splitApplied).toBe(true);
    expect(delayed.result.discardedWork).toBe(3);
    expect(
      data.rows.find(
        (row) =>
          row.factor === 'carryover' &&
          row.level === 1 &&
          row.horizon === 3 &&
          row.strategy === 'whole',
      )!.result.remaining,
    ).toEqual([{ id: 'parent', workLeft: 1 }]);
  });

  it('保存した入力列を毎入力再生しても差引と残工数が変わらない', () => {
    for (const row of data.rows) {
      let live = createSplitPrototype('RI-166', row.horizon * row.periods, row.integrationFails);
      if (row.childImpairment > 0) live.childImpairment = row.childImpairment;
      const snapshot = structuredClone(live);
      let restored = structuredClone(live);
      const checkpoints: {
        tick: number;
        nominalValue: number;
        realizedValue: number;
        remaining: { id: string; workLeft: number }[];
      }[] = [];
      for (const input of row.inputs) {
        const beforeTick = live.tick;
        const before = structuredClone(live);
        const previous = live;
        live = applySplitInput(live, input);
        expect(previous).toEqual(before);
        restored = applySplitInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
        if (live.tick !== beforeTick && live.tick > 0 && live.tick % row.horizon === 0) {
          const summary = summarizeSplit(live);
          checkpoints.push({
            tick: live.tick,
            nominalValue: summary.value,
            realizedValue: realizeSplitValue(live, row.independentValue),
            remaining: summary.remaining,
          });
        }
      }
      const lastCheckpoint = checkpoints[checkpoints.length - 1];
      if (lastCheckpoint?.tick !== live.tick) {
        const summary = summarizeSplit(live);
        checkpoints.push({
          tick: live.tick,
          nominalValue: summary.value,
          realizedValue: realizeSplitValue(live, row.independentValue),
          remaining: summary.remaining,
        });
      }
      expect(live).not.toBe(snapshot);
      expect(snapshot.tick).toBe(0);
      expect(summarizeSplit(live).value).toBe(row.result.nominalValue);
      expect(realizeSplitValue(live, row.independentValue)).toBe(row.result.realizedValue);
      expect(realizeSplitValue(live, row.independentValue) - live.focusSpent * row.focusValue).toBe(
        row.result.netValue,
      );
      expect(summarizeSplit(live).remaining).toEqual(row.result.remaining);
      expect(checkpoints).toEqual(row.result.checkpoints);
      expect(runSplitScenario('RI-166', row).result).toEqual(row.result);
    }
  });
});
