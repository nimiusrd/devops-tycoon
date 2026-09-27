import { describe, expect, it } from 'vitest';
import { KNOBS, SEED_DEFS } from '../../../../src/rd/intervene/knobs';
import { actionsForArm, situationActions } from '../../../../src/rd/intervene/policies';
import {
  applyArm,
  createInitialState,
  runRemaining,
  totalsFromState,
} from '../../../../src/rd/intervene/sim';

describe('rd/intervene policies', () => {
  it('常時介入は毎回同じ1チームだけを支援する', () => {
    const actions = actionsForArm('always-intervene', {
      period: 4,
      teams: SEED_DEFS.crisis.teams,
      seedId: 'crisis',
    });
    expect(actions).toEqual({
      alpha: 'support',
      bravo: 'delegate',
      charlie: 'delegate',
    });
    expect(actions[KNOBS.alwaysInterveneTeam]).toBe('support');
  });

  it('育成して委任は逼迫も安定も前半3チーム育成・後半委任', () => {
    for (const seedId of ['crisis', 'stable'] as const) {
      expect(
        actionsForArm('train-then-delegate', {
          period: 2,
          teams: SEED_DEFS[seedId].teams,
          seedId,
        }),
      ).toEqual({
        alpha: 'train',
        bravo: 'train',
        charlie: 'train',
      });
      expect(
        actionsForArm('train-then-delegate', {
          period: 3,
          teams: SEED_DEFS[seedId].teams,
          seedId,
        }),
      ).toEqual({
        alpha: 'delegate',
        bravo: 'delegate',
        charlie: 'delegate',
      });
    }
  });

  it('全委任は3チームとも委任', () => {
    expect(
      actionsForArm('full-delegate', {
        period: 1,
        teams: SEED_DEFS.stable.teams,
        seedId: 'stable',
      }),
    ).toEqual({
      alpha: 'delegate',
      bravo: 'delegate',
      charlie: 'delegate',
    });
  });

  it('逼迫の状況選択は最大危機を支援し、他の能力不足チームを育成する', () => {
    const actions = situationActions(SEED_DEFS.crisis.teams, 'crisis');
    expect(actions).toEqual({
      alpha: 'train',
      bravo: 'support',
      charlie: 'train',
    });
  });

  it('安定の状況選択は初期状態では全委任のまま', () => {
    expect(situationActions(SEED_DEFS.stable.teams, 'stable')).toEqual({
      alpha: 'delegate',
      bravo: 'delegate',
      charlie: 'delegate',
    });
  });

  it('一括実行はアームの方針列を期間ログに残す', () => {
    const train = runRemaining(createInitialState('crisis', 'train-then-delegate'));
    expect(train.logs.map((log) => log.actions.alpha)).toEqual([
      'train',
      'train',
      'delegate',
      'delegate',
      'delegate',
      'delegate',
      'delegate',
      'delegate',
    ]);
    expect(train.logs.every((log) => log.actions.bravo === log.actions.alpha)).toBe(true);
    expect(train.logs.every((log) => log.actions.charlie === log.actions.alpha)).toBe(true);
    const trainSix = runRemaining(createInitialState('crisis', 'train-then-delegate', 6));
    expect(trainSix.logs.map((log) => log.actions.alpha)).toEqual([
      'train',
      'train',
      'delegate',
      'delegate',
      'delegate',
      'delegate',
    ]);
    const always = runRemaining(applyArm(createInitialState('crisis'), 'always-intervene'));
    expect(always.logs.every((log) => log.actions.alpha === 'support')).toBe(true);
    expect(always.logs.every((log) => log.actions.bravo === 'delegate')).toBe(true);
  });

  it('逼迫の育成して委任8期合計は3チーム育成方針に戻る', () => {
    expect(
      totalsFromState(runRemaining(createInitialState('crisis', 'train-then-delegate'))),
    ).toEqual(
      expect.objectContaining({
        companyScoreSum: -888.8,
        outputSum: 158.6,
        lastCrisisSum: 300,
        lastFatigueSum: 171.1,
        lastCapabilitySum: 188,
        judgmentCount: 2,
      }),
    );
  });

  it('安定シードの8期合計は方針変更前と同じ', () => {
    const expected = {
      'always-intervene': {
        companyScoreSum: 658.3,
        outputSum: 797.2,
        lastCrisisSum: 33.1,
        lastFatigueSum: 37.8,
        lastCapabilitySum: 216,
        judgmentCount: 1,
      },
      'train-then-delegate': {
        companyScoreSum: 770.8,
        outputSum: 837.4,
        lastCrisisSum: 0,
        lastFatigueSum: 10.1,
        lastCapabilitySum: 298,
        judgmentCount: 2,
      },
      'full-delegate': {
        companyScoreSum: 505.7,
        outputSum: 641.1,
        lastCrisisSum: 45.5,
        lastFatigueSum: 6.9,
        lastCapabilitySum: 216,
        judgmentCount: 0,
      },
      situation: {
        companyScoreSum: 505.7,
        outputSum: 641.1,
        lastCrisisSum: 45.5,
        lastFatigueSum: 6.9,
        lastCapabilitySum: 216,
        judgmentCount: 0,
      },
    } as const;
    for (const arm of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(totalsFromState(runRemaining(createInitialState('stable', arm)))).toEqual(
        expect.objectContaining(expected[arm]),
      );
    }
  });
});
