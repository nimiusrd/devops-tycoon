import { describe, expect, it } from 'vitest';
import {
  applyCharterException as apply,
  chooseExceptionAction,
  compareCharterExceptionFactors,
  compareCharterExceptions,
  createCharterException as create,
  prepareCharterException,
  summarizeCharterException,
  viewCharterException,
  type ExceptionBoard,
  type ExceptionFactorName,
  type ExceptionStrategy,
} from './charterException';
import comparison from '../../docs/prototypes/charter-exception-comparison.json';
import factors from '../../docs/prototypes/charter-exception-factor-comparison.json';

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
      urgent: { size: 4, blocked: true },
      followUp: { tick: 3, applied: false, trustCost: 0, scheduledCost: 4 },
    });
    expect(viewCharterException(create('RI-220', 'precedent')).followUp.scheduledCost).toBe(8);
    blank.followUp.trustCost = 99;
    blank.followUp.scheduledCost = 1;
    expect(viewCharterException(first).followUp).toMatchObject({ trustCost: 0, scheduledCost: 4 });
    const allowed = { ...first, charter: false };
    expect(viewCharterException(allowed)).toMatchObject({
      charter: false,
      limit: null,
      blockedLarge: false,
      followUp: { scheduledCost: null },
    });
    expect(apply(allowed, { type: 'except' })).toBe(allowed);
    expect(chooseExceptionAction(allowed, 'except')).toEqual({ type: 'ship-urgent' });
    const shipped = apply(allowed, { type: 'ship-urgent' });
    expect(shipped).toMatchObject({
      urgentDone: true,
      exceptionUsed: false,
      exceptionTick: null,
      value: 12,
      trustCost: 0,
    });
    expect(viewCharterException(shipped).followUp.scheduledCost).toBeNull();
    const small = { ...first, urgentSize: 2 };
    expect(apply(small, { type: 'except' })).toBe(small);
    expect(apply(first, { type: 'ship-urgent' })).toBe(first);
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
    expect(viewCharterException(state)).toMatchObject({
      brokenFor: 'tick 0 の1期間',
      urgent: { done: true, expired: false, blocked: false },
      blockedLarge: true,
    });
    expect(apply(state, { type: 'except' })).toBe(state);
    expect(apply(state, { type: 'ship-large' })).toBe(state);
    while (state.tick < state.horizon) state = apply(state, { type: 'ship' });
    expect(summarizeCharterException(state)).toMatchObject({ trustCost: 4, followUpApplied: true });
    const once = summarizeCharterException(state);
    expect(apply(state, { type: 'view' })).toBe(state);
    expect(summarizeCharterException(state)).toEqual(once);
    expect(viewCharterException(state).followUp).toMatchObject({
      trustCost: 4,
      applied: true,
      scheduledCost: null,
    });
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
    expect(viewCharterException(held).followUp.scheduledCost).toBeNull();
    expect(viewCharterException(held).urgent).toMatchObject({
      expired: true,
      done: false,
      blocked: false,
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

function factorPoint(factor: ExceptionFactorName, board: ExceptionBoard, level: number) {
  const series = factors.series.find((entry) => entry.factor === factor && entry.board === board);
  const point = series?.points.find((entry) => entry.level === level);
  if (!point) throw new Error(`${factor}:${board}:${level}`);
  return point;
}

describe('RI-220 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源で再計算し、固定戦略であることを記録する', () => {
    const report = compareCharterExceptionFactors(factors.conditions.seed);
    expect(report).toEqual(factors);
    expect(report.conditions).toMatchObject({
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
      repeatedFirstComparison: false,
      normalRun: false,
      oneAtATime: true,
      randomDraws: false,
      horizon: 4,
      ordinaryValue: 3,
      urgentSize: 4,
      urgentDeadline: 0,
    });
    const first = compareCharterExceptions(comparison.seed);
    const baseline = factors.conditions.baseline;
    for (const series of report.series) {
      const preset = factors.conditions.presets[series.board];
      for (const point of series.points) {
        const changed = (['duration', 'followUpTick', 'urgentValue'] as const).filter(
          (key) => point.factors[key] !== baseline[key],
        );
        const controlLevel = series.factor === 'duration' ? 1 : 3;
        if (series.factor === 'urgentValue') expect(changed).toEqual(['urgentValue']);
        else if (point.level === controlLevel) expect(changed).toEqual([]);
        else expect(changed).toEqual([series.factor]);
        const initial = prepareCharterException(
          factors.conditions.seed,
          series.board,
          point.factors,
        );
        expect(initial).toMatchObject({
          ordinaryValue: 3,
          horizon: 4,
          urgentSize: 4,
          urgentDeadline: 0,
          limit: 2,
          charter: true,
          followUpCost: preset.followUpCost,
        });
        if (series.factor !== 'urgentValue') expect(initial.urgentValue).toBe(preset.urgentValue);
        expect(point.hold.result.score).toBe(12);
        expect(point.hold.result.trustCost).toBe(0);
      }
      const control = factorPoint(
        series.factor,
        series.board,
        series.factor === 'urgentValue' ? preset.urgentValue : series.factor === 'duration' ? 1 : 3,
      );
      const held = first.find((row) => row.board === series.board && row.strategy === 'hold');
      const waived = first.find((row) => row.board === series.board && row.strategy === 'except');
      expect(control.hold.inputs).toEqual(held?.inputs);
      expect(control.hold.result).toEqual(held?.result);
      expect(control.except.inputs).toEqual(waived?.inputs);
      expect(control.except.result).toEqual(waived?.result);
      expect(
        prepareCharterException(factors.conditions.seed, series.board, control.factors),
      ).toEqual(held?.initial);
    }
  });

  it('持続0、後日談が期内に来ない先例、緊急価値の境界で優劣が変わる', () => {
    expect(factors.reversals).toEqual([
      {
        factor: 'duration',
        board: 'deadline',
        before: { level: 0, preference: 'tie', hold: 12, except: 12 },
        after: { level: 1, preference: 'except', hold: 12, except: 17 },
      },
      {
        factor: 'duration',
        board: 'precedent',
        before: { level: 0, preference: 'tie', hold: 12, except: 12 },
        after: { level: 1, preference: 'hold', hold: 12, except: 7 },
      },
      {
        factor: 'followUpTick',
        board: 'precedent',
        before: { level: 0, preference: 'except', hold: 12, except: 15 },
        after: { level: 1, preference: 'hold', hold: 12, except: 7 },
      },
      {
        factor: 'followUpTick',
        board: 'precedent',
        before: { level: 4, preference: 'hold', hold: 12, except: 7 },
        after: { level: 5, preference: 'except', hold: 12, except: 15 },
      },
      {
        factor: 'urgentValue',
        board: 'deadline',
        before: { level: 6, preference: 'hold', hold: 12, except: 11 },
        after: { level: 7, preference: 'tie', hold: 12, except: 12 },
      },
      {
        factor: 'urgentValue',
        board: 'deadline',
        before: { level: 7, preference: 'tie', hold: 12, except: 12 },
        after: { level: 8, preference: 'except', hold: 12, except: 13 },
      },
      {
        factor: 'urgentValue',
        board: 'precedent',
        before: { level: 10, preference: 'hold', hold: 12, except: 11 },
        after: { level: 11, preference: 'tie', hold: 12, except: 12 },
      },
      {
        factor: 'urgentValue',
        board: 'precedent',
        before: { level: 11, preference: 'tie', hold: 12, except: 12 },
        after: { level: 12, preference: 'except', hold: 12, except: 13 },
      },
    ]);
    for (const level of [1, 2, 3, 4, 5]) {
      expect(factorPoint('duration', 'deadline', level).except.result.score).toBe(17);
      expect(factorPoint('duration', 'precedent', level).except.result.score).toBe(7);
      expect(
        factorPoint('duration', 'deadline', level).except.inputs.map((input) => input.type),
      ).toEqual(['except', 'ship', 'ship', 'ship']);
    }
    expect(factorPoint('duration', 'deadline', 0).except.inputs).toEqual(
      factorPoint('duration', 'deadline', 0).hold.inputs,
    );
    for (const level of [1, 2, 3, 4]) {
      expect(factorPoint('followUpTick', 'precedent', level).preference).toBe('hold');
      expect(factorPoint('followUpTick', 'deadline', level).preference).toBe('except');
      expect(factorPoint('followUpTick', 'precedent', level).except.result.trustCost).toBe(8);
    }
    expect(factorPoint('followUpTick', 'precedent', 0).except.result.followUpApplied).toBe(false);
    expect(factorPoint('followUpTick', 'precedent', 5).except.result.followUpApplied).toBe(false);
    expect(factorPoint('followUpTick', 'deadline', 0).preference).toBe('except');
    expect(factorPoint('followUpTick', 'deadline', 5).preference).toBe('except');
    expect(factorPoint('urgentValue', 'deadline', 12).preference).toBe('except');
    expect(factorPoint('urgentValue', 'precedent', 6).preference).toBe('hold');
  });

  it('持続2以上の窓では大きい出荷を一度受理し、固定戦略はその入力を送らない', () => {
    const opened = prepareCharterException('RI-220', 'deadline', {
      duration: 2,
      followUpTick: 3,
      urgentValue: null,
    });
    let state = apply(opened, { type: 'except' });
    expect(viewCharterException(state)).toMatchObject({
      charter: true,
      limit: 2,
      brokenFor: 'tick 0 から2期間',
      blockedLarge: false,
    });
    expect(apply(state, { type: 'except' })).toBe(state);
    state = apply(state, { type: 'ship-large' });
    expect(state).toMatchObject({ value: 32, tick: 2, exceptionUsed: true });
    expect(viewCharterException(state).blockedLarge).toBe(true);
    expect(apply(state, { type: 'ship-large' })).toBe(state);
    while (state.tick < state.horizon) state = apply(state, { type: 'ship' });
    expect(summarizeCharterException(state)).toMatchObject({
      value: 38,
      trustCost: 4,
      score: 34,
      followUpApplied: true,
    });
    expect(factorPoint('duration', 'deadline', 2).except.inputs).not.toContainEqual({
      type: 'ship-large',
    });
    expect(factorPoint('duration', 'deadline', 2).except.openTicks).toEqual([1]);
    expect(factorPoint('duration', 'deadline', 4).except.openTicks).toEqual([1, 2, 3]);
    expect(factorPoint('duration', 'deadline', 5).except.openTicks).toEqual([1, 2, 3]);
    let ended = prepareCharterException('RI-220', 'deadline', {
      duration: 5,
      followUpTick: 3,
      urgentValue: null,
    });
    while (ended.tick < ended.horizon) ended = apply(ended, chooseExceptionAction(ended, 'except'));
    expect(ended.tick).toBe(4);
    expect(viewCharterException(ended).blockedLarge).toBe(false);
    expect(apply(ended, { type: 'ship-large' })).toBe(ended);
    const zero = prepareCharterException('RI-220', 'precedent', {
      duration: 0,
      followUpTick: 3,
      urgentValue: null,
    });
    expect(apply(zero, { type: 'except' })).toBe(zero);
    expect(chooseExceptionAction(zero, 'except')).toEqual({ type: 'ship' });
    expect(viewCharterException(zero).followUp.scheduledCost).toBeNull();
  });

  it('要因比較の再生と毎入力JSON保存再開が一致する', () => {
    const report = compareCharterExceptionFactors(factors.conditions.seed);
    for (const series of report.series) {
      for (const point of series.points) {
        for (const strategy of ['hold', 'except'] as const satisfies readonly ExceptionStrategy[]) {
          let live = prepareCharterException(factors.conditions.seed, series.board, point.factors);
          let saved = structuredClone(live);
          for (const input of point[strategy].inputs) {
            const previous = live;
            const before = structuredClone(live);
            expect(chooseExceptionAction(previous, strategy)).toEqual(input);
            live = apply(live, input);
            saved = apply(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(before);
            expect(saved).toEqual(live);
          }
          expect(summarizeCharterException(live)).toEqual(point[strategy].result);
        }
      }
    }
  });
});
