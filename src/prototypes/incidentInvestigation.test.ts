import { describe, expect, it } from 'vitest';
import {
  applyInvestigationInput as apply,
  baselineInvestigationRules,
  compareInvestigationSensitivities,
  compareInvestigationStrategies,
  createInvestigationPrototype as create,
  investigationGuessMethod,
  rankInvestigationChoice,
  summarizeInvestigation,
  viewInvestigation,
  weighCauseOutcomes,
  type InvestigationFactor,
  type SensitivityRow,
  type SensitivityStrategy,
} from './incidentInvestigation';
import comparison from '../../docs/prototypes/incident-investigation-comparison.json';
import sensitivity from '../../docs/prototypes/incident-investigation-sensitivity.json';

const factors: InvestigationFactor[] = [
  'wrongFixWork',
  'rollbackLostValue',
  'unresolvedPenalty',
  'priorConfigurationPercent',
  'interruptFocus',
];

function pair(
  rows: { horizon: number; seed: number; strategy: string; result: { netValue: number } }[],
  horizon: number,
  strategy: string,
): [number, number] {
  const configuration = rows.find(
    (row) => row.horizon === horizon && row.seed === 0 && row.strategy === strategy,
  );
  const code = rows.find(
    (row) => row.horizon === horizon && row.seed === 1 && row.strategy === strategy,
  );
  if (!configuration || !code) throw new Error(`${horizon} ${strategy}`);
  return [configuration.result.netValue, code.result.netValue];
}

