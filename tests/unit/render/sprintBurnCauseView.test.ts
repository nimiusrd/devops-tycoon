import { describe, expect, it } from 'vitest';
import { planBurnCauseLog } from '../../../src/render/sprintBurnCauseView';
import type { FireSprintEvent, SprintResult } from '../../../src/sim/types';

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 0,
    contained: 0,
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

describe('sprintBurnCauseView（RI-34′）', () => {
  it('炎上ゼロのときはセクション非表示', () => {
    const view = planBurnCauseLog(makeResult());
    expect(view.showSection).toBe(false);
    expect(view.entries).toEqual([]);
  });

  it('incidents だけでもセクションを出す（ログ欠損時の保険）', () => {
    const view = planBurnCauseLog(makeResult({ incidents: 1 }));
    expect(view.showSection).toBe(true);
    expect(view.headline).toContain('点火 0');
    expect(view.entries).toEqual([]);
  });

  it('点火→緊急対応鎮火のチェーンを作る', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 18, kind: 'contain', taskId: 3, combo: 4 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, contained: 1, fireEvents }));
    expect(view.showSection).toBe(true);
    expect(view.headline).toBe('点火 1 / 鎮火 1 / 自動鎮火 0 / 延焼 0');
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].tone).toBe('good');
    expect(view.entries[0].text).toBe('t12: PR#3 が Review 落ちで点火 → t18 緊急対応で鎮火');
    expect(view.tip).toContain('緊急対応で鎮火');
  });

  it('余裕のある先消し鎮火は不利な即応として扱う', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 18, kind: 'contain', taskId: 3, combo: 0, brokeCombo: true },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, contained: 1, fireEvents }));
    expect(view.entries[0].tone).toBe('warn');
    expect(view.entries[0].text).toContain('余裕のある先消し（コンボ切断）');
    expect(view.tip).toContain('余裕のある先消し');
  });

  it('点火→自動鎮火のチェーンを作る', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 5, kind: 'ignite', taskId: 1, source: 'review' },
      { tick: 11, kind: 'auto-contain', taskId: 1, hpCost: 20 },
    ];
    const view = planBurnCauseLog(
      makeResult({ incidents: 1, contained: 1, autoContainCount: 1, fireEvents }),
    );
    expect(view.entries[0].tone).toBe('bad');
    expect(view.entries[0].text).toContain('自動鎮火（シニアHP -20）');
    expect(view.tip).toContain('自動鎮火に頼った');
  });

  it('点火→延焼→連鎖点火→鎮火を1本のチェーンにまとめる', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 18, kind: 'spread', taskId: 3, spreadToTaskId: 5 },
      { tick: 18, kind: 'ignite', taskId: 5, source: 'spread' },
      { tick: 22, kind: 'contain', taskId: 5, combo: 2 },
    ];
    const view = planBurnCauseLog(
      makeResult({ incidents: 2, contained: 1, spread: 1, fireEvents }),
    );
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].text).toBe(
      't12: PR#3 が Review 落ちで点火 → t18 延焼 → PR#5 → t22 緊急対応で鎮火',
    );
    expect(view.entries[0].tone).toBe('good');
    expect(view.tip).toContain('延焼が発生した');
  });

  it('スプリント終了の受動鎮火（hpCost 0）を区別する', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 40, kind: 'ignite', taskId: 2, source: 'review' },
      { tick: 60, kind: 'auto-contain', taskId: 2, hpCost: 0 },
    ];
    const view = planBurnCauseLog(
      makeResult({ incidents: 1, contained: 1, autoContainCount: 1, fireEvents }),
    );
    expect(view.entries[0].text).toContain('スプリント終了で受動鎮火');
  });
});
