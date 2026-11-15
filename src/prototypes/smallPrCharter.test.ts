import { describe, expect, it } from 'vitest';
import {
  SMALL_PR_LIMIT,
  applySmallPrCharter as apply,
  charterBlocks,
  chooseCharterAction,
  compareCharterFactorReversals,
  compareSmallPrCharters,
  createSmallPrCharter as create,
  effectiveSizeLimit,
  summarizeSmallPrCharter,
  viewSmallPrCharter,
} from './smallPrCharter';
import comparison from '../../docs/prototypes/small-pr-charter-comparison.json';
import factors from '../../docs/prototypes/small-pr-charter-factor-comparison.json';

describe('RI-219 小PR憲章', () => {
  it('禁止する出荷と上限を示し、既存上限とは厳しい方だけを併用する', () => {
    const first = create('RI-219', 'safe');
    expect(create('RI-219', 'safe')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewSmallPrCharter(first);
    for (let i = 0; i < 8; i++) expect(viewSmallPrCharter(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      charter: false,
      limit: null,
      forbids: null,
      change: '開始時のみ',
    });
    expect(blank).not.toHaveProperty('cultureBonus');
    const adopted = apply(first, { type: 'adopt' });
    expect(viewSmallPrCharter(adopted)).toMatchObject({
      charter: true,
      adoptedAt: 0,
      limit: 2,
      forbids: 'sizeが2を超える出荷',
    });
    expect(effectiveSizeLimit(false, null)).toBeNull();
    expect(effectiveSizeLimit(false, 3)).toBe(3);
    expect(effectiveSizeLimit(true, null)).toBe(2);
    expect(effectiveSizeLimit(true, 3)).toBe(2);
    expect(effectiveSizeLimit(true, 1)).toBe(1);
  });

  it('憲章中の大きい出荷は進まず、開始後の採用と無憲章の分割は受け付けない', () => {
    const fresh = create('RI-219', 'risky');
    expect(apply(fresh, { type: 'split', id: 'large' })).toBe(fresh);
    const adopted = apply(fresh, { type: 'adopt' });
    expect(apply(adopted, { type: 'adopt' })).toBe(adopted);
    expect(apply(adopted, { type: 'ship', id: 'large' })).toBe(adopted);
    const moved = apply(fresh, { type: 'ship', id: 'small' });
    expect(apply(moved, { type: 'adopt' })).toBe(moved);
    const split = apply(adopted, { type: 'split', id: 'large' });
    expect(split.jobs.map((job) => job.id)).toEqual(['small', 'large-a', 'large-b']);
    expect(
      split.jobs.filter((job) => job.id.startsWith('large')).every((job) => job.risk === 0),
    ).toBe(true);
    expect(apply(split, { type: 'split', id: 'large' })).toBe(split);
  });

  it('危険が小さい盤面は無憲章、大きい盤面は憲章の差引が上回る', () => {
    const rows = compareSmallPrCharters(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('safe', 'free'), score('safe', 'charter')]).toEqual([14, 10]);
    expect([score('risky', 'free'), score('risky', 'charter')]).toEqual([8, 10]);
    const riskyFree = rows.find((row) => row.board === 'risky' && row.strategy === 'free')!;
    expect(riskyFree.result).toMatchObject({ value: 8, charter: false, lost: false, pending: [] });
    const riskyCharter = rows.find((row) => row.board === 'risky' && row.strategy === 'charter')!;
    expect(riskyCharter.result.pending).toEqual(['small']);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSmallPrCharters(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseCharterAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSmallPrCharter(live)).toEqual(row.result);
    }
  });
});

