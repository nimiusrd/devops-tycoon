import { describe, expect, it } from 'vitest';
import {
  formatRecentSprintEvents,
  formatSpreadMagnitude,
  formatSprintEvent,
} from '../../../src/render/sprintEventView';
import type { SprintEvent } from '../../../src/sim/types';

describe('スプリントティッカーの効果と履歴', () => {
  it('ペアレビューは処理件数、実測 Literacy、集中力還元を順に表示する', () => {
    expect(
      formatSprintEvent({
        tick: 12,
        kind: 'intervention',
        combo: 2,
        effect: {
          actionId: 'pairReview',
          focusCost: 2,
          gaugeGain: 0.2,
          reviewedCount: 2,
          affectedTaskIds: [0, 3],
          literacyGain: 1.6,
          focusRefund: 2,
        },
      }),
    ).toEqual({
      key: '12:intervention:pairReview:0,3',
      icon: '👥',
      text: 'ペアレビュー: PR2件処理 / AI Literacy +2 / ⚡+2',
      tone: 'info',
    });
  });

  it('PR 分割は対象件数と実測コストを表示し、警告にする', () => {
    expect(
      formatSprintEvent({
        tick: 13,
        kind: 'intervention',
        combo: 0,
        effect: {
          actionId: 'splitPr',
          focusCost: 2,
          gaugeGain: 0.1,
          affectedTaskIds: [0],
          hpCost: 0.6,
          moraleCost: 1.6,
        },
      }),
    ).toEqual({
      key: '13:intervention:splitPr:0',
      icon: '✂️',
      text: 'PR分割: 1件に適用 / シニアHP -1 / 士気 -2',
      tone: 'warn',
    });
  });

  it('対象も追加効果もない時限介入には空の詳細区切りを付けない', () => {
    expect(
      formatSprintEvent({
        tick: 14,
        kind: 'intervention',
        combo: 0,
        effect: {
          actionId: 'aiThrottle',
          focusCost: 2,
          gaugeGain: 0.1,
          modifier: { kind: 'throttle', untilTick: 24 },
          focusRefund: 0,
        },
      }),
    ).toEqual({
      key: '14:intervention:aiThrottle:',
      icon: '🎚️',
      text: 'AIスロットル',
      tone: 'info',
    });
  });

  it('自動鎮火は HP コストを丸め、コンボ途切れとは別の警告を表示する', () => {
    expect(formatSprintEvent({ tick: 15, kind: 'auto-contain', taskId: 0, hpCost: 2.6 })).toEqual({
      key: '15:auto-contain:0',
      icon: '🧯',
      text: '自動鎮火 / シニアHP -3',
      tone: 'bad',
    });
    expect(
      formatSprintEvent({ tick: 15, kind: 'combo-break', reason: 'auto-contain', taskId: 0 }),
    ).toEqual({
      key: '15:combo-break:auto-contain:0',
      icon: '💔',
      text: 'コンボ途切れ: 自動鎮火',
      tone: 'bad',
    });
    expect(formatSprintEvent({ tick: 16, kind: 'combo-break', reason: 'spread' })).toEqual({
      key: '16:combo-break:spread:',
      icon: '💔',
      text: 'コンボ途切れ: 延焼',
      tone: 'bad',
    });
  });

  it('実測損失がゼロの延焼には、旧記録向けの負債・士気説明を補わない', () => {
    expect(
      formatSprintEvent({ tick: 16, kind: 'spread', taskId: 0, debtGain: 0, moraleCost: 0 }),
    ).toEqual({ key: '16:spread:0:', icon: '🔥', text: '延焼!', tone: 'bad' });
  });

  it.each([
    [0.004, null],
    [0.005, '0.01'],
    [0.014, '0.01'],
    [0.015, '0.02'],
  ])('延焼量 %s は小数第 2 位に丸めて %s と表示する', (value, expected) => {
    expect(formatSpreadMagnitude(value)).toBe(expected);
  });

  it('空履歴を扱い、既定では末尾 5 件を元の配列を変えず新しい順で返す', () => {
    expect(formatRecentSprintEvents([])).toEqual([]);
    const events: SprintEvent[] = Array.from({ length: 6 }, (_, tick) => ({
      tick,
      kind: 'ignite',
      taskId: tick,
      source: 'review',
    }));
    const original = structuredClone(events);

    expect(formatRecentSprintEvents(events).map((event) => event.key)).toEqual([
      '5:ignite:5:review',
      '4:ignite:4:review',
      '3:ignite:3:review',
      '2:ignite:2:review',
      '1:ignite:1:review',
    ]);
    expect(events).toEqual(original);
  });
});
