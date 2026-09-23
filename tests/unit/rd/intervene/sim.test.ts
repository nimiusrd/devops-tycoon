import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIONS, KNOBS, SEED_DEFS } from '../../../../src/rd/intervene/knobs';
import {
  advancePeriod,
  companyScore,
  countSupport,
  createInitialState,
  peekTeam,
  resolvePeriod,
  resolveTeamPeriod,
  runRemaining,
  setTeamAction,
  teamPeriodRngKey,
  totalsFromState,
} from '../../../../src/rd/intervene/sim';
import type { PeriodActions, TeamState } from '../../../../src/rd/intervene/types';
import { TEAM_IDS } from '../../../../src/rd/intervene/types';

const ALL_DELEGATE: PeriodActions = DEFAULT_ACTIONS;

function shuffledTeams(teams: readonly TeamState[]): TeamState[] {
  return [teams[2], teams[0], teams[1]];
}

describe('rd/intervene sim', () => {
  it('同じシードと同じ方針なら二回走らせても結果が一致する', () => {
    const first = runRemaining(createInitialState('crisis', 'always-intervene'));
    const second = runRemaining(createInitialState('crisis', 'always-intervene'));
    expect(first.logs).toEqual(second.logs);
    expect(first.teams).toEqual(second.teams);
    expect(first.judgmentCount).toBe(second.judgmentCount);
  });

  it('チーム配列の順番を変えても期間結果が変わらない', () => {
    const seed = SEED_DEFS.crisis;
    const actions: PeriodActions = {
      alpha: 'support',
      bravo: 'delegate',
      charlie: 'train',
    };
    const left = resolvePeriod({
      period: 1,
      rngSeed: seed.rngSeed,
      teams: seed.teams,
      actions,
    });
    const right = resolvePeriod({
      period: 1,
      rngSeed: seed.rngSeed,
      teams: shuffledTeams(seed.teams),
      actions,
    });
    expect(left).toEqual(right);
  });

  it('閲覧順を変えても peek は状態も乱数も動かさない', () => {
    const start = createInitialState('stable');
    const before = structuredClone(start);
    for (const id of ['charlie', 'alpha', 'bravo'] as const) {
      const viewed = peekTeam(start, id);
      expect(viewed).toEqual(start.teams.find((team) => team.id === id));
      expect(viewed).not.toBe(start.teams.find((team) => team.id === id));
    }
    expect(start).toEqual(before);
    const afterView = runRemaining({ ...start, arm: 'full-delegate' });
    const noView = runRemaining(createInitialState('stable', 'full-delegate'));
    expect(afterView.logs).toEqual(noView.logs);
  });

  it('直接支援は1チームまでに制限する', () => {
    expect(countSupport({ alpha: 'support', bravo: 'support', charlie: 'delegate' })).toBe(2);
    expect(() =>
      resolvePeriod({
        period: 1,
        rngSeed: SEED_DEFS.crisis.rngSeed,
        teams: SEED_DEFS.crisis.teams,
        actions: { alpha: 'support', bravo: 'support', charlie: 'delegate' },
      }),
    ).toThrow(/直接支援は1期間あたり1チームまで/);
  });

  it('2つ目の直接支援を選ぶと既存の支援は委任に戻る', () => {
    const next = setTeamAction(
      setTeamAction(createInitialState('crisis'), 'alpha', 'support'),
      'bravo',
      'support',
    );
    expect(next.plannedActions).toEqual({
      alpha: 'delegate',
      bravo: 'support',
      charlie: 'delegate',
    });
    expect(countSupport(next.plannedActions)).toBe(1);
  });

  it('育成は今期の出荷を弱め、次期能力だけを上げる', () => {
    const team = SEED_DEFS.stable.teams[0];
    const trained = resolveTeamPeriod(team, 'train', 1, SEED_DEFS.stable.rngSeed);
    const delegated = resolveTeamPeriod(team, 'delegate', 1, SEED_DEFS.stable.rngSeed);
    expect(trained.capability).toBe(team.capability + KNOBS.train.nextCapabilityAdd);
    expect(delegated.capability).toBe(team.capability);
    expect(trained.output).toBeLessThan(delegated.output);
  });

  it('直接支援は同じシードの委任より今期の危機を大きく下げる', () => {
    const team = SEED_DEFS.crisis.teams[1];
    const supported = resolveTeamPeriod(team, 'support', 1, SEED_DEFS.crisis.rngSeed);
    const delegated = resolveTeamPeriod(team, 'delegate', 1, SEED_DEFS.crisis.rngSeed);
    expect(supported.crisis).toBeLessThan(delegated.crisis);
    expect(supported.output).toBeGreaterThan(delegated.output);
  });

  it('委任に見ていないことだけを理由にした罰は無い', () => {
    const team = SEED_DEFS.stable.teams[2];
    const first = resolveTeamPeriod(team, 'delegate', 2, SEED_DEFS.stable.rngSeed);
    const second = resolveTeamPeriod(team, 'delegate', 2, SEED_DEFS.stable.rngSeed);
    expect(first).toEqual(second);
    expect(first.fatigue).toBeLessThanOrEqual(
      team.fatigue * KNOBS.fatigueCarry +
        KNOBS.metricMax * KNOBS.fatigueFromOverload +
        KNOBS.delegate.fatigueAdd +
        0.0001,
    );
  });

  it('方針を維持した期間は判断回数を増やさない', () => {
    const opened = createInitialState('stable', 'full-delegate');
    const done = runRemaining(opened);
    expect(done.judgmentCount).toBe(0);
    expect(done.logs.every((log) => log.judgmentDelta === 0)).toBe(true);
  });

  it('方針を変えた期間だけ判断回数を1足す', () => {
    const start = createInitialState('crisis', 'always-intervene');
    const done = runRemaining(start);
    expect(done.judgmentCount).toBe(1);
    expect(done.logs[0]?.judgmentDelta).toBe(1);
    expect(done.logs.slice(1).every((log) => log.judgmentDelta === 0)).toBe(true);
  });

  it('会社成果は文書どおりの加重和である', () => {
    const teams: TeamState[] = TEAM_IDS.map((id, index) => ({
      id,
      name: `t${index}`,
      pressure: 0,
      capability: 0,
      crisis: 10,
      output: 20,
      fatigue: 5,
    }));
    expect(companyScore(teams)).toBe(20 * 3 - 0.4 * 10 * 3 - 0.2 * 5 * 3);
  });

  it('4期間で終わり、ログに必須指標が揃う', () => {
    const done = runRemaining(createInitialState('crisis', 'situation'));
    expect(done.finished).toBe(true);
    expect(done.logs).toHaveLength(4);
    for (const log of done.logs) {
      expect(log.teams).toHaveLength(3);
      expect(log).toEqual(
        expect.objectContaining({
          outputSum: expect.any(Number),
          fatigueSum: expect.any(Number),
          crisisSum: expect.any(Number),
          nextCapabilitySum: expect.any(Number),
          companyScore: expect.any(Number),
          judgmentCount: expect.any(Number),
        }),
      );
    }
    const totals = totalsFromState(done);
    expect(totals.judgmentCount).toBe(done.judgmentCount);
  });

  it('RNG キーは期間とチームだけで決まり閲覧を含まない', () => {
    expect(teamPeriodRngKey('rd-intervene-crisis', 3, 'bravo')).toBe(
      'rd-intervene-crisis:period:3:team:bravo',
    );
  });

  it('終了後の advance は何もしない', () => {
    const done = runRemaining(createInitialState('stable', 'full-delegate'));
    expect(advancePeriod(done)).toBe(done);
  });

  it('手動で全委任のまま進めると初期方針維持になる', () => {
    const first = advancePeriod(createInitialState('stable'));
    expect(first.plannedActions).toEqual(ALL_DELEGATE);
    expect(first.judgmentCount).toBe(0);
  });
});
