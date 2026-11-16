import { describe, expect, it } from 'vitest';
import {
  applyStandbyInput,
  compareStandbyFactorReversals,
  compareStandbyStrategies,
  createStandbyPrototype,
  runStandbyPlan,
  standbyCapacity,
  summarizeStandby,
  type StandbyAssignment,
  type StandbySetup,
} from './incidentStandby';
import comparison from '../../docs/prototypes/incident-standby-comparison.json';
import factors from '../../docs/prototypes/incident-standby-factor-comparison.json';

describe('RI-170 障害対応の待機担当', () => {
  it('待機1枠の人物を通常Coding/Reviewから除き、交代で二重計上しない', () => {
    let state = createStandbyPrototype('RI-170');
    expect(standbyCapacity(state)).toEqual({ coding: 5, review: 5, standby: 0 });
    state = applyStandbyInput(state, { type: 'assign', id: 'ace', lane: 'standby' });
    expect(standbyCapacity(state)).toEqual({ coding: 2, review: 5, standby: 4 });
    state = applyStandbyInput(state, { type: 'assign', id: 'reviewer', lane: 'standby' });
    expect(standbyCapacity(state)).toEqual({ coding: 5, review: 0, standby: 1 });
    state = applyStandbyInput(state, { type: 'assign', id: 'coder', lane: 'standby' });
    expect(state.members.filter((m) => m.lane === 'standby')).toHaveLength(1);
    expect(standbyCapacity(state)).toEqual({ coding: 3, review: 5, standby: 2 });
    expect(state.focusSpent).toBe(3);
  });
  it('障害がない時も譲った容量が残り、待機者は応答疲労を消費しない', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170'), {
      type: 'assign',
      id: 'coder',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state).toMatchObject({ value: 9, responseWork: 0, stoppedTicks: 0 });
    expect(state.members[0]).toMatchObject({ stamina: 12, responseSpent: 0 });
  });
  it('障害時だけ待機の応答力で復旧し、体力以上に働かない', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170', true), {
      type: 'assign',
      id: 'ace',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state.incidents[0]).toMatchObject({ workLeft: 0, doneTick: 3 });
    expect(state.members[1]).toMatchObject({ stamina: 2, responseSpent: 6 });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state.incidents[1].workLeft).toBe(4);
    expect(state.members[1]).toMatchObject({ stamina: 0, responseSpent: 8 });
    state = applyStandbyInput(state, { type: 'tick' });
    expect(state.stoppedTicks).toBe(1);
    expect(state.incidents[1]).toMatchObject({ workLeft: 4, mobilizationLeft: 1 });
  });
  it('bench回復と交代は進捗・累積疲労を消さず、通常工程との違いを保つ', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170', true), {
      type: 'assign',
      id: 'ace',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    state = applyStandbyInput(state, { type: 'assign', id: 'coder', lane: 'standby' });
    expect(state.members[1]).toMatchObject({ lane: 'coding', stamina: 2, responseSpent: 6 });
    state = applyStandbyInput(state, { type: 'assign', id: 'ace', lane: 'bench' });
    state = applyStandbyInput(state, { type: 'tick' });
    expect(state.members[1]).toMatchObject({ lane: 'bench', stamina: 4, responseSpent: 6 });
    expect(standbyCapacity(state).coding).toBe(0);
    expect(state.incidents[0].doneTick).toBe(3);
  });
  it('対象なし・同じ配置・資源不足・期末は無消費で拒否する', () => {
    const initial = createStandbyPrototype('RI-170');
    const input = { type: 'assign', id: 'coder', lane: 'standby' } as const;
    expect(applyStandbyInput(initial, { ...input, id: 'missing' })).toBe(initial);
    expect(applyStandbyInput(initial, { ...input, lane: 'coding' })).toBe(initial);
    const poor = { ...initial, focus: 0 };
    expect(applyStandbyInput(poor, input)).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyStandbyInput(ended, input)).toBe(ended);
    expect(applyStandbyInput(ended, { type: 'tick' })).toBe(ended);
  });
  it('平穏時は全員通常、反復障害では待機が有利で、エース固定が最適にならない', () => {
    const rows = compareStandbyStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.slice(0, 4).map((r) => r.result.netValue)).toEqual([50, 29, 19, 25]);
    expect(rows.slice(4).map((r) => r.result.netValue)).toEqual([8, 23, 4, 20]);
    expect(rows[6].result.stoppedTicks).toBe(4);
    expect(rows[7].result.stoppedTicks).toBe(0);
  });
  it('期末の未復旧工数を消さず、無介入でも自動招集で復旧できる', () => {
    let state = { ...createStandbyPrototype('RI-170', true), horizon: 3 };
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(summarizeStandby(state)).toMatchObject({ remainingWork: 6, customerLoss: 2 });
    state = applyStandbyInput({ ...state, horizon: 4 }, { type: 'tick' });
    expect(state.incidents[0].doneTick).toBe(4);
  });
  it('全比較を毎入力JSON保存再開・再生でき、元状態を変えない', () => {
    for (const row of compareStandbyStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(previous);
        live = applyStandbyInput(live, input);
        expect(previous).toEqual(before);
        saved = applyStandbyInput(JSON.parse(JSON.stringify(saved)), input);
        expect(saved).toEqual(live);
      }
      expect(summarizeStandby(live)).toEqual(row.result);
    }
  });
  it('通常消費は出荷できたtickの通常工程だけから引き、待機者からは引かない', () => {
    const calm = applyStandbyInput(
      createStandbyPrototype('RI-170', false, { normalStaminaCost: 1 }),
      {
        type: 'tick',
      },
    );
    expect(calm.members.map((member) => member.stamina)).toEqual([11, 7, 11]);
    expect(calm.rules).toEqual({ normalStaminaCost: 1 });
    let standby = applyStandbyInput(
      createStandbyPrototype('RI-170', false, { normalStaminaCost: 1 }),
      { type: 'assign', id: 'coder', lane: 'standby' },
    );
    standby = applyStandbyInput(standby, { type: 'tick' });
    expect(standby.members.map((member) => member.stamina)).toEqual([12, 7, 11]);
    expect(createStandbyPrototype('RI-170', true).rules).toBeUndefined();
    let exhausted = applyStandbyInput(
      createStandbyPrototype('RI-170', true, { normalStaminaCost: 3 }),
      { type: 'assign', id: 'coder', lane: 'standby' },
    );
    for (let i = 0; i < 3; i++) exhausted = applyStandbyInput(exhausted, { type: 'tick' });
    expect(exhausted.members.map((member) => member.stamina)).toEqual([8, 0, 3]);
    const idle = applyStandbyInput(exhausted, { type: 'tick' });
    expect(idle.value).toBe(exhausted.value);
    expect(idle.members[0]).toMatchObject({ stamina: 6, responseSpent: 6 });
    expect(idle.members.slice(1).map((member) => member.stamina)).toEqual([0, 3]);
  });
  it('招集0は到着したtickに通常担当が復旧し、そのtickは出荷しない', () => {
    let state = createStandbyPrototype('RI-170', true, { mobilizationTicks: 0 });
    state = applyStandbyInput(state, { type: 'tick' });
    state = applyStandbyInput(state, { type: 'tick' });
    expect(state.incidents[0]).toMatchObject({ workLeft: 0, doneTick: 2, mobilizationLeft: 0 });
    expect(state).toMatchObject({ stoppedTicks: 1, value: 5 });
  });
  it('対照のcoder待機とtick3交代は初回の反復障害と同じ入力と差引になる', () => {
    const legacy = compareStandbyStrategies(factors.seed).filter((row) => row.incidents);
    const rows = compareStandbyFactorReversals(factors.seed);
    const baseline = rows.find((row) => row.factor === 'baseline' && row.strategy === 'coder')!;
    const legacyCoder = legacy.find((row) => row.strategy === 'coder')!;
    expect(baseline.inputs).toEqual(legacyCoder.inputs);
    expect(baseline.result).toEqual(legacyCoder.result);
    const rotated = runStandbyPlan(createStandbyPrototype(factors.seed, true), [
      { at: 0, id: 'ace', lane: 'standby' },
      { at: 3, id: 'coder', lane: 'standby' },
    ]);
    const legacyRotate = legacy.find((row) => row.strategy === 'rotate')!;
    expect(rotated.inputs).toEqual(legacyRotate.inputs);
    expect(summarizeStandby(rotated)).toEqual(legacyRotate.result);
  });
  it('要因を一つずつ動かすと、待機と置かないの優劣は一部だけで反転する', () => {
    const rows = compareStandbyFactorReversals(factors.seed);
    expect(rows).toEqual(factors.results);
    expect(rows.map((row) => [row.factor, row.strategy, row.result.netValue])).toEqual([
      ['baseline', 'none', 8],
      ['baseline', 'coder', 23],
      ['forecast-1', 'none', 8],
      ['forecast-1', 'coder', 25],
      ['forecast-0', 'none', 8],
      ['forecast-0', 'coder', 21],
      ['mobilization-1', 'none', 17],
      ['mobilization-1', 'coder', 23],
      ['mobilization-0', 'none', 26],
      ['mobilization-0', 'coder', 23],
      ['normal-stamina-1', 'none', 5],
      ['normal-stamina-1', 'coder', 17],
      ['normal-stamina-2', 'none', 5],
      ['normal-stamina-2', 'coder', 5],
      ['normal-stamina-3', 'none', 3],
      ['normal-stamina-3', 'coder', 2],
      ['normal-stamina-4', 'none', -2],
      ['normal-stamina-4', 'coder', -1],
      ['reviewer', 'none', 8],
      ['reviewer', 'reviewer', -15],
      ['rotate-4', 'none', 8],
      ['rotate-4', 'rotate', 19],
      ['rotate-5', 'none', 8],
      ['rotate-5', 'rotate', 18],
      ['rotate-6', 'none', 8],
      ['rotate-6', 'rotate', 5],
      ['rest-1', 'none', 3],
      ['rest-1', 'coder', 18],
      ['rest-6', 'none', 3],
      ['rest-6', 'coder', 3],
      ['rest-7', 'none', 3],
      ['rest-7', 'coder', 0],
      ['rest-8', 'none', -3],
      ['rest-8', 'coder', -3],
      ['rest-9', 'none', -3],
      ['rest-9', 'coder', -6],
      ['overlap-5', 'none', 5],
      ['overlap-5', 'coder', 23],
      ['overlap-4', 'none', 4],
      ['overlap-4', 'coder', 22],
      ['overlap-2', 'none', 2],
      ['overlap-2', 'coder', 20],
    ]);
    const verdict = (factor: string) => {
      const pair = rows.filter((row) => row.factor === factor);
      const skip = pair.find((row) => row.strategy === 'none')!;
      const place = pair.find((row) => row.strategy !== 'none')!;
      if (place.result.netValue === skip.result.netValue) return 'tie';
      return place.result.netValue > skip.result.netValue ? 'standby' : 'none';
    };
    expect(verdict('mobilization-0')).toBe('none');
    expect(verdict('normal-stamina-2')).toBe('tie');
    expect(verdict('normal-stamina-3')).toBe('none');
    expect(verdict('normal-stamina-4')).toBe('standby');
    expect(verdict('reviewer')).toBe('none');
    expect(verdict('rotate-5')).toBe('standby');
    expect(verdict('rotate-6')).toBe('none');
    expect(verdict('rest-6')).toBe('tie');
    expect(verdict('rest-7')).toBe('none');
    expect(verdict('rest-8')).toBe('tie');
    expect(verdict('forecast-0')).toBe('standby');
    expect(verdict('overlap-2')).toBe('standby');
    expect(
      rows.find((row) => row.factor === 'reviewer' && row.strategy === 'reviewer')!.result,
    ).toMatchObject({
      value: 0,
      remainingWork: 3,
      customerLoss: 11,
    });
    expect(
      rows.find((row) => row.factor === 'rotate-6' && row.strategy === 'rotate')!.result.members[1],
    ).toMatchObject({
      id: 'ace',
      stamina: 0,
    });
    expect(
      rows.find((row) => row.factor === 'normal-stamina-4' && row.strategy === 'none')!.result,
    ).toMatchObject({ remainingWork: 1 });
  });
  it('予告・招集・体力・交代・休息・重なりの隣の値も再計算できる', () => {
    const coderAt = (at: number): StandbyAssignment => ({ at, id: 'coder', lane: 'standby' });
    const score = (plan: readonly StandbyAssignment[], setup?: StandbySetup) =>
      summarizeStandby(runStandbyPlan(createStandbyPrototype(factors.seed, true, setup), plan))
        .netValue;
    expect([2, 1, 0].map((lead) => score([coderAt(2 - lead)]))).toEqual([23, 25, 21]);
    expect([2, 1, 0].map((mobilizationTicks) => score([], { mobilizationTicks }))).toEqual([
      8, 17, 26,
    ]);
    expect(
      [0, 1, 2, 3, 4].map((normalStaminaCost) =>
        score([coderAt(0)], normalStaminaCost ? { normalStaminaCost } : undefined),
      ),
    ).toEqual([23, 17, 5, 2, -1]);
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((at) =>
        score([{ at: 0, id: 'ace', lane: 'standby' }, coderAt(at)]),
      ),
    ).toEqual([21, 21, 20, 19, 18, 5, 4, 3, 3]);
    const rest = (length: number, withCoder: boolean) =>
      score([
        { at: 0, id: 'ace', lane: 'bench' },
        ...(withCoder ? [coderAt(0)] : []),
        { at: length, id: 'ace', lane: 'coding' },
      ]);
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((length) => rest(length, true) - rest(length, false)),
    ).toEqual([15, 12, 9, 6, 3, 0, -3, 0, -3]);
    expect(
      [6, 5, 4, 3, 2].map(
        (secondArrivesAt) =>
          score([coderAt(0)], { secondArrivesAt }) - score([], { secondArrivesAt }),
      ),
    ).toEqual([15, 18, 18, 18, 18]);
  });
  it('要因比較も毎入力JSON保存再開と再生が一致し、期末で止まる', () => {
    for (const row of compareStandbyFactorReversals(factors.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = applyStandbyInput(live, input);
        saved = applyStandbyInput(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(live.tick).toBe(live.horizon);
      expect(summarizeStandby(live)).toEqual(row.result);
      expect(live.incidents).toHaveLength(2);
      expect(live.members.map((member) => member.id)).toEqual(['coder', 'ace', 'reviewer']);
    }
  });
});
