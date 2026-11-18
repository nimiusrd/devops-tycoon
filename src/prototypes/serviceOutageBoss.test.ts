import { describe, expect, it } from 'vitest';
import {
  applyServiceOutageBoss as apply,
  compareServiceOutageBoss as compare,
  createServiceOutageBoss as create,
  summarizeServiceOutageBoss as summarize,
  viewServiceOutageBoss as view,
  type OutageInput,
  type OutageRoute,
  type ServiceOutageState,
} from './serviceOutageBoss';
import comparison from '../../docs/prototypes/service-outage-comparison.json';

function advance(state: ServiceOutageState, count = 1) {
  for (let i = 0; i < count; i++) state = apply(state, { type: 'advance' });
  return state;
}

function respond(state: ServiceOutageState, route: OutageRoute) {
  for (const feature of state.features) {
    state = apply(state, { type: 'respond', feature: feature.id, route });
  }
  return state;
}

describe('RI-259 架空サービス停止ボス', () => {
  it('準備で依存機能2件・無関係な仕事・価値・工数・停止/復旧tickを公開する', () => {
    const snapshot = view(create());
    expect(snapshot).toMatchObject({
      phase: 'prepare',
      capacity: 4,
      activeTicks: 8,
      outageAt: 2,
      recoveryAt: 7,
      unrelatedJob: { id: 'catalog', dependency: null, workPerTick: 1 },
      result: null,
    });
    expect(
      snapshot.features.map((feature) => [feature.id, feature.dependency, feature.job]),
    ).toEqual([
      ['notifications', 'relay-cloud', 'delivery'],
      ['reports', 'relay-cloud', 'aggregation'],
    ]);
    expect(snapshot.features.every((feature) => !feature.canRespond && !feature.canResume)).toBe(
      true,
    );
    expect(snapshot.features[0]).toMatchObject({
      fullValue: 6,
      reducedValue: 3,
      alternativeWork: 5,
      reductionWork: 1,
      verificationWork: 1,
      reconnectWork: 2,
      maintenanceWork: 3,
    });
  });

  it('停止は依存先だけに作用し、無対応でも全tick進行して元経路が復旧する', () => {
    const state = advance(create(), 9);
    expect(state.periods.map((period) => period.provider)).toEqual([
      'up',
      'down',
      'down',
      'down',
      'down',
      'down',
      'up',
      'up',
    ]);
    expect(state.periods.filter((period) => period.providerEvent !== null)).toMatchObject([
      { tick: 2, providerEvent: 'stopped' },
      { tick: 7, providerEvent: 'recovered' },
    ]);
    expect(
      state.periods.every((period) => period.unrelatedWork === 1 && period.normalWork === 3),
    ).toBe(true);
    expect(summarize(state)).toMatchObject({
      completed: true,
      continued: true,
      featureValue: 30,
      responseWork: 0,
      unrelatedWork: 8,
      carryoverWork: 0,
    });
    expect(
      summarize(state).features.map((feature) => [feature.stoppedTicks, feature.fullRestoredAt]),
    ).toEqual([
      [5, 7],
      [5, 7],
    ]);
  });

  it('代替実装が終わっても検証前は停止し、検証完了tickから全価値を残す', () => {
    const started = advance(create(), 2);
    expect(view(started)).toMatchObject({ phase: 'peak', provider: 'down' });
    const onlyNotify = apply(started, {
      type: 'respond',
      feature: 'notifications',
      route: 'alternative',
    });
    const work = advance(onlyNotify);
    expect(work.features[0]).toMatchObject({
      implementationLeft: 2,
      verificationLeft: 1,
      readyAt: null,
    });
    expect(work.periods[1]!.features.map((feature) => feature.mode)).toEqual([
      'stopped',
      'stopped',
    ]);
    const unverified = structuredClone(work);
    unverified.capacity = 3; // 無関係1を確保し、残り2で実装だけが完了する境界。
    const implemented = advance(unverified);
    expect(implemented.features[0]).toMatchObject({
      implementationLeft: 0,
      verificationLeft: 1,
      readyAt: null,
    });
    expect(implemented.periods[2]!.features[0]!.mode).toBe('stopped');
    const verified = advance(implemented);
    expect(verified.features[0]!.readyAt).toBe(4);
    expect(verified.periods[3]!.features).toEqual([
      { id: 'notifications', mode: 'alternative', value: 6 },
      { id: 'reports', mode: 'stopped', value: 0 },
    ]);
    expect(summarize(verified).maintenanceWork).toBe(3);
  });

  it('縮小は一部価値を早く戻し、依存先復旧と明示再開と再接続検証の全てを要する', () => {
    const configured = advance(respond(advance(create(), 2), 'reduced'), 2);
    expect(configured.features.map((feature) => feature.readyAt)).toEqual([2, 3]);
    expect(configured.periods[1]!.features).toEqual([
      { id: 'notifications', mode: 'reduced', value: 3 },
      { id: 'reports', mode: 'stopped', value: 0 },
    ]);
    expect(apply(configured, { type: 'resume', feature: 'notifications' })).toBe(configured);
    const recovered = advance(configured, 3); // 次に処理するtick7は復旧済み。
    expect(view(recovered).features.every((feature) => feature.canResume)).toBe(true);
    const noResume = advance(recovered, 2);
    expect(noResume.periods[7]!.features.every((feature) => feature.mode === 'reduced')).toBe(true);
    expect(summarize(noResume)).toMatchObject({ remainingResponseWork: 4, maintenanceWork: 0 });
    let restarting = recovered;
    for (const feature of recovered.features)
      restarting = apply(restarting, { type: 'resume', feature: feature.id });
    const partial = advance(restarting);
    expect(partial.features.map((feature) => [feature.reconnectLeft, feature.resumedAt])).toEqual([
      [0, 7],
      [1, null],
    ]);
    expect(partial.periods[6]!.features.map((feature) => feature.mode)).toEqual([
      'native',
      'reduced',
    ]);
    expect(advance(partial).features.map((feature) => feature.resumedAt)).toEqual([7, 8]);
  });

  it('対応時点・対象を入力で変えられ、未完了の実装/検証/再接続を持ち越す', () => {
    const late = respond(advance(create(), 6), 'alternative');
    const ended = advance(late, 3);
    expect(summarize(ended)).toMatchObject({
      remainingResponseWork: 3,
      maintenanceWork: 6,
      carryoverWork: 9,
    });
    expect(
      ended.features.map((feature) => [feature.implementationLeft, feature.verificationLeft]),
    ).toEqual([
      [0, 0],
      [2, 1],
    ]);
    const long = advance(respond(advance(create('long', 7), 2), 'reduced'), 7);
    expect(summarize(long)).toMatchObject({
      providerRecoveryPending: true,
      remainingResponseWork: 4,
    });
    expect(summarize(long).features.every((feature) => feature.fullRestoredAt === null)).toBe(true);
    expect(view(long).features.every((feature) => !feature.canResume)).toBe(true);
    expect(view(long).provider).toBe('down');
    const waiting = advance(create('long', 7), 9);
    expect(view(waiting).features.every((feature) => feature.mode === 'stopped')).toBe(true);
  });

  it('時期違い・未知対象/方針・二重対応/再開・終了後の入力を無消費で拒否する', () => {
    const first = create();
    const command: OutageInput = { type: 'respond', feature: 'notifications', route: 'reduced' };
    expect(apply(first, command)).toBe(first);
    const stopped = advance(first, 2);
    expect(apply(stopped, { ...command, feature: 'unknown' } as unknown as OutageInput)).toBe(
      stopped,
    );
    expect(apply(stopped, { ...command, route: 'unknown' } as unknown as OutageInput)).toBe(
      stopped,
    );
    const selected = apply(stopped, command);
    expect(apply(selected, command)).toBe(selected);
    const recovered = advance(selected, 5);
    expect(apply(recovered, { type: 'resume', feature: 'reports' })).toBe(recovered);
    const resuming = apply(recovered, { type: 'resume', feature: 'notifications' });
    expect(apply(resuming, { type: 'resume', feature: 'notifications' })).toBe(resuming);
    const ended = advance(resuming, 2);
    expect(apply(ended, command)).toBe(ended);
    expect(advance(ended)).toBe(ended);
    expect(() => create('invalid', 0)).toThrow(RangeError);
    expect(() => create('invalid', 8)).toThrow(RangeError);
    expect(() => create('invalid', 1.5)).toThrow(RangeError);
  });

  it('同条件の3方針・停止期間/対応時点/単価感度をJSONと照合する', () => {
    const rows = compare();
    expect(rows).toEqual(comparison.results);
    expect(compare(2)).toEqual(comparison.shortOutage);
    expect(compare(7)).toEqual(comparison.longOutage);
    expect(compare(5, 4)).toEqual(comparison.lateResponse);
    expect(
      rows.every((row) => JSON.stringify(row.initial) === JSON.stringify(rows[0]!.initial)),
    ).toBe(true);
    expect(rows.map((row) => row.result.comparisonValue)).toEqual([94, 90, 99]);
    expect(rows[1]!.sensitivity[0]!.comparisonValue).toBeGreaterThan(
      rows[2]!.sensitivity[0]!.comparisonValue,
    );
    expect(rows[1]!.result.featureValue).toBeGreaterThan(rows[2]!.result.featureValue);
    expect(rows[1]!.result.responseWork).toBeGreaterThan(rows[2]!.result.responseWork);
    expect(rows[1]!.result.maintenanceWork).toBeGreaterThan(rows[2]!.result.maintenanceWork);
    // 短い停止では無対応が上回る。無対応を即敗北にはしない。
    const short = compare(2);
    expect(short[0]!.result.comparisonValue).toBeGreaterThan(short[1]!.result.comparisonValue);
    expect(short[0]!.result.comparisonValue).toBeGreaterThan(short[2]!.result.comparisonValue);
  });

  it('全入力再生・毎入力JSON保存再開・閲覧挿入が一致し、元状態と工数を保存する', () => {
    for (const row of [...compare(), ...compare(2), ...compare(7), ...compare(5, 4)]) {
      let live = create(row.initial.seed, row.initial.recoveryAt - row.initial.outageAt);
      let resumed = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        expect(previous).toEqual(before);
        expect(before).toEqual(resumed);
        resumed = JSON.parse(JSON.stringify(resumed));
        const snapshot = view(resumed);
        snapshot.features[0]!.implementationLeft = 999;
        snapshot.periods.length = 0;
        resumed = apply(apply(resumed, { type: 'view' }), input);
        expect(resumed).toEqual(live);
        for (const period of live.periods) {
          expect(
            period.implementation +
              period.verification +
              period.reconnect +
              period.unrelatedWork +
              period.normalWork,
          ).toBe(live.capacity);
          expect(period.unrelatedWork).toBe(1);
        }
        const chosen = live.features.filter((feature) => feature.route !== null);
        const spent = (key: 'implementation' | 'verification' | 'reconnect') =>
          live.periods.reduce((sum, period) => sum + period[key], 0);
        expect(
          spent('implementation') +
            chosen.reduce((sum, feature) => sum + feature.implementationLeft, 0),
        ).toBe(
          chosen.reduce(
            (sum, feature) =>
              sum +
              (feature.route === 'alternative' ? feature.alternativeWork : feature.reductionWork),
            0,
          ),
        );
        expect(
          spent('verification') +
            chosen.reduce((sum, feature) => sum + feature.verificationLeft, 0),
        ).toBe(chosen.reduce((sum, feature) => sum + feature.verificationWork, 0));
        expect(
          spent('reconnect') + chosen.reduce((sum, feature) => sum + feature.reconnectLeft, 0),
        ).toBe(
          chosen
            .filter((feature) => feature.route === 'reduced')
            .reduce((sum, feature) => sum + feature.reconnectWork, 0),
        );
        for (const feature of live.features) {
          if (feature.readyAt !== null)
            expect(feature.implementationLeft + feature.verificationLeft).toBe(0);
          if (feature.resumedAt !== null) expect(feature.reconnectLeft).toBe(0);
        }
      }
      expect(live.periods).toEqual(row.periods);
      expect(summarize(live)).toEqual(row.result);
      expect(view(live).phase).toBe('result');
    }
  });
});
