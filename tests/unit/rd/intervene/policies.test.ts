import { describe, expect, it } from 'vitest';
import { KNOBS, SEED_DEFS } from '../../../../src/rd/intervene/knobs';
import { actionsForArm, situationActions } from '../../../../src/rd/intervene/policies';
import { applyArm, createInitialState, runRemaining } from '../../../../src/rd/intervene/sim';

describe('rd/intervene policies', () => {
  it('常時介入は毎回同じ1チームだけを支援する', () => {
    const actions = actionsForArm('always-intervene', {
      period: 4,
      teams: SEED_DEFS.crisis.teams,
    });
    expect(actions).toEqual({
      alpha: 'support',
      bravo: 'delegate',
      charlie: 'delegate',
    });
    expect(actions[KNOBS.alwaysInterveneTeam]).toBe('support');
  });

  it('育成して委任は前半育成・後半委任', () => {
    expect(
      actionsForArm('train-then-delegate', { period: 2, teams: SEED_DEFS.crisis.teams }),
    ).toEqual({
      alpha: 'train',
      bravo: 'train',
      charlie: 'train',
    });
    expect(
      actionsForArm('train-then-delegate', { period: 3, teams: SEED_DEFS.crisis.teams }),
    ).toEqual({
      alpha: 'delegate',
      bravo: 'delegate',
      charlie: 'delegate',
    });
  });

  it('全委任は3チームとも委任', () => {
    expect(actionsForArm('full-delegate', { period: 1, teams: SEED_DEFS.stable.teams })).toEqual({
      alpha: 'delegate',
      bravo: 'delegate',
      charlie: 'delegate',
    });
  });

  it('逼迫シードの状況選択は最も危機の大きいチームを支援する', () => {
    const actions = situationActions(SEED_DEFS.crisis.teams);
    expect(actions.bravo).toBe('support');
    expect(actions.alpha).not.toBe('support');
    expect(actions.charlie).not.toBe('support');
  });

  it('安定シードの状況選択は初期状態では全委任になる', () => {
    expect(situationActions(SEED_DEFS.stable.teams)).toEqual({
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
    ]);
    const always = runRemaining(applyArm(createInitialState('crisis'), 'always-intervene'));
    expect(always.logs.every((log) => log.actions.alpha === 'support')).toBe(true);
    expect(always.logs.every((log) => log.actions.bravo === 'delegate')).toBe(true);
  });
});
