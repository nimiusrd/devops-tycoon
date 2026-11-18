import { describe, expect, it } from 'vitest';
import {
  applyTeamIntegrationBoss as apply,
  compareTeamIntegrationBoss as compare,
  createTeamIntegrationBoss as create,
  summarizeTeamIntegrationBoss as summarize,
  viewTeamIntegrationBoss as view,
  type IntegrationInput,
  type IntegrationState,
  type IntegrationWork,
} from './teamIntegrationBoss';
import comparison from '../../docs/prototypes/team-integration-comparison.json';

function advance(state: IntegrationState, periods = 1) {
  for (let n = 0; n < periods; n++) state = apply(state, { type: 'advance' });
  return state;
}

function spent(state: IntegrationState, key: keyof IntegrationWork) {
  return state.periods.reduce((sum, p) => sum + p.alpha[key] + p.beta[key], 0);
}

function conserved(state: IntegrationState) {
  for (const period of state.periods) {
    for (const [index, ledger] of [period.alpha, period.beta].entries()) {
      expect(Object.values(ledger).reduce((sum, value) => sum + value, 0)).toBe(
        state.teams[index]!.capacity,
      );
      expect(Object.values(ledger).every((value) => Number.isInteger(value) && value >= 0)).toBe(
        true,
      );
    }
  }
  expect(
    spent(state, 'preparation') + state.jobs.reduce((sum, j) => sum + j.preparationLeft, 0),
  ).toBe(state.jobs.length * 2);
  expect(spent(state, 'approval') + state.jobs.reduce((sum, j) => sum + j.approvalLeft, 0)).toBe(
    state.jobs.length * 2,
  );
  expect(
    spent(state, 'translation') + state.jobs.reduce((sum, j) => sum + j.translationLeft, 0),
  ).toBe(state.jobs.length * state.rules.mismatchWork);
  expect(spent(state, 'rework') + state.jobs.reduce((sum, j) => sum + j.reworkLeft, 0)).toBe(
    state.jobs.reduce((sum, j) => sum + j.reworkCreated, 0),
  );
  const assignedMigration =
    state.route === null
      ? 0
      : state.route === 'coexist'
        ? 2
        : state.route === 'immediate' || state.expanding
          ? state.rules.migrationWork
          : 1;
  expect(spent(state, 'migration') + state.setupLeft + state.expansionLeft).toBe(assignedMigration);
  expect(spent(state, 'training') + Number(state.trainingPending) * 3).toBe(
    state.inputs.filter((input) => input.type === 'train').length * 3,
  );
  for (const [index, team] of state.teams.entries()) {
    const ledgerKey = index === 0 ? 'alpha' : 'beta';
    expect(team.localWork).toBe(state.periods.reduce((sum, p) => sum + p[ledgerKey].local, 0));
    expect(team.localValue).toBe(team.localWork * team.localValuePerWork);
    expect(team).toMatchObject(
      index === 0
        ? { id: 'alpha', specialty: 'implementation', capacity: 6, localValuePerWork: 2 }
        : {
            id: 'beta',
            specialty: 'operations',
            capacity: state.rules.betaCapacity,
            localValuePerWork: 3,
          },
    );
  }
  expect(state.teams[0].writtenFluency).toBe(2);
  expect(state.teams[1].writtenFluency).toBeGreaterThanOrEqual(0);
  expect(state.teams[1].writtenFluency).toBeLessThanOrEqual(2);
  for (const job of state.jobs.filter((j) => j.completedAt !== null)) {
    expect(job.preparationLeft + job.approvalLeft + job.reworkLeft).toBe(0);
    expect(job.preparedAt).not.toBeNull();
    expect(job.completedAt).toBeGreaterThanOrEqual(job.preparedAt!);
  }
}