describe('RI-172 原因調査', () => {
  it('同じ症状の2原因をseedで固定し、表示では未知原因を公開しない', () => {
    const a = create(0);
    const b = create(1);
    expect(a.cause).toBe('configuration');
    expect(b.cause).toBe('code');
    expect(create(1)).toEqual(b);
    const before = structuredClone(b);
    expect(viewInvestigation(a)).toEqual(viewInvestigation(b));
    expect(viewInvestigation(a)).not.toHaveProperty('cause');
    for (let i = 0; i < 10; i++) expect(viewInvestigation(b).knownCause).toBeNull();
    expect(b).toEqual(before);
  });
  it('調査2tickの間も損失が進み、完了後に原因と見積が分かる', () => {
    let state = apply(create(1), { type: 'investigate' });
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ knownCause: null, customerLoss: 4, workLeft: 1 });
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({
      knownCause: 'code',
      customerLoss: 8,
      phase: 'active',
      focusSpent: 1,
    });
    expect(viewInvestigation(state).methods.map((m) => m.workRange)).toEqual([
      [6, 6],
      [1, 1],
      [1, 1],
    ]);
    expect(viewInvestigation(state)).not.toHaveProperty('cause');
    expect(apply(state, { type: 'investigate' })).toBe(state);
  });
  it('未調査でも全手段を選べ、間違った修正は時間を払い、巻き戻し損失は一度だけ', () => {
    const initial = create(1);
    expect(apply(initial, { type: 'recover', method: 'configuration' }).workLeft).toBe(6);
    expect(apply(initial, { type: 'recover', method: 'code' }).workLeft).toBe(1);
    let state = apply(initial, { type: 'recover', method: 'rollback' });
    expect(state.shippedValue).toBe(20);
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ shippedValue: 6, lostValue: 14, customerLoss: 4 });
    expect(apply(state, { type: 'recover', method: 'rollback' })).toBe(state);
    expect(apply(state, { type: 'tick' }).lostValue).toBe(14);
  });
  it('多重操作・資源不足・期末は無消費で拒否し、未復旧を保持する', () => {
    const busy = apply(create(1), { type: 'investigate' });
    expect(apply(busy, { type: 'recover', method: 'code' })).toBe(busy);
    expect(apply(busy, { type: 'interrupt' })).toBe(busy);
    const poor = { ...create(1), focus: 0 };
    expect(apply(poor, { type: 'investigate' })).toBe(poor);
    expect(apply(poor, { type: 'recover', method: 'code' })).toBe(poor);
    const ended = { ...busy, tick: busy.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'investigate' })).toBe(ended);
    expect(summarizeInvestigation(ended).outstandingImpact).toBeGreaterThan(0);
  });
  it('原因を知らない同一方針は短期で巻き戻し、長期で調査が有利になる', () => {
    const rows = compareInvestigationStrategies();
    expect(rows).toEqual(comparison.results);
    const mean = (horizon: number, strategy: string) =>
      rows
        .filter((r) => r.horizon === horizon && r.strategy === strategy)
        .reduce((sum, r) => sum + r.result.netValue, 0) / 2;
    expect(mean(2, 'rollback')).toBe(3);
    expect(mean(2, 'investigate')).toBe(-3);
    expect(mean(2, 'configuration')).toBe(1);
    expect(mean(8, 'investigate')).toBe(16);
    expect(mean(8, 'rollback')).toBe(15);
    expect(mean(8, 'configuration')).toBe(14);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareInvestigationStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeInvestigation(live)).toEqual(row.result);
    }
  });
  it('追加症状は信念だけを変え、表示と決め打ちは隠れた原因を見ない', () => {
    expect(investigationGuessMethod(50)).toBe('configuration');
    expect(investigationGuessMethod(25)).toBe('code');
    expect(investigationGuessMethod(57)).toBe('configuration');
    const hinted = { ...baselineInvestigationRules, priorConfigurationPercent: 57 };
    const codeSide = create(1, 8, hinted);
    const before = structuredClone(codeSide);
    for (let i = 0; i < 10; i++) viewInvestigation(codeSide);
    expect(codeSide).toEqual(before);
    expect(codeSide.cause).toBe(create(1).cause);
    expect(viewInvestigation(create(0, 8, hinted))).toEqual(viewInvestigation(codeSide));
    expect(viewInvestigation(codeSide)).toMatchObject({
      knownCause: null,
      likelyCause: 'configuration',
      priorConfigurationPercent: 57,
    });
    expect(viewInvestigation(codeSide)).not.toHaveProperty('cause');
    const leanCode = { ...baselineInvestigationRules, priorConfigurationPercent: 25 };
    const hidden = create(0, 8, leanCode);
    expect(viewInvestigation(hidden).likelyCause).toBe('code');
    expect(viewInvestigation(hidden)).toEqual(viewInvestigation(create(1, 8, leanCode)));
    const acted = apply(hidden, {
      type: 'recover',
      method: viewInvestigation(hidden).likelyCause!,
    });
    expect(acted.workLeft).toBe(baselineInvestigationRules.wrongFixWork);
    expect(viewInvestigation(acted).knownCause).toBeNull();
  });
  it('調査中断は既定で拒否し、許しても途中では原因を公開しない', () => {
    const allowed = { ...baselineInvestigationRules, interruptFocus: 0 };
    const idle = create(1, 8, allowed);
    expect(apply(idle, { type: 'interrupt' })).toBe(idle);
    const busy = apply(create(1, 8, allowed), { type: 'investigate' });
    expect(apply(busy, { type: 'recover', method: 'code' })).toBe(busy);
    const partial = apply(busy, { type: 'tick' });
    const aborted = apply(partial, { type: 'interrupt' });
    expect(aborted).toMatchObject({
      phase: 'active',
      knownCause: null,
      workLeft: 0,
      focusSpent: 1,
      customerLoss: 4,
    });
    expect(viewInvestigation(aborted)).not.toHaveProperty('cause');
    expect(viewInvestigation(aborted).knownCause).toBeNull();
    expect(apply(aborted, { type: 'interrupt' })).toBe(aborted);
    const costly = apply(create(1, 8, { ...baselineInvestigationRules, interruptFocus: 1 }), {
      type: 'investigate',
    });
    expect(apply(apply(costly, { type: 'tick' }), { type: 'interrupt' }).focusSpent).toBe(2);
    const unaffordable = apply(create(1, 8, { ...baselineInvestigationRules, interruptFocus: 4 }), {
      type: 'investigate',
    });
    expect(apply(unaffordable, { type: 'interrupt' })).toBe(unaffordable);
  });
  it('動かした要因ごとに即応と調査の優劣が反転する段を再計算する', () => {
    expect(sensitivity.humanPlaytest).toBe(false);
    expect(sensitivity.baseline).toEqual(baselineInvestigationRules);
    expect(sensitivity.resources).toEqual({
      shippedValue: 20,
      focus: 4,
      customerLossPerTick: 4,
      otherValuePerTick: 2,
      investigationTicks: 2,
      correctFixTicks: 1,
      horizons: [2, 8],
      seeds: [0, 1],
    });
    const rows = compareInvestigationSensitivities();
    expect(rows).toEqual(sensitivity.results);
    const original = compareInvestigationStrategies();
    const score = (
      horizon: number,
      strategy: 'investigate' | 'guess' | 'rollback',
      prior: number,
      source: typeof original | SensitivityRow[],
      from: 'original' | 'sensitivity',
    ) => {
      const name = from === 'original' && strategy === 'guess' ? 'configuration' : strategy;
      const [configuration, code] = pair(source, horizon, name);
      return weighCauseOutcomes(configuration, code, prior);
    };
    const choice = (
      horizon: number,
      factor: InvestigationFactor,
      level: number,
      prior = level === 50 ? 50 : factor === 'priorConfigurationPercent' ? level : 50,
    ) => {
      // 6・14・10・50は初回比較の対照。感度JSONには動かした段だけを置く。
      const source = level === 6 || level === 14 || level === 10 || level === 50 ? original : rows;
      const from = source === original ? 'original' : 'sensitivity';
      const selected =
        source === rows
          ? source.filter((row) => row.factor === factor && row.level === level)
          : source;
      const scores = {
        investigate: score(horizon, 'investigate', prior, selected, from),
        guess: score(horizon, 'guess', prior, selected, from),
        rollback: score(horizon, 'rollback', prior, selected, from),
      };
      return { ...scores, ...rankInvestigationChoice(scores) };
    };
    expect(choice(2, 'wrongFixWork', 5)).toEqual({
      investigate: -300,
      guess: 300,
      rollback: 300,
      better: 'immediate',
      immediateBy: 'tie',
    });
    expect(choice(8, 'wrongFixWork', 5)).toEqual({
      investigate: 1600,
      guess: 1700,
      rollback: 1500,
      better: 'immediate',
      immediateBy: 'guess',
    });
    expect(choice(2, 'wrongFixWork', 6).better).toBe('immediate');
    expect(choice(8, 'wrongFixWork', 6)).toEqual({
      investigate: 1600,
      guess: 1400,
      rollback: 1500,
      better: 'investigate',
      immediateBy: 'rollback',
    });
    expect(choice(8, 'rollbackLostValue', 12)).toEqual({
      investigate: 1600,
      guess: 1400,
      rollback: 1700,
      better: 'immediate',
      immediateBy: 'rollback',
    });
    expect(choice(8, 'rollbackLostValue', 13)).toEqual({
      investigate: 1600,
      guess: 1400,
      rollback: 1600,
      better: 'tie',
      immediateBy: 'rollback',
    });
    expect(choice(2, 'rollbackLostValue', 12).better).toBe('immediate');
    expect(choice(2, 'rollbackLostValue', 14).better).toBe('immediate');
    expect(choice(8, 'rollbackLostValue', 14)).toEqual({
      investigate: 1600,
      guess: 1400,
      rollback: 1500,
      better: 'investigate',
      immediateBy: 'rollback',
    });
    expect(choice(2, 'unresolvedPenalty', 0)).toEqual({
      investigate: 700,
      guess: 600,
      rollback: 300,
      better: 'investigate',
      immediateBy: 'guess',
    });
    expect(choice(2, 'unresolvedPenalty', 2)).toEqual({
      investigate: 500,
      guess: 500,
      rollback: 300,
      better: 'tie',
      immediateBy: 'guess',
    });
    expect(choice(2, 'unresolvedPenalty', 4)).toEqual({
      investigate: 300,
      guess: 400,
      rollback: 300,
      better: 'immediate',
      immediateBy: 'guess',
    });
    expect(choice(2, 'unresolvedPenalty', 10)).toEqual({
      investigate: -300,
      guess: 100,
      rollback: 300,
      better: 'immediate',
      immediateBy: 'rollback',
    });
    for (const level of [0, 2, 4]) {
      expect(choice(8, 'unresolvedPenalty', level)).toEqual(choice(8, 'unresolvedPenalty', 10));
    }
    expect(choice(8, 'priorConfigurationPercent', 56, 56)).toEqual({
      investigate: 1600,
      guess: 1580,
      rollback: 1500,
      better: 'investigate',
      immediateBy: 'guess',
    });
    expect(choice(8, 'priorConfigurationPercent', 57, 57)).toEqual({
      investigate: 1600,
      guess: 1610,
      rollback: 1500,
      better: 'immediate',
      immediateBy: 'guess',
    });
    expect(choice(2, 'priorConfigurationPercent', 57, 57).better).toBe('immediate');
    const interrupt = (horizon: number, strategy: SensitivityStrategy) =>
      weighCauseOutcomes(
        ...pair(
          rows.filter((row) => row.factor === 'interruptFocus'),
          horizon,
          strategy,
        ),
        50,
      );
    expect(interrupt(2, 'interrupt-rollback')).toBe(-400);
    expect(interrupt(2, 'interrupt-guess')).toBe(-500);
    expect(interrupt(8, 'interrupt-rollback')).toBe(800);
    expect(interrupt(8, 'interrupt-guess')).toBe(700);
    expect(choice(2, 'interruptFocus', 0).better).toBe('immediate');
    expect(choice(8, 'interruptFocus', 0).better).toBe('investigate');
    for (const horizon of [2, 8]) {
      const pure = choice(horizon, 'interruptFocus', 0);
      expect(pure.rollback - interrupt(horizon, 'interrupt-rollback')).toBe(700);
      expect(pure.guess - interrupt(horizon, 'interrupt-guess')).toBe(horizon === 8 ? 700 : 600);
    }
  });
  it('感度の各行は一つの要因だけを動かし、初回の資源と保存再開を保つ', () => {
    const rows = compareInvestigationSensitivities();
    const original = compareInvestigationStrategies();
    for (const row of rows) {
      expect(row.initial).toMatchObject({
        version: 1,
        seed: row.seed,
        horizon: row.horizon,
        focus: 4,
        shippedValue: 20,
        customerLoss: 0,
        knownCause: null,
        cause: row.seed === 0 ? 'configuration' : 'code',
      });
      expect(row.initial.rules?.[row.factor]).toBe(row.level);
      for (const factor of factors) {
        if (factor !== row.factor) {
          expect(row.initial.rules?.[factor]).toEqual(baselineInvestigationRules[factor]);
        }
      }
      expect(viewInvestigation(row.initial)).not.toHaveProperty('cause');
      expect(viewInvestigation(row.initial).knownCause).toBeNull();
      if (row.seed === 0) {
        const twin = rows.find(
          (candidate) =>
            candidate.seed === 1 &&
            candidate.factor === row.factor &&
            candidate.level === row.level &&
            candidate.horizon === row.horizon &&
            candidate.strategy === row.strategy,
        )!;
        expect(viewInvestigation(twin.initial)).toEqual(viewInvestigation(row.initial));
        if (row.strategy !== 'investigate') expect(twin.inputs).toEqual(row.inputs);
      }
      if (row.factor !== 'interruptFocus') {
        const baselineStrategy = row.strategy === 'guess' ? 'configuration' : row.strategy;
        const baseline = original.find(
          (candidate) =>
            candidate.horizon === row.horizon &&
            candidate.seed === row.seed &&
            candidate.strategy === baselineStrategy,
        )!;
        expect(row.inputs).toEqual(baseline.inputs);
      }
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeInvestigation(live)).toEqual(row.result);
      expect(viewInvestigation(live)).not.toHaveProperty('cause');
      expect(viewInvestigation(live).knownCause).toBe(live.knownCause);
      expect(live.tick).toBe(live.horizon);
    }
    const control = rows.find(
      (row) =>
        row.factor === 'interruptFocus' && row.strategy === 'investigate' && row.horizon === 8,
    )!;
    const legacy = original.find(
      (row) => row.strategy === 'investigate' && row.horizon === 8 && row.seed === control.seed,
    )!;
    expect(control.inputs).toEqual(legacy.inputs);
    expect(control.result).toEqual(legacy.result);
    expect(legacy.initial).not.toHaveProperty('rules');
  });
});
