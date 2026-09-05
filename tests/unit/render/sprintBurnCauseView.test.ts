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

  it('fireEvents 自体が欠損していても incidents から空のログを返す', () => {
    const result = {
      ...makeResult({ incidents: 1 }),
      fireEvents: undefined,
    } as unknown as SprintResult;
    const view = planBurnCauseLog(result);

    expect(view.showSection).toBe(true);
    expect(view.headline).toBe('点火 0 / 鎮火 0 / 自動鎮火 0 / 延焼 0');
    expect(view.entries).toEqual([]);
    expect(view.tip).toBeUndefined();
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

  it('先消しと緊急鎮火の混在は燃え残り Tip に落とさない', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 14, kind: 'contain', taskId: 3, combo: 0, brokeCombo: true },
      { tick: 20, kind: 'ignite', taskId: 5, source: 'review' },
      { tick: 22, kind: 'contain', taskId: 5, combo: 2 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 2, contained: 2, fireEvents }));
    expect(view.tip).toContain('混在');
    expect(view.tip).not.toContain('燃え残った火');
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

  it('鎮火されなかった延焼由来の点火は未解決チェーンとして残す', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 9, kind: 'ignite', taskId: 4, source: 'spread' },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, fireEvents }));

    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ icon: '🔥', tone: 'warn', tick: 9 });
    expect(view.entries[0].text).toBe('t9: PR#4 が 延焼で点火 → 未解決のまま終了');
    expect(view.tip).toContain('燃え残った火');
  });

  it('対応先の点火が欠けた handoff は延焼として確定する', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 18, kind: 'spread', taskId: 3, spreadToTaskId: 5 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, spread: 1, fireEvents }));

    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].tone).toBe('bad');
    expect(view.entries[0].text).toBe('t12: PR#3 が Review 落ちで点火 → t18 延焼 → PR#5');
  });

  it('対応する点火がない孤立鎮火・延焼イベントはエントリにしない', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 2, kind: 'contain', taskId: 1, combo: 1 },
      { tick: 3, kind: 'auto-contain', taskId: 2, hpCost: 5 },
      { tick: 4, kind: 'spread', taskId: 3, debtGain: 2, moraleCost: 1 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, fireEvents }));

    expect(view.entries).toEqual([]);
    expect(view.headline).toBe('点火 0 / 鎮火 1 / 自動鎮火 1 / 延焼 1');
    expect(view.tip).toBeUndefined();
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

  it('連鎖のない延焼は実測の負債・士気増減を出す', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 18, kind: 'spread', taskId: 3, debtGain: 6, moraleCost: 5 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 1, spread: 1, fireEvents }));
    expect(view.entries[0].text).toBe(
      't12: PR#3 が Review 落ちで点火 → t18 延焼（負債 +6 / 士気 -5）',
    );
    expect(view.entries[0].tone).toBe('bad');
  });

  it('実測値が欠損した延焼は既定の影響を示し、ゼロ実測値は影響を足さない', () => {
    const missingImpact: FireSprintEvent[] = [
      { tick: 1, kind: 'ignite', taskId: 1, source: 'review' },
      { tick: 2, kind: 'spread', taskId: 1 },
    ];
    const missingView = planBurnCauseLog(
      makeResult({ incidents: 1, spread: 1, fireEvents: missingImpact }),
    );
    expect(missingView.entries[0].text).toBe(
      't1: PR#1 が Review 落ちで点火 → t2 延焼（負債・士気に波及）',
    );

    const zeroImpact: FireSprintEvent[] = [
      { tick: 3, kind: 'ignite', taskId: 2, source: 'review' },
      { tick: 4, kind: 'spread', taskId: 2, debtGain: 0, moraleCost: 0 },
    ];
    const zeroView = planBurnCauseLog(
      makeResult({ incidents: 1, spread: 1, fireEvents: zeroImpact }),
    );
    expect(zeroView.entries[0].text).toBe('t3: PR#2 が Review 落ちで点火 → t4 延焼');
  });

  it('連鎖延焼も実測の負債・士気増減を括弧で添える', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      {
        tick: 18,
        kind: 'spread',
        taskId: 3,
        spreadToTaskId: 5,
        debtGain: 6,
        moraleCost: 5,
      },
      { tick: 18, kind: 'ignite', taskId: 5, source: 'spread' },
      { tick: 22, kind: 'contain', taskId: 5, combo: 2 },
    ];
    const view = planBurnCauseLog(
      makeResult({ incidents: 2, contained: 1, spread: 1, fireEvents }),
    );
    expect(view.entries[0].text).toBe(
      't12: PR#3 が Review 落ちで点火 → t18 延焼 → PR#5（負債 +6 / 士気 -5） → t22 緊急対応で鎮火',
    );
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

  it('鎮火と自動鎮火が混在したときは汎用の振り返り Tip を返す', () => {
    const fireEvents: FireSprintEvent[] = [
      { tick: 1, kind: 'ignite', taskId: 1, source: 'review' },
      { tick: 2, kind: 'contain', taskId: 1, combo: 2 },
      { tick: 3, kind: 'ignite', taskId: 2, source: 'review' },
      { tick: 4, kind: 'auto-contain', taskId: 2, hpCost: 5 },
    ];
    const view = planBurnCauseLog(makeResult({ incidents: 2, fireEvents }));

    expect(view.tip).toContain('タイミングを振り返り');
  });

  it('因果エントリは先頭10件までに制限する', () => {
    const fireEvents: FireSprintEvent[] = [];
    for (let taskId = 1; taskId <= 11; taskId += 1) {
      fireEvents.push({ tick: taskId * 2, kind: 'ignite', taskId, source: 'review' });
      fireEvents.push({ tick: taskId * 2 + 1, kind: 'contain', taskId, combo: 1 });
    }

    const view = planBurnCauseLog(makeResult({ incidents: 11, contained: 11, fireEvents }));
    expect(view.entries).toHaveLength(10);
    expect(view.entries.at(-1)?.text).toContain('PR#10');
    expect(view.entries.some((entry) => entry.text.includes('PR#11'))).toBe(false);
  });
});