describe('RI-260 別文化チーム統合の独立期間モデル', () => {
  it('承認記録の差1件と独立能力・共同案件の前提・費用を準備時点で読める', () => {
    const state = create();
    expect(view(state)).toMatchObject({
      phase: 'prepare',
      route: null,
      rules: {
        migrationWork: 4,
        mismatchWork: 3,
        reworkPerGap: 2,
        dualWork: 2,
      },
    });
    expect(
      state.teams.map((t) => [t.convention, t.capacity, t.localValuePerWork, t.writtenFluency]),
    ).toEqual([
      ['written', 6, 2, 2],
      ['oral', 6, 3, 0],
    ]);
    expect(state.jobs.map((j) => [j.releaseAt, j.preparationLeft, j.approvalLeft])).toEqual(
      Array.from({ length: 6 }, (_, n) => [n + 1, 2, 2]),
    );
  });

  it('無操作は異形式の受け渡しを翌期まで待ち、記録変換を実際に払い進行する', () => {
    const first = advance(create());
    expect(first.jobs[0]).toMatchObject({
      preparedAt: 1,
      completedAt: null,
      handoffWaitPeriods: 1,
      translationLeft: 3,
      approvalLeft: 2,
    });
    expect(first.periods[0]!.beta).toMatchObject({ local: 6, translation: 0, approval: 0 });
    const second = advance(first);
    expect(second.jobs[0]).toMatchObject({ completedAt: 2, translationLeft: 0, reworkCreated: 0 });
    expect(second.periods[1]!.beta).toMatchObject({ translation: 3, approval: 2, local: 1 });
    expect(summarize(advance(second, 4))).toMatchObject({
      completed: 5,
      pendingJobs: 1,
      migrationWork: 0,
      trainingWork: 0,
      dualWork: 0,
      lost: false,
    });
  });

  it('共通記録は移行工数完了まで使えず、未習熟の承認は手戻り完了まで出荷しない', () => {
    const chosen = apply(create(), { type: 'integrate', route: 'immediate' });
    expect(chosen.tick).toBe(0);
    expect(chosen.teams[1].convention).toBe('oral');
    const first = advance(chosen);
    expect(first.periods[0]!.beta).toMatchObject({ migration: 4, approval: 2, rework: 0 });
    expect(first.jobs[0]).toMatchObject({
      approvalLeft: 0,
      reworkCreated: 4,
      reworkLeft: 4,
      completedAt: null,
      handoffWaitPeriods: 0,
    });
    expect(first.teams[1]).toMatchObject({ convention: 'written', writtenFluency: 0 });
    const second = advance(first);
    expect(second.jobs[0]).toMatchObject({ completedAt: 2, reworkLeft: 0 });
    expect(second.jobs[1]!.reworkCreated).toBe(2);
    const costly = advance(
      apply(create('costly', { migrationWork: 8 }), {
        type: 'integrate',
        route: 'immediate',
      }),
    );
    expect(costly).toMatchObject({ setupLeft: 2 });
    expect(costly.teams[1].convention).toBe('oral');
    expect(costly.periods[0]!.compatible).toBe(false);
  });

  it('pilotは現場規約を残し、演習と二重台帳を払い、展開完了で二重運用を止める', () => {
    let state = apply(create(), { type: 'integrate', route: 'pilot' });
    state = advance(apply(state, { type: 'train' }));
    expect(state.teams[1]).toMatchObject({ convention: 'oral', writtenFluency: 1 });
    expect(state.periods[0]!).toMatchObject({
      compatible: true,
      alpha: { training: 1, dual: 1 },
      beta: { migration: 1, training: 2, dual: 2 },
    });
    state = advance(apply(state, { type: 'train' }));
    const expanding = apply(state, { type: 'expand' });
    expect(expanding.teams[1].convention).toBe('oral');
    state = advance(expanding);
    expect(state.teams[1]).toMatchObject({ convention: 'written', writtenFluency: 2 });
    expect(state.periods[2]!.beta).toMatchObject({ migration: 3, dual: 0 });
    expect(summarize(state).migrationWork).toBe(4);
  });

  it('併存は規約を変えず二重台帳を毎期払い、不足時は互換にならない', () => {
    const first = advance(apply(create(), { type: 'integrate', route: 'coexist' }));
    expect(first.jobs[0]!.completedAt).toBe(1);
    expect(first.teams[1]).toMatchObject({ convention: 'oral', writtenFluency: 0 });
    expect(first.periods[0]!).toMatchObject({
      compatible: true,
      alpha: { dual: 1 },
      beta: { migration: 2, dual: 2, approval: 2, translation: 0, rework: 0 },
    });
    const busy = advance(
      apply(create('busy', { betaCapacity: 2 }), {
        type: 'integrate',
        route: 'coexist',
      }),
    );
    expect(busy.periods[0]!).toMatchObject({
      compatible: false,
      alpha: { dual: 0 },
      beta: { dual: 0 },
    });
    expect(busy.jobs[0]!.completedAt).toBeNull();
  });

  it('未知・重複・時期違い・終了後の入力を無消費で拒否し、長い作業は持ち越す', () => {
    const first = create();
    for (const input of [
      { type: 'expand' },
      { type: 'train' },
      { type: 'unknown' },
      { type: 'integrate', route: 'unknown' },
    ] as unknown as IntegrationInput[])
      expect(apply(first, input)).toBe(first);
    const pilot = apply(first, { type: 'integrate', route: 'pilot' });
    expect(apply(pilot, { type: 'expand' })).toBe(pilot);
    expect(apply(pilot, { type: 'integrate', route: 'immediate' })).toBe(pilot);
    const training = apply(pilot, { type: 'train' });
    expect(apply(training, { type: 'train' })).toBe(training);
    const expanded = apply(advance(pilot), { type: 'expand' });
    expect(apply(expanded, { type: 'expand' })).toBe(expanded);
    const ended = advance(
      apply(create('long', { horizon: 1, migrationWork: 20 }), {
        type: 'integrate',
        route: 'immediate',
      }),
    );
    expect(summarize(ended)).toMatchObject({ migrationWork: 6, migrationLeft: 14, lost: false });
    for (const input of [
      { type: 'advance' },
      { type: 'integrate', route: 'pilot' },
      { type: 'train' },
      { type: 'expand' },
    ] as IntegrationInput[])
      expect(apply(ended, input)).toBe(ended);
    for (const patch of [
      { horizon: 0 },
      { betaCapacity: 1.5 },
      { migrationWork: 1 },
      { reworkPerGap: -1 },
      { mismatchWork: NaN },
      { dualWork: Infinity },
      { jointJobs: 21 },
    ])
      expect(() => create('invalid', patch)).toThrow(RangeError);
  });

  it('閲覧・入力履歴・係数・チームへの参照を外へ共有しない', () => {
    const patch = { migrationWork: 4 };
    const initial = create('reference', patch);
    patch.migrationWork = 20;
    expect(initial.rules.migrationWork).toBe(4);
    const input: IntegrationInput = { type: 'integrate', route: 'pilot' };
    const selected = apply(initial, input);
    input.route = 'immediate';
    expect(selected.inputs[0]).toEqual({ type: 'integrate', route: 'pilot' });
    const copy = view(selected);
    copy.teams[1].capacity = 999;
    copy.jobs.length = 0;
    copy.inputs.length = 0;
    copy.result.teams[0]!.localValue = 999;
    expect(selected.teams[1].capacity).toBe(6);
    expect(selected.jobs).toHaveLength(6);
    expect(selected.inputs).toHaveLength(1);
    expect(selected.teams[0].localValue).toBe(0);
    expect(apply(selected, { type: 'view' })).toBe(selected);
    expect(initial.route).toBeNull();
  });

  it('同資源の全方針・感度・支払わない対照を保存JSONから再計算する', () => {
    const report = compare();
    expect(report).toEqual(comparison);
    const results = (name: string) =>
      report.cases.find((c) => c.name === name)!.strategies.map((s) => s.result);
    expect(results('baseline').map((r) => r.deliveredValue)).toEqual([162, 142, 138, 141]);
    expect(results('short-horizon').map((r) => r.deliveredValue)).toEqual([66, 40, 66, 72]);
    expect(results('cheap-dual-operation')[2]!.deliveredValue).toBeGreaterThan(
      results('cheap-dual-operation')[0]!.deliveredValue,
    );
    expect(results('no-unfamiliar-rework')[0]!.rework).toBe(0);
    expect(results('no-translation-work')[3]!).toMatchObject({
      translationWork: 0,
      handoffWaitPeriods: 6,
    });
    expect(results('no-joint-work')[3]!.deliveredValue).toBeGreaterThan(
      results('no-joint-work')[0]!.deliveredValue,
    );
    // pilotが勝つ行を作るための係数調整はしない。少ない手戻りと費用は別に読む。
    expect(results('baseline')[1]!.rework).toBeLessThan(results('baseline')[0]!.rework);
    expect(results('baseline')[1]!.trainingWork).toBeGreaterThan(0);
    expect(results('baseline')[1]!.dualWork).toBeGreaterThan(0);
  });

  it('全56入力列の毎入力JSON再開・全再生・閲覧挿入と資源保存が一致する', () => {
    for (const scenario of compare().cases) {
      for (const row of scenario.strategies) {
        let live = create(scenario.initial.seed, scenario.initial.rules);
        let resumed = structuredClone(live);
        expect(live).toEqual(scenario.initial);
        for (const input of row.inputs) {
          const previous = live;
          const before = structuredClone(live);
          live = apply(live, input);
          expect(previous).toEqual(before);
          resumed = JSON.parse(JSON.stringify(resumed));
          const snapshot = view(resumed);
          snapshot.teams.reverse();
          snapshot.periods.length = 0;
          resumed = apply(apply(resumed, { type: 'view' }), input);
          expect(resumed).toEqual(live);
          conserved(live);
        }
        expect(summarize(live)).toEqual(row.result);
        expect(view(live).phase).toBe('result');
        expect(live.inputs).toEqual(row.inputs);
      }
    }
  });
});
