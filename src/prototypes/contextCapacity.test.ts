import { describe, expect, it } from 'vitest';
import {
  applyContextInput as apply,
  chooseContextAction,
  chooseContextWidth,
  compareContextStrategies,
  compareContextWidthSensitivity,
  createContextBoard,
  createContextPrototype as create,
  summarizeContext,
  viewContext,
} from './contextCapacity';
import comparison from '../../docs/prototypes/context-capacity-comparison.json';
import factors from '../../docs/prototypes/context-capacity-factor-comparison.json';

describe('RI-191 コンテキストの容量制限', () => {
  it('容量を超える選択を拒否し、渡した資料を仕事ごとに残す', () => {
    let state = createContextBoard(
      'RI-191',
      'custom',
      [
        { id: 'feature', kind: 'simple' },
        { id: 'migration', kind: 'complex' },
      ],
      20,
    );
    expect(apply(state, { type: 'set', docs: ['spec', 'history', 'example'] })).toBe(state);
    expect(apply(state, { type: 'set', docs: ['spec', 'spec'] })).toBe(state);
    expect(apply(state, { type: 'set', docs: ['wiki'] })).toBe(state);
    state = apply(state, { type: 'set', docs: ['example'] });
    expect(apply(state, { type: 'set', docs: ['example'] })).toBe(state);
    while (state.board.jobs[0].shipped === null) state = apply(state, { type: 'tick' });
    expect(state.assignedDocs.feature).toEqual(['example']);
    expect(state.board.jobs[0].shipped).toBe(10);
    expect(state.uncovered.feature).toEqual([]);
    state = apply(state, { type: 'set', docs: ['spec', 'history'] });
    expect(state.assignedDocs.feature).toEqual(['example']);
    expect(state.loaded).toEqual(['spec', 'history']);
    state = apply(state, { type: 'tick' });
    expect(state.assignedDocs.migration).toEqual(['spec', 'history']);
    expect(apply(state, { type: 'set', docs: ['example'] })).toBe(state);
  });

  it('資料説明を開いても割当も盤面も変わらず、種類の違う資料は同じ枠数でも結果が変わる', () => {
    const initial = create('RI-191', 'feature');
    const before = structuredClone(initial);
    expect(apply(initial, { type: 'inspect', doc: 'spec' })).toBe(initial);
    expect(apply(initial, { type: 'inspect', doc: 'unknown' })).toBe(initial);
    for (let count = 0; count < 30; count += 1) {
      viewContext(initial);
      apply(initial, { type: 'inspect', doc: 'example' });
    }
    expect(initial).toEqual(before);
    expect(viewContext(initial).docs.map((doc) => doc.covers)).toEqual([
      'requirement',
      'implementation',
      'change',
    ]);
    const loaded = apply(initial, { type: 'set', docs: ['spec', 'history'] });
    expect(apply(loaded, { type: 'inspect', doc: 'example' })).toBe(loaded);
    expect(apply(loaded, { type: 'set', docs: ['history', 'spec'] })).toBe(loaded);
    expect(loaded.loaded).toEqual(['spec', 'history']);
    expect(loaded.inputs).toHaveLength(1);
  });

  it('閲覧と期末は資料も進捗も動かさない', () => {
    const initial = create('RI-191', 'migration');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewContext(initial);
    expect(initial).toEqual(before);
    const ended = structuredClone(initial);
    ended.board.tick = ended.board.horizon;
    expect(apply(ended, { type: 'set', docs: ['spec'] })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'inspect', doc: 'spec' })).toBe(ended);
  });

  it('機能は実例、移行は設計書と履歴が有利で、枠を埋めるだけでは覆えない', () => {
    const rows = compareContextStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([
      net('feature', 'example'),
      net('feature', 'empty'),
      net('feature', 'specHistory'),
    ]).toEqual([10, 5, 5]);
    expect([net('migration', 'specHistory'), net('migration', 'exampleSpec')]).toEqual([18, 13]);
    const wrong = rows.find((row) => row.scenario === 'feature' && row.strategy === 'specHistory')!;
    expect(wrong.result.assignedDocs.feature).toEqual(['spec', 'history']);
    expect(wrong.result.uncovered.feature).toEqual(['implementation']);
    const right = rows.find(
      (row) => row.scenario === 'migration' && row.strategy === 'specHistory',
    )!;
    expect(right.result.uncovered.migration).toEqual([]);
    expect(
      right.result.resolutions.some((line) => line.includes('docs=spec+history:covered')),
    ).toBe(true);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、出荷合計が崩れない', () => {
    for (const row of compareContextStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseContextAction(previous, row.strategy)).toEqual(input);
        expect(live.board.spent).toBe(0);
        expect(live.board.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(
          live.board.shippedValue,
        );
      }
      expect(summarizeContext(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });

  it('rulesが無い状態は枠2のままで、上書きした枠を超える資料は無消費で拒否する', () => {
    const plain = create('RI-191', 'feature');
    expect(plain.rules).toBeUndefined();
    expect(viewContext(plain).capacity).toBe(2);
    const tight = createContextBoard('RI-191', 'feature', [{ id: 'feature', kind: 'simple' }], 8, {
      capacity: 1,
      risks: { feature: ['implementation'] },
    });
    expect(viewContext(tight).capacity).toBe(1);
    expect(apply(tight, { type: 'set', docs: ['spec', 'history'] })).toBe(tight);
    const one = apply(tight, { type: 'set', docs: ['example'] });
    expect(one.loaded).toEqual(['example']);
    expect(one.rules).toEqual({ capacity: 1, risks: { feature: ['implementation'] } });
  });
});

