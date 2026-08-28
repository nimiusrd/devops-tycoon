import { describe, expect, it } from 'vitest';
import {
  SENIOR_HP_DISPLAY_UNKNOWN,
  clampSeniorHpDisplay,
  formatSprintResultSeniorHp,
  sprintResultSeniorHpRemaining,
} from '../../../src/render/seniorHpDisplay';
import type { SprintResult } from '../../../src/sim/types';

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 2,
    contained: 2,
    spread: 0,
    seniorHpDelta: -10,
    actionCounts: {},
    grade: 'B',
    title: '見かけ上の生産性王',
    diagnosis: 'テスト用',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 5,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

describe('seniorHpDisplay', () => {
  it('残量は 0 未満・100 超を表示しない', () => {
    expect(clampSeniorHpDisplay(-12.4)).toBe(0);
    expect(clampSeniorHpDisplay(-0.6)).toBe(0);
    expect(clampSeniorHpDisplay(68.4)).toBe(68);
    expect(clampSeniorHpDisplay(100.8)).toBe(100);
  });

  it('結果画面は差分ではなく残量を出し、負数にしない', () => {
    const depleted = makeResult({
      seniorHpDelta: -45,
      timeline: [{ tick: 8, reviewQueue: 4, burningCount: 1, combo: 0, seniorHp: -12 }],
    });
    expect(sprintResultSeniorHpRemaining(depleted)).toBe(0);
    expect(formatSprintResultSeniorHp(depleted)).toBe('0');

    const remaining = makeResult({
      seniorHpDelta: -12,
      timeline: [{ tick: 8, reviewQueue: 2, burningCount: 0, combo: 3, seniorHp: 68.2 }],
    });
    expect(formatSprintResultSeniorHp(remaining)).toBe('68');
  });

  it('タイムラインが無いときは残量 0 を捏造せず不明表示にする', () => {
    expect(sprintResultSeniorHpRemaining(makeResult({ seniorHpDelta: -20, timeline: [] }))).toBe(
      null,
    );
    expect(formatSprintResultSeniorHp(makeResult({ seniorHpDelta: -20, timeline: [] }))).toBe(
      SENIOR_HP_DISPLAY_UNKNOWN,
    );
  });
});
