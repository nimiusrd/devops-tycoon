/**
 * RI-67: Easy 序盤で緊急対応を理解したプレイが即 seniorBurnout しないこと、
 * および難易度別のシニア体力初期値・鎮火コスト関係を検証する。
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_DEFS } from '../../src/data/difficulties';
import { FIREFIGHT_HP_COST } from '../../src/sim/actions';
import { INCIDENT_HP_COST, REVIEW_HP_COST, REVIEW_HP_REGEN } from '../../src/sim/model';
import { RunEngine } from '../../src/sim/run/engine';
import { advance } from './helpers/runFlow';

describe('RI-67 オンボーディングとシニア燃え尽き', () => {
  it('緊急対応コストは自動鎮火より安く、レビュー消費より回復が遅い前提が崩れていない', () => {
    expect(FIREFIGHT_HP_COST).toBeLessThan(INCIDENT_HP_COST);
    expect(REVIEW_HP_COST).toBeGreaterThan(REVIEW_HP_REGEN);
    expect(DIFFICULTY_DEFS.easy.org.seniorHp).toBeGreaterThanOrEqual(
      DIFFICULTY_DEFS.hard.org.seniorHp,
    );
    expect(DIFFICULTY_DEFS.normal.org.seniorHp).toBeGreaterThanOrEqual(
      DIFFICULTY_DEFS.nightmare.org.seniorHp,
    );
  });

  it('Easy・序盤代表 seed で緊急対応あり方針は2スプリント以内に seniorBurnout しない', () => {
    const engine = new RunEngine({ seed: 'review-hell', difficulty: 'easy' });
    engine.startRun();

    let guard = 0;
    while (
      engine.snapshot().status === 'playing' &&
      engine.snapshot().sprintsPlayed < 3 &&
      guard < 40_000
    ) {
      guard += 1;
      if (!advance(engine, { skilled: true })) break;
    }

    const state = engine.snapshot();
    expect(state.sprintsPlayed).toBeGreaterThan(2);
    expect(state.loseReason === 'seniorBurnout' && state.sprintsPlayed <= 2).toBe(false);
  });
});
