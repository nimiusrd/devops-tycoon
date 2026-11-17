import { describe, expect, it } from 'vitest';
import {
  applyLibraryDeadlineBoss as apply,
  chooseLibraryAction,
  compareLibraryDeadlineBoss,
  createLibraryDeadlineBoss as create,
  summarizeLibraryDeadlineBoss as summarize,
  viewLibraryDeadlineBoss as view,
  type LibraryDeadlineState,
  type LibraryInput,
} from './libraryDeadlineBoss';
import comparison from '../../docs/prototypes/library-deadline-comparison.json';

const advance = (state: LibraryDeadlineState, times: number) => {
  for (let i = 0; i < times; i++) state = apply(state, { type: 'advance' });
  return state;
};
const batch: LibraryInput = {
  type: 'plan',
  mode: 'batch',
  order: ['ledger-kernel', 'relay-mesh', 'palette-cache'],
};

describe('RI-258 仮想ライブラリの保守期限戦', () => {
  it('選択前に重要度・範囲・実装/確認工数・期限と猶予・集中確認費を公開する', () => {
    const first = create();
    const snapshot = view(first);
    expect(snapshot).toMatchObject({
      phase: 'prepare',
      canPlan: true,
      capacity: 4,
      activeTicks: 6,
      batchCoordinationWork: 2,
      result: null,
    });
    expect(
      snapshot.libraries.map((library) => [
        library.importance,
        library.domains,
        library.implementationWork,
        library.verificationWork,
        library.deadlineTick,
        library.graceTicks,
      ]),
    ).toEqual([
      ['critical', ['billing', 'orders'], 4, 2, 1, 1],
      ['important', ['search', 'notifications'], 3, 2, 3, 1],
      ['low', ['catalog'], 2, 1, 4, 1],
    ]);
    snapshot.libraries[0]!.domains.length = 0;
    snapshot.libraries[0]!.implementationLeft = 0;
    expect(view(first).libraries[0]!.domains).toEqual(['billing', 'orders']);
    expect(view(first).libraries[0]!.implementationLeft).toBe(4);
    expect(apply(first, { type: 'view' })).toBe(first);
  });

  it('準備→開始→ピーク→結果を区別し、無操作でも出荷・時計が進み、即敗北しない', () => {
    let state = create();
    const phases = [view(state).phase];
    for (let i = 0; i < 7; i++) {
      state = advance(state, 1);
      phases.push(view(state).phase);
    }
    expect(phases).toEqual(['prepare', 'start', 'peak', 'peak', 'peak', 'peak', 'peak', 'result']);
    expect(summarize(state)).toMatchObject({
      completed: true,
      shipped: 24,
      incidents: 7,
      incidentLoss: 31,
      updated: [],
      carryoverWork: 14,
      continued: true,
    });
    expect(view(state).result).toEqual(summarize(state));
    expect(apply(state, batch)).toBe(state);
    expect(advance(state, 1)).toBe(state);
  });

  it('一括更新の実装済みを更新完了とせず、集中確認が済んだ対象だけを更新する', () => {
    const tick1 = advance(apply(create(), batch), 2);
    expect(tick1.libraries[0]).toMatchObject({
      implementationLeft: 0,
      verificationLeft: 2,
      updatedAt: null,
    });
    const tick2 = advance(tick1, 1);
    expect(tick2.periods[1]).toMatchObject({ implementation: 4, verification: 0, updated: [] });
    const tick3 = advance(tick2, 1);
    expect(tick3.libraries[0]).toMatchObject({
      implementationLeft: 0,
      verificationLeft: 1,
      updatedAt: null,
    });
    expect(summarize(tick3)).toMatchObject({ updated: [], carryoverWork: 4 });
    expect(tick3.periods[2]).toMatchObject({
      implementation: 1,
      coordination: 2,
      verification: 1,
      incidents: [{ id: 'ledger-kernel', loss: 6 }],
    });
    const finished = advance(tick3, 3);
    expect(summarize(finished)).toMatchObject({
      shipped: 8,
      incidents: 1,
      incidentLoss: 6,
      carryoverWork: 0,
    });
    expect(finished.libraries.map((library) => library.updatedAt)).toEqual([4, 4, 4]);
    const partial = create();
    partial.capacity = 15;
    const checked = advance(apply(partial, batch), 2);
    expect(checked.libraries.map((library) => library.updatedAt)).toEqual([1, 1, null]);
    expect(summarize(checked)).toMatchObject({
      carryoverWork: 1,
      remaining: [{ id: 'palette-cache', implementationLeft: 0, verificationLeft: 1 }],
    });
  });

  it('期限と猶予の境界を含め、同tickの確認完了は損失判定より先に反映する', () => {
    const first = create();
    const afterDeadline = advance(first, 2); // tick1を処理済み
    expect(afterDeadline.periods[0]!.incidents).toEqual([]);
    const afterGrace = advance(afterDeadline, 1); // tick2を処理済み
    expect(afterGrace.periods[1]!.incidents).toEqual([]);
    expect(advance(afterGrace, 1).periods[2]!.incidents).toEqual([
      { id: 'ledger-kernel', loss: 6 },
    ]);
    const focus = apply(first, { type: 'plan', mode: 'focus', order: ['ledger-kernel'] });
    const onGrace = advance(focus, 3);
    expect(onGrace.libraries[0]!.updatedAt).toBe(2);
    expect(advance(onGrace, 1).periods[2]!.incidents).toEqual([]);
    // 猶予0でも期限当日の確認は成功、翌tickまで確認未了なら損失。
    const exact = create();
    exact.capacity = 6;
    exact.libraries[0]!.graceTicks = 0;
    const completed = advance(
      apply(exact, { type: 'plan', mode: 'focus', order: ['ledger-kernel'] }),
      2,
    );
    expect(completed.libraries[0]!.updatedAt).toBe(1);
    expect(completed.periods[0]!.incidents).toEqual([]);
    const missed = advance(exact, 3);
    expect(missed.periods[1]!.incidents).toEqual([{ id: 'ledger-kernel', loss: 6 }]);
  });

  it('重点更新は選択順に確認まで完了し、未選択依存の工数と障害を持ち越す', () => {
    const start = apply(create(), {
      type: 'plan',
      mode: 'focus',
      order: ['relay-mesh', 'ledger-kernel'],
    });
    const mid = advance(start, 2);
    expect(mid.libraries[1]).toMatchObject({
      implementationLeft: 0,
      verificationLeft: 1,
      updatedAt: null,
    });
    expect(mid.libraries[0]!.implementationLeft).toBe(4);
    const end = advance(mid, 5);
    expect(end.libraries.map((library) => library.updatedAt)).toEqual([3, 2, null]);
    expect(summarize(end)).toMatchObject({
      shipped: 13,
      incidentLoss: 1,
      carryoverWork: 3,
      remaining: [
        { id: 'palette-cache', domains: ['catalog'], implementationLeft: 2, verificationLeft: 1 },
      ],
    });
  });

  it('重複/欠落/未知ID・準備後の計画・再計画を拒否し、履歴と工数を消費しない', () => {
    const first = create();
    for (const input of [
      { ...batch, order: [] },
      { ...batch, order: ['ledger-kernel'] },
      { ...batch, order: ['ledger-kernel', 'ledger-kernel', 'palette-cache'] },
      { ...batch, order: ['unknown', 'relay-mesh', 'palette-cache'] },
    ])
      expect(apply(first, input as LibraryInput)).toBe(first);
    const planned = apply(first, batch);
    expect(apply(planned, batch)).toBe(planned);
    const started = advance(first, 1);
    expect(apply(started, batch)).toBe(started);
  });

  it('同条件比較をJSONと照合し、係数依存と逐次全件更新による一括の弱点を記録する', () => {
    const rows = compareLibraryDeadlineBoss();
    expect(rows).toEqual(comparison.results);
    expect(compareLibraryDeadlineBoss(0)).toEqual(comparison.coordinationSensitivity);
    expect(
      rows.every((row) => JSON.stringify(row.initial) === JSON.stringify(rows[0]!.initial)),
    ).toBe(true);
    const all = rows[1]!;
    const focus = rows[2]!;
    expect(focus.result.shipped).toBeGreaterThan(all.result.shipped);
    expect(focus.result.incidentLoss).toBeLessThan(all.result.incidentLoss);
    expect(focus.result.carryoverWork).toBeGreaterThan(all.result.carryoverWork);
    expect(focus.result.comparisonValue).toBeGreaterThan(all.result.comparisonValue);
    expect(focus.sensitivity[1]!.comparisonValue).toBeLessThan(all.sensitivity[1]!.comparisonValue);
    const serial = rows[3]!;
    expect(serial.result).toMatchObject({ shipped: 10, incidentLoss: 0, carryoverWork: 0 });
    expect(serial.result.comparisonValue).toBeGreaterThan(all.result.comparisonValue);
    expect(serial.result.comparisonValue).toBeGreaterThan(focus.result.comparisonValue);
    expect(focus.sensitivity[0]!.comparisonValue).toBeGreaterThan(
      serial.sensitivity[0]!.comparisonValue,
    );
    const cheap = create();
    cheap.batchCoordinationWork = 0;
    const cheapBatch = summarize(advance(apply(cheap, batch), 7));
    expect(cheapBatch).toMatchObject({ shipped: 10, incidentLoss: 0, comparisonValue: 20 });
    expect(cheapBatch.comparisonValue).toBeGreaterThan(focus.result.comparisonValue);
  });

  it('全入力再生・毎入力JSON保存再開・閲覧挿入が一致し、工数を保存して元状態を変えない', () => {
    for (const row of compareLibraryDeadlineBoss()) {
      let live = create(row.initial.seed);
      let resumed = structuredClone(live);
      expect(live).toEqual(row.initial);
      for (const input of row.inputs) {
        expect(chooseLibraryAction(live, row.strategy)).toEqual(input);
        const before = structuredClone(live);
        const next = apply(live, input);
        expect(live).toEqual(before);
        live = next;
        resumed = JSON.parse(JSON.stringify(resumed));
        const displayed = view(resumed);
        displayed.periods.length = 0;
        if (displayed.plan) displayed.plan.order.length = 0;
        resumed = apply(apply(resumed, { type: 'view' }), input);
        expect(resumed).toEqual(live);
        for (const period of live.periods) {
          expect(
            period.implementation + period.verification + period.coordination + period.shipped,
          ).toBe(live.capacity);
        }
        const implementationDone = live.periods.reduce(
          (sum, period) => sum + period.implementation,
          0,
        );
        const verificationDone = live.periods.reduce((sum, period) => sum + period.verification, 0);
        expect(
          live.libraries.reduce((sum, lib) => sum + lib.implementationLeft, implementationDone),
        ).toBe(9);
        expect(
          live.libraries.reduce((sum, lib) => sum + lib.verificationLeft, verificationDone),
        ).toBe(5);
        for (const library of live.libraries) {
          if (library.updatedAt !== null) {
            expect(library.implementationLeft + library.verificationLeft).toBe(0);
          }
        }
      }
      expect(live.periods).toEqual(row.periods);
      expect(summarize(live)).toEqual(row.result);
    }
  });
});
