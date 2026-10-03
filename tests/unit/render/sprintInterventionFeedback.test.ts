import { describe, expect, it } from 'vitest';
import {
  formatInterventionFeedback,
  formatSprintTickerRows,
  type SprintInterventionFeedback,
} from '../../../src/render/sprintEventView';
import type { InterventionEffect, SprintEvent } from '../../../src/sim/types';

function successFeedback(
  effect: InterventionEffect,
  previousEvents: readonly SprintEvent[] = [],
  nonce = 1,
): SprintInterventionFeedback {
  return { id: effect.actionId, outcome: { ok: true, effect }, nonce, previousEvents };
}

const reviewedEffect: InterventionEffect = {
  actionId: 'interruptReview',
  reviewedCount: 2,
  affectedTaskIds: [3, 4],
  hpCost: 0.5,
  focusCost: 3,
  gaugeGain: 0.34,
};

describe('介入結果の出来事表示（#536）', () => {
  it('実際の処理件数と資源を表示し、レビューを出荷成功として扱わない', () => {
    const row = formatInterventionFeedback({
      ...successFeedback(reviewedEffect),
      resourceChanges: { focus: -3, seniorHp: -4.5, morale: 0, aiLiteracy: 0 },
    });
    expect(row.text).toBe('割り込みレビュー: PR2件処理 / シニアHP -4.5 / 集中力 -3');
    expect(row.text).not.toMatch(/出荷|完了|炎上.*減/);
    expect(row.tone).toBe('warn');
  });

  it('同期差分がない記録は HP の追加コストを総消費として表示しない', () => {
    expect(formatInterventionFeedback(successFeedback(reviewedEffect)).text).toBe(
      '割り込みレビュー: PR2件処理 / 追加シニアHP -0.5 / 集中力 -3',
    );
  });

  it('ペアレビューの HP 消費も同期差分から表示する', () => {
    const row = formatInterventionFeedback({
      ...successFeedback({
        actionId: 'pairReview',
        reviewedCount: 2,
        literacyGain: 2,
        focusCost: 2,
        gaugeGain: 0.2,
      }),
      resourceChanges: { focus: -2, seniorHp: -1.5, morale: 0, aiLiteracy: 0.4 },
    });
    expect(row.text).toBe('ペアレビュー: PR2件処理 / シニアHP -1.5 / AI Literacy +0.4 / 集中力 -2');
    expect(row.text).not.toContain('AI Literacy +2');
  });

  it('資源の clamp 後の差分がゼロなら効果定義のコストや増分を補わない', () => {
    const row = formatInterventionFeedback({
      ...successFeedback(reviewedEffect),
      resourceChanges: { focus: 0, seniorHp: 0, morale: 0, aiLiteracy: 0 },
    });
    expect(row.text).toBe('割り込みレビュー: PR2件処理');
    expect(row.tone).toBe('info');
  });

  it.each([
    [-1, 3, '集中力 -1（消費3・還元2）'],
    [0, 2, '集中力 ±0（消費2・還元2）'],
  ] as const)('集中力差分 %s は実測 net と消費・還元の内訳を示す', (focus, focusCost, text) => {
    const row = formatInterventionFeedback({
      ...successFeedback({ ...reviewedEffect, focusCost, focusRefund: 2 }),
      resourceChanges: { focus, seniorHp: -1.5, morale: 0, aiLiteracy: 0 },
    });
    expect(row.text).toContain(text);
    expect(row.text.match(/集中力/g)).toHaveLength(1);
  });

  it('資源が増えた同期差分には正の符号を付ける', () => {
    const row = formatInterventionFeedback({
      ...successFeedback(reviewedEffect),
      resourceChanges: { focus: 1, seniorHp: 0.5, morale: 0.3, aiLiteracy: 0.4 },
    });
    expect(row.text).toBe(
      '割り込みレビュー: PR2件処理 / シニアHP +0.5 / 士気 +0.3 / AI Literacy +0.4 / 集中力 +1',
    );
  });

  it('上限付近の Literacy 増分と集中力還元は effect の値を表示する', () => {
    const row = formatInterventionFeedback(
      successFeedback({
        actionId: 'pairReview',
        reviewedCount: 0,
        affectedTaskIds: [],
        literacyGain: 0.4,
        focusCost: 2,
        gaugeGain: 0.2,
        focusRefund: 1,
      }),
    );
    expect(row.text).toBe('ペアレビュー: PR0件処理 / AI Literacy +0.4 / 集中力 -2 / 集中力 +1');
    expect(row.text).not.toContain('AI Literacy +2');
  });

  it.each([
    ['splitPr', 'PR1件分割'],
    ['assignTask', '1件差配'],
  ] as const)('%s は適用された件数だけを表示する', (actionId, result) => {
    expect(
      formatInterventionFeedback(
        successFeedback({ actionId, affectedTaskIds: [7], focusCost: 2, gaugeGain: 0.1 }),
      ).text,
    ).toContain(`${result} / 集中力 -2`);
  });

  it('先消し鎮火は鎮火件数・コンボ切断・実測コストを表示する', () => {
    const row = formatInterventionFeedback(
      successFeedback({
        actionId: 'firefight',
        containedTaskId: 7,
        brokeCombo: true,
        hpCost: 0.6,
        moraleCost: 0.3,
        focusCost: 2,
        gaugeGain: 0.2,
      }),
    );
    expect(row.text).toBe(
      '緊急対応: 1件鎮火 / コンボ切断 / 追加シニアHP -0.6 / 士気 -0.3 / 集中力 -2',
    );
    expect(row.tone).toBe('warn');
  });

  it.each([
    ['andon', 'andon', '流入停止開始'],
    ['overtime', 'overtime', '残業開始'],
    ['aiThrottle', 'throttle', '新規タスクのAI割当停止'],
  ] as const)('%s は時限効果の開始を示し、自然進行の変化量を加えない', (actionId, kind, label) => {
    const row = formatInterventionFeedback(
      successFeedback({
        actionId,
        modifier: { kind, untilTick: 24 },
        focusCost: 2,
        gaugeGain: 0.1,
        hpCost: 0,
        moraleCost: 0,
      }),
    );
    expect(row.text).toContain(`${label} / 集中力 -2`);
    expect(row.text).not.toMatch(/PR\d|シニアHP|士気|出荷|炎上/);
  });

  it.each([
    ['no-target', 'Review が空'],
    ['no-focus', '集中力不足'],
    ['cooldown', 'クールダウン中'],
    ['complete', 'スプリント終了'],
    ['paused', '一時停止中'],
  ] as const)('失敗 %s は既存理由だけを表示し、資源消費を表示しない', (reason, label) => {
    const row = formatInterventionFeedback({
      id: 'interruptReview',
      outcome: { ok: false, reason },
      nonce: 4,
      previousEvents: [],
    });
    expect(row.text).toBe(`割り込みレビュー: ${label}`);
    expect(row.tone).toBe('warn');
    expect(row.text).not.toMatch(/ -\d|件処理/);
  });
});

