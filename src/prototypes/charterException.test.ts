import { describe, expect, it } from 'vitest';
import {
  applyCharterException as apply,
  chooseExceptionAction,
  compareCharterExceptions,
  createCharterException as create,
  summarizeCharterException,
  viewCharterException,
} from './charterException';
import comparison from '../../docs/prototypes/charter-exception-comparison.json';

describe('RI-220 憲章の例外', () => {
  it('破る原則と1期間の例外、後日談の費用を事前に示す', () => {
    const first = create('RI-220', 'deadline');
    expect(create('RI-220', 'deadline')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewCharterException(first);
    for (let i = 0; i < 8; i++) expect(viewCharterException(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      charter: true,
      limit: 2,
      brokenFor: null,
      blockedLarge: true,
      followUp: { tick: 3, applied: false, trustCost: 0 },
    });
    blank.followUp.trustCost = 99;
    expect(viewCharterException(first).followUp.trustCost).toBe(0);
  });

  it('例外は1件だけで、その後も大きい出荷は禁止され、後日談は一度だけ引く', () => {
    let state = create('RI-220', 'deadline');
    state = apply(state, { type: 'except' });
    expect(state).toMatchObject({
      exceptionUsed: true,
      exceptionTick: 0,
      urgentDone: true,
      tick: 1,
    });
    expect(viewCharterException(state).brokenFor).toBe('tick 0 の1期間');
    expect(apply(state, { type: 'except' })).toBe(state);
    expect(apply(state, { type: 'ship-large' })).toBe(state);
    while (state.tick < state.horizon) state = apply(state, { type: 'ship' });
    expect(summarizeCharterException(state)).toMatchObject({ trustCost: 4, followUpApplied: true });
    const once = summarizeCharterException(state);
    expect(apply(state, { type: 'view' })).toBe(state);
    expect(summarizeCharterException(state)).toEqual(once);
    expect(viewCharterException(state).followUp.trustCost).toBe(4);
  });

  it('維持しても例外でも成果と代償があり、全待ちは敗北にしない', () => {
    let held = create('RI-220', 'precedent');
    while (held.tick < held.horizon) held = apply(held, { type: 'ship' });
    expect(summarizeCharterException(held)).toMatchObject({
      value: 12,
      trustCost: 0,
      urgentExpired: true,
      exceptionUsed: false,
      lost: false,
    });
    let idle = create('RI-220', 'deadline');
    while (idle.tick < idle.horizon) idle = apply(idle, { type: 'wait' });
    expect(summarizeCharterException(idle)).toMatchObject({ value: 0, trustCost: 0, lost: false });
    expect(apply(idle, { type: 'except' })).toBe(idle);
  });

  it('納期が重い盤面は例外、後日談が重い盤面は維持の差引が上回る', () => {
    const rows = compareCharterExceptions(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('deadline', 'except'), score('deadline', 'hold')]).toEqual([17, 12]);
    expect([score('precedent', 'hold'), score('precedent', 'except')]).toEqual([12, 7]);
    const waived = rows.find((row) => row.board === 'deadline' && row.strategy === 'except')!;
    expect(waived.result).toMatchObject({ exceptionTick: 0, followUpApplied: true, trustCost: 4 });
    expect(waived.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCharterExceptions(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseExceptionAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCharterException(live)).toEqual(row.result);
    }
  });
});
