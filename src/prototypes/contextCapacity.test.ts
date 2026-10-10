import { describe, expect, it } from 'vitest';
import {
  applyContextInput as apply,
  chooseContextAction,
  compareContextStrategies,
  createContextBoard,
  createContextPrototype as create,
  summarizeContext,
  viewContext,
} from './contextCapacity';
import comparison from '../../docs/prototypes/context-capacity-comparison.json';

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
});