describe('保持中の介入結果と重要イベントの優先順位（#536）', () => {
  it('通常の履歴が増えても結果を先頭に保持し、成功ログを重複させない', () => {
    const intervention: SprintEvent = {
      tick: 8,
      kind: 'intervention',
      effect: reviewedEffect,
      combo: 1,
    };
    const events: SprintEvent[] = [intervention, { tick: 9, kind: 'contain', taskId: 7, combo: 1 }];
    const rows = formatSprintTickerRows(events, successFeedback(reviewedEffect));
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toContain('PR2件処理 / 追加シニアHP -0.5');
    expect(rows[1].text).toContain('鎮火成功');
    expect(rows.filter((row) => row.text.includes('割り込みレビュー'))).toHaveLength(1);
  });

  it.each([
    { tick: 9, kind: 'ignite', taskId: 7, source: 'review' },
    { tick: 9, kind: 'spread', taskId: 7, debtGain: 6, moraleCost: 0.4 },
    { tick: 9, kind: 'auto-contain', taskId: 7, hpCost: 3 },
    { tick: 9, kind: 'combo-break', taskId: 7, reason: 'rework' },
  ] satisfies SprintEvent[])('保持中でも新しい $kind は即座に先頭へ出す', (important) => {
    const rows = formatSprintTickerRows([important], successFeedback(reviewedEffect));
    expect(rows[0].key).not.toBe('outcome:1');
    expect(rows[1].key).toBe('outcome:1');
  });

  it('介入のレビュー処理で同じ tick に点火した場合も点火を優先する', () => {
    const events: SprintEvent[] = [
      { tick: 8, kind: 'ignite', taskId: 3, source: 'review' },
      { tick: 8, kind: 'intervention', effect: reviewedEffect, combo: 0 },
    ];
    const rows = formatSprintTickerRows(events, successFeedback(reviewedEffect));
    expect(rows[0].text).toContain('点火!');
    expect(rows[1].text).toContain('PR2件処理');
  });

  it('同じ tick・タスク・原因の再点火でも新しい点火を即優先する', () => {
    const firstIgnite: SprintEvent = { tick: 8, kind: 'ignite', taskId: 3, source: 'review' };
    const previousEvents: SprintEvent[] = [
      firstIgnite,
      { tick: 8, kind: 'contain', taskId: 3, combo: 1 },
      {
        tick: 8,
        kind: 'intervention',
        effect: { actionId: 'firefight', containedTaskId: 3, focusCost: 2, gaugeGain: 0.2 },
        combo: 1,
      },
    ];
    const events: SprintEvent[] = [
      ...structuredClone(previousEvents),
      structuredClone(firstIgnite),
      { tick: 8, kind: 'intervention', effect: reviewedEffect, combo: 0 },
    ];
    const rows = formatSprintTickerRows(events, successFeedback(reviewedEffect, previousEvents));
    expect(rows[0].text).toContain('点火!');
    expect(rows[1].key).toBe('outcome:1');
    expect(rows.filter((row) => row.text.includes('割り込みレビュー'))).toHaveLength(1);
  });

  it.each([
    [
      { tick: 9, kind: 'spread', taskId: 7, debtGain: 6, moraleCost: 0.4 },
      { tick: 9, kind: 'combo-break', taskId: 7, reason: 'spread' },
      '延焼! 負債 +6 / 士気 -0.4',
    ],
    [
      { tick: 9, kind: 'auto-contain', taskId: 7, hpCost: 3 },
      { tick: 9, kind: 'combo-break', taskId: 7, reason: 'auto-contain' },
      '自動鎮火 / シニアHP -3',
    ],
  ] satisfies [SprintEvent, SprintEvent, string][])(
    '同 tick のコンボ切断で重要イベントの実測損失を隠さない',
    (cause, comboBreak, text) => {
      const rows = formatSprintTickerRows([cause, comboBreak], successFeedback(reviewedEffect));
      expect(rows[0].text).toBe(text);
      expect(rows[1].key).toBe('outcome:1');
    },
  );

  it('介入前の炎上は結果の保持を奪わず、最新結果に更新される', () => {
    const oldFire: SprintEvent = { tick: 2, kind: 'ignite', taskId: 1, source: 'review' };
    const oldFeedback = successFeedback(reviewedEffect, [oldFire]);
    const nextEffect: InterventionEffect = {
      actionId: 'assignTask',
      affectedTaskIds: [7],
      focusCost: 2,
      gaugeGain: 0.1,
    };
    expect(formatSprintTickerRows([oldFire], oldFeedback)[0].key).toBe('outcome:1');
    const rows = formatSprintTickerRows([oldFire], successFeedback(nextEffect, [oldFire], 2));
    expect(rows[0].key).toBe('outcome:2');
    expect(rows[0].text).toContain('1件差配');
    expect(rows.some((row) => row.key === 'outcome:1')).toBe(false);
  });

  it('ring buffer が同じ件数のまま更新されても新しい延焼を優先する', () => {
    const previousEvents: SprintEvent[] = Array.from({ length: 64 }, (_, tick) => ({
      tick,
      kind: 'contain',
      taskId: tick,
      combo: 1,
    }));
    const events: SprintEvent[] = [
      ...previousEvents.slice(1),
      { tick: 65, kind: 'spread', taskId: 3, debtGain: 6, moraleCost: 5 },
    ];
    const rows = formatSprintTickerRows(events, successFeedback(reviewedEffect, previousEvents));
    expect(rows).toHaveLength(5);
    expect(rows[0].text).toContain('延焼!');
    expect(rows[1].key).toBe('outcome:1');
  });

  it('保持解除後は最新履歴へ戻り、入力履歴を変更しない', () => {
    const events: SprintEvent[] = [{ tick: 9, kind: 'contain', taskId: 7, combo: 1 }];
    const original = structuredClone(events);
    expect(formatSprintTickerRows(events, successFeedback(reviewedEffect))[0].key).toBe(
      'outcome:1',
    );
    expect(formatSprintTickerRows(events, null)[0].key).toBe('9:contain:7');
    expect(events).toEqual(original);
  });

  it('履歴が空でも失敗結果を表示できる', () => {
    const rows = formatSprintTickerRows([], {
      id: 'splitPr',
      outcome: { ok: false, reason: 'no-target' },
      nonce: 3,
      previousEvents: [],
    });
    expect(rows[0].text).toBe('PR分割: 分割対象なし');
    expect(formatSprintTickerRows([], null)).toEqual([]);
  });
});