function firstRow(scenario: string, strategy: string) {
  const row = comparison.results.find(
    (item) => item.scenario === scenario && item.strategy === strategy,
  );
  if (!row) throw new Error(`${scenario}:${strategy}`);
  return row;
}

describe('RI-191 枠数と危険の数を一つずつ動かした比較', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const report = compareContextWidthSensitivity(factors.conditions.seed);
    expect(report).toEqual(factors);
    expect(report.conditions).toMatchObject({
      seed: 'RI-191',
      horizon: 8,
      work: 6,
      progress: 1,
      cost: 0,
      penalty: 5,
      featureValue: 10,
      migrationValue: 18,
      baselineCapacity: 2,
      baselineDangerCount: { feature: 1, migration: 2 },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
    });
    const cells = (
      points: {
        scenario: string;
        capacity: number;
        dangerCount: number;
        preference: string;
        narrow: number;
        wide: number;
      }[],
    ) =>
      points.map((point) => [
        point.scenario,
        point.capacity,
        point.dangerCount,
        point.preference,
        point.narrow,
        point.wide,
      ]);
    expect(cells(report.capacity.points)).toEqual([
      ['feature', 1, 1, 'narrow', 10, 5],
      ['migration', 1, 2, 'tie', 13, 13],
      ['feature', 2, 1, 'narrow', 10, 5],
      ['migration', 2, 2, 'wide', 13, 18],
      ['feature', 3, 1, 'tie', 10, 10],
      ['migration', 3, 2, 'wide', 13, 18],
    ]);
    expect(cells(report.dangerCount.points)).toEqual([
      ['feature', 2, 0, 'tie', 10, 10],
      ['migration', 2, 0, 'tie', 18, 18],
      ['feature', 2, 1, 'narrow', 10, 5],
      ['migration', 2, 1, 'tie', 18, 18],
      ['feature', 2, 2, 'tie', 5, 5],
      ['migration', 2, 2, 'wide', 13, 18],
      ['feature', 2, 3, 'wide', 0, 5],
      ['migration', 2, 3, 'wide', 8, 13],
    ]);
    expect(report.capacity.reversals).toEqual([
      {
        factor: 'capacity',
        scenario: 'feature',
        before: { level: 2, preference: 'narrow', narrow: 10, wide: 5 },
        after: { level: 3, preference: 'tie', narrow: 10, wide: 10 },
        strict: false,
      },
      {
        factor: 'capacity',
        scenario: 'migration',
        before: { level: 1, preference: 'tie', narrow: 13, wide: 13 },
        after: { level: 2, preference: 'wide', narrow: 13, wide: 18 },
        strict: false,
      },
    ]);
    expect(report.dangerCount.reversals).toEqual([
      {
        factor: 'dangerCount',
        scenario: 'feature',
        before: { level: 0, preference: 'tie', narrow: 10, wide: 10 },
        after: { level: 1, preference: 'narrow', narrow: 10, wide: 5 },
        strict: false,
      },
      {
        factor: 'dangerCount',
        scenario: 'feature',
        before: { level: 1, preference: 'narrow', narrow: 10, wide: 5 },
        after: { level: 2, preference: 'tie', narrow: 5, wide: 5 },
        strict: false,
      },
      {
        factor: 'dangerCount',
        scenario: 'feature',
        before: { level: 2, preference: 'tie', narrow: 5, wide: 5 },
        after: { level: 3, preference: 'wide', narrow: 0, wide: 5 },
        strict: false,
      },
      {
        factor: 'dangerCount',
        scenario: 'migration',
        before: { level: 1, preference: 'tie', narrow: 18, wide: 18 },
        after: { level: 2, preference: 'wide', narrow: 13, wide: 18 },
        strict: false,
      },
    ]);
    expect(report.capacity.reversals.some((item) => item.strict)).toBe(false);
    expect(report.dangerCount.reversals.some((item) => item.strict)).toBe(false);
    for (const point of report.capacity.points) {
      expect(point.dangerCount).toBe(point.scenario === 'feature' ? 1 : 2);
      expect(point.dangers).toEqual(
        point.scenario === 'feature' ? ['implementation'] : ['requirement', 'change'],
      );
    }
    for (const point of report.dangerCount.points) {
      expect(point.capacity).toBe(2);
      expect(point.dangers).toHaveLength(point.dangerCount);
    }
    const featureWideDocs = report.capacity.points
      .filter((point) => point.scenario === 'feature')
      .map((point) => point.runs.find((run) => run.width === 'wide')!.result.assignedDocs.feature);
    expect(featureWideDocs).toEqual([
      ['spec'],
      ['spec', 'history'],
      ['spec', 'history', 'example'],
    ]);
    const featureNarrowDocs = report.capacity.points
      .filter((point) => point.scenario === 'feature')
      .map(
        (point) => point.runs.find((run) => run.width === 'narrow')!.result.assignedDocs.feature,
      );
    expect(featureNarrowDocs).toEqual([['example'], ['example'], ['example']]);
    const tied = report.dangerCount.points.find(
      (point) => point.scenario === 'feature' && point.dangerCount === 2,
    )!;
    expect(tied.runs.find((run) => run.width === 'narrow')!.result.uncovered.feature).toEqual([
      'requirement',
    ]);
    expect(tied.runs.find((run) => run.width === 'wide')!.result.uncovered.feature).toEqual([
      'implementation',
    ]);
    const featureBaseline = report.capacity.points.find(
      (point) => point.scenario === 'feature' && point.capacity === 2,
    )!;
    const featureNarrow = featureBaseline.runs.find((run) => run.width === 'narrow')!;
    const featureWide = featureBaseline.runs.find((run) => run.width === 'wide')!;
    expect(featureNarrow.inputs).toEqual(firstRow('feature', 'example').inputs);
    expect(featureNarrow.result).toEqual(firstRow('feature', 'example').result);
    expect(featureWide.inputs).toEqual(firstRow('feature', 'specHistory').inputs);
    expect(featureWide.result).toEqual(firstRow('feature', 'specHistory').result);
    const migrationBaseline = report.dangerCount.points.find(
      (point) => point.scenario === 'migration' && point.dangerCount === 2,
    )!;
    const migrationWide = migrationBaseline.runs.find((run) => run.width === 'wide')!;
    const migrationNarrow = migrationBaseline.runs.find((run) => run.width === 'narrow')!;
    expect(migrationWide.inputs).toEqual(firstRow('migration', 'specHistory').inputs);
    expect(migrationWide.result).toEqual(firstRow('migration', 'specHistory').result);
    expect(migrationNarrow.result.assignedDocs.migration).toEqual(['spec']);
    expect(migrationNarrow.result.assignedDocs).not.toEqual(
      firstRow('migration', 'exampleSpec').result.assignedDocs,
    );
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、未カバーの5点が差引と一致する', () => {
    const report = compareContextWidthSensitivity(factors.conditions.seed);
    const runs = [...report.capacity.points, ...report.dangerCount.points].flatMap(
      (point) => point.runs,
    );
    for (const run of runs) {
      let live = run.initial;
      let saved = structuredClone(live);
      for (const input of run.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseContextWidth(previous, run.width)).toEqual(input);
        expect(live.loaded.length).toBeLessThanOrEqual(live.rules?.capacity ?? 2);
        expect(live.board.spent).toBe(0);
      }
      expect(summarizeContext(live)).toEqual(run.result);
      const missing = Object.values(run.result.uncovered).reduce(
        (sum, risks) => sum + risks.length,
        0,
      );
      const value = run.scenario === 'feature' ? 10 : 18;
      expect(run.result.netValue).toBe(value - missing * 5);
      expect(run.result.spent).toBe(0);
    }
  });
});