describe('RI-219 上限・分割価値・リスク重み', () => {
  const report = compareCharterFactorReversals(comparison.seed);
  const points = [
    ...report.sweeps.limit.safe,
    ...report.sweeps.limit.risky,
    ...report.sweeps.splitPieceValue.safe,
    ...report.sweeps.splitPieceValue.risky,
    ...report.sweeps.riskWeight,
  ];
  const scores = (
    rows: {
      level: number | string;
      preference: string;
      free: { result: { score: number } };
      charter: { result: { score: number } };
    }[],
  ) =>
    rows.map((row) => [row.level, row.free.result.score, row.charter.result.score, row.preference]);
  const baseline = (board: string, strategy: string) =>
    comparison.results.find((row) => row.board === board && row.strategy === strategy)!;

  it('第3引数を省略した禁止判定は上限2のまま', () => {
    expect(SMALL_PR_LIMIT).toBe(2);
    expect(charterBlocks(true, 2)).toBe(false);
    expect(charterBlocks(true, 3)).toBe(true);
    expect(charterBlocks(true, 4)).toBe(true);
    expect(charterBlocks(false, 4)).toBe(false);
    expect(charterBlocks(true, 4, 4)).toBe(false);
    expect(charterBlocks(true, 3, 4)).toBe(false);
    expect(effectiveSizeLimit(true, null)).toBe(2);
  });

  it('記録した要因比較を再計算と照合する', () => {
    expect(report).toEqual(factors);
    expect(report.conditions).toMatchObject({
      seed: 'RI-219',
      horizon: 3,
      fixedStrategies: true,
      humanPlaytest: false,
      repeatedFirstComparison: false,
      productionIntegrated: false,
      oneAtATime: true,
    });
  });

  it('同じ2件の上で要因は一つだけで、基準点は初回と一致する', () => {
    for (const row of points) {
      expect(row.changed.length).toBeLessThanOrEqual(1);
      if (row.changed.length === 1) expect(row.changed[0]).toBe(row.factor);
      expect(row.initial).toMatchObject({
        version: 1,
        seed: 'RI-219',
        horizon: 3,
        tick: 0,
        value: 0,
        charter: false,
        inputs: [],
      });
      expect(
        row.initial.jobs.map((job) => [job.id, job.size, job.value, job.risk, job.done]),
      ).toEqual([
        ['small', 2, 4, 0, false],
        ['large', 4, 10, 6, false],
      ]);
      expect(row.free.inputs.some((input) => input.type === 'adopt')).toBe(false);
      expect(row.charter.inputs[0]).toEqual({ type: 'adopt' });
      expect(row.free.result.lost).toBe(false);
      expect(row.charter.result.lost).toBe(false);
    }
    const same = (row: (typeof points)[number], board: string) => {
      expect(row.initial).toEqual(baseline(board, 'free').initial);
      expect(row.free).toEqual({
        inputs: baseline(board, 'free').inputs,
        result: baseline(board, 'free').result,
      });
      expect(row.charter).toEqual({
        inputs: baseline(board, 'charter').inputs,
        result: baseline(board, 'charter').result,
      });
      expect(row.changed).toEqual([]);
    };
    same(
      report.sweeps.limit.safe.find((row) => row.level === 2)!,
      'safe',
    );
    same(
      report.sweeps.limit.risky.find((row) => row.level === 2)!,
      'risky',
    );
    same(
      report.sweeps.splitPieceValue.safe.find((row) => row.level === 5)!,
      'safe',
    );
    same(
      report.sweeps.splitPieceValue.risky.find((row) => row.level === 5)!,
      'risky',
    );
    same(
      report.sweeps.riskWeight.find((row) => row.level === '0')!,
      'safe',
    );
    same(
      report.sweeps.riskWeight.find((row) => row.level === '1')!,
      'risky',
    );
  });

  it('禁止する判断と禁止しない判断の優劣が反転する境界を示す', () => {
    expect(scores(report.sweeps.limit.safe)).toEqual([
      [1, 14, 5, 'free'],
      [2, 14, 10, 'free'],
      [3, 14, 10, 'free'],
      [4, 14, 14, 'tie'],
    ]);
    expect(scores(report.sweeps.limit.risky)).toEqual([
      [1, 8, 5, 'free'],
      [2, 8, 10, 'charter'],
      [3, 8, 10, 'charter'],
      [4, 8, 8, 'tie'],
    ]);
    expect(scores(report.sweeps.splitPieceValue.safe)).toEqual([
      [3, 14, 7, 'free'],
      [4, 14, 8, 'free'],
      [5, 14, 10, 'free'],
      [6, 14, 12, 'free'],
      [7, 14, 14, 'tie'],
      [8, 14, 16, 'charter'],
    ]);
    expect(scores(report.sweeps.splitPieceValue.risky)).toEqual([
      [3, 8, 7, 'free'],
      [4, 8, 8, 'tie'],
      [5, 8, 10, 'charter'],
      [6, 8, 12, 'charter'],
      [7, 8, 14, 'charter'],
      [8, 8, 16, 'charter'],
    ]);
    expect(scores(report.sweeps.riskWeight)).toEqual([
      ['0', 14, 10, 'free'],
      ['1/2', 11, 10, 'free'],
      ['2/3', 10, 10, 'tie'],
      ['1', 8, 10, 'charter'],
      ['2', 2, 10, 'charter'],
    ]);
    expect(report.reversals).toEqual([
      {
        factor: 'limit',
        board: 'safe',
        kind: 'vanish',
        before: { level: 3, preference: 'free', free: 14, charter: 10 },
        after: { level: 4, preference: 'tie', free: 14, charter: 14 },
      },
      {
        factor: 'limit',
        board: 'risky',
        kind: 'switch',
        before: { level: 1, preference: 'free', free: 8, charter: 5 },
        after: { level: 2, preference: 'charter', free: 8, charter: 10 },
      },
      {
        factor: 'limit',
        board: 'risky',
        kind: 'vanish',
        before: { level: 3, preference: 'charter', free: 8, charter: 10 },
        after: { level: 4, preference: 'tie', free: 8, charter: 8 },
      },
      {
        factor: 'splitPieceValue',
        board: 'safe',
        kind: 'vanish',
        before: { level: 6, preference: 'free', free: 14, charter: 12 },
        after: { level: 7, preference: 'tie', free: 14, charter: 14 },
      },
      {
        factor: 'splitPieceValue',
        board: 'safe',
        kind: 'appear',
        before: { level: 7, preference: 'tie', free: 14, charter: 14 },
        after: { level: 8, preference: 'charter', free: 14, charter: 16 },
      },
      {
        factor: 'splitPieceValue',
        board: 'risky',
        kind: 'vanish',
        before: { level: 3, preference: 'free', free: 8, charter: 7 },
        after: { level: 4, preference: 'tie', free: 8, charter: 8 },
      },
      {
        factor: 'splitPieceValue',
        board: 'risky',
        kind: 'appear',
        before: { level: 4, preference: 'tie', free: 8, charter: 8 },
        after: { level: 5, preference: 'charter', free: 8, charter: 10 },
      },
      {
        factor: 'riskWeight',
        board: 'jobs',
        kind: 'vanish',
        before: { level: '1/2', preference: 'free', free: 11, charter: 10 },
        after: { level: '2/3', preference: 'tie', free: 10, charter: 10 },
      },
      {
        factor: 'riskWeight',
        board: 'jobs',
        kind: 'appear',
        before: { level: '2/3', preference: 'tie', free: 10, charter: 10 },
        after: { level: '1', preference: 'charter', free: 8, charter: 10 },
      },
    ]);
    const tight = report.sweeps.limit.risky.find((row) => row.level === 1)!;
    expect(tight.charter.result.pending).toEqual(['small-a', 'small-b', 'large-b']);
    const heavy = report.sweeps.riskWeight.find((row) => row.level === '2')!;
    expect(heavy.free.inputs).toEqual([
      { type: 'ship', id: 'small' },
      { type: 'ship', id: 'large' },
      { type: 'wait' },
    ]);
    expect(heavy.initial).toMatchObject({ board: 'safe', riskWeight: 2 });
    expect(heavy.initial.riskDenominator).toBeUndefined();
    const twoThirds = report.sweeps.riskWeight.find((row) => row.level === '2/3')!;
    expect(twoThirds.initial).toMatchObject({ riskWeight: 2, riskDenominator: 3 });
  });

  it('要因比較も毎入力JSON保存再開と再生が一致し、元状態は変わらない', () => {
    for (const row of points) {
      for (const strategy of ['free', 'charter'] as const) {
        let live = row.initial;
        let saved = structuredClone(live);
        for (const input of row[strategy].inputs) {
          const previous = live;
          const before = structuredClone(live);
          expect(chooseCharterAction(previous, strategy)).toEqual(input);
          live = apply(live, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
        }
        expect(live.tick).toBe(live.horizon);
        expect(summarizeSmallPrCharter(live)).toEqual(row[strategy].result);
      }
    }
  });
});
