import { describe, expect, it } from 'vitest';
import { promotionVoicesView } from '../../../src/render/promotionVoicesView';
import type { GrowthOutcome } from '../../../src/sim/member/types';
import { RunEngine } from '../../../src/sim/run/engine';

const empty: GrowthOutcome = { promotions: [], leveledUp: [], wentOnLeave: [], docGain: 0 };

describe('昇格記録の一言', () => {
  it('記録がない旧データや別の節目から台詞を作らない', () => {
    for (const growth of [
      undefined,
      null,
      empty,
      {
        ...empty,
        leveledUp: ['current-member'],
        wentOnLeave: [{ id: 'current-member', name: '現在の名前' }],
        docGain: 10,
      },
    ])
      expect(promotionVoicesView(growth)).toEqual([]);
  });

  it('記録順・ID・当時の名前・昇格先を保ち、JSON往復後も一致する', () => {
    const growth: GrowthOutcome = {
      ...empty,
      promotions: [
        { id: 'absent', name: '退職前の名前', to: 'senior' },
        { id: 'renamed', name: '改名前の名前', to: 'middle' },
        { id: 'third', name: '同姓同名', to: 'middle' },
        { id: 'fourth', name: '同姓同名', to: 'senior' },
      ],
    };
    const before = structuredClone(growth);
    const voices = promotionVoicesView(growth);
    expect(voices).toEqual([
      { id: 'absent', name: '退職前の名前', rank: 'シニア', quote: 'シニアに昇格しました。' },
      { id: 'renamed', name: '改名前の名前', rank: 'ミドル', quote: 'ミドルに昇格しました。' },
      { id: 'third', name: '同姓同名', rank: 'ミドル', quote: 'ミドルに昇格しました。' },
      { id: 'fourth', name: '同姓同名', rank: 'シニア', quote: 'シニアに昇格しました。' },
    ]);
    expect(promotionVoicesView(JSON.parse(JSON.stringify(growth)))).toEqual(voices);
    expect(growth).toEqual(before);
  });

  it('保存・再開とリプレイの復元でも記録が同じで、欠落時には生成しない', () => {
    const engine = new RunEngine({ seed: 'ri285-promotion-save', difficulty: 'easy' });
    engine.startRun();
    const saved = engine.exportPersistState()!;
    saved.lastGrowth = {
      ...empty,
      promotions: [{ id: 'absent', name: '記録の名前', to: 'senior' }],
    };
    const expected = promotionVoicesView(saved.lastGrowth);
    const restored = new RunEngine({ seed: 'other', difficulty: 'easy' });
    restored.hydratePersistState(JSON.parse(JSON.stringify(saved)));
    expect(promotionVoicesView(restored.snapshot().lastGrowth)).toEqual(expected);
    const replay = restored.exportReplayFrame()!;
    restored.hydrateReplayFrame(JSON.parse(JSON.stringify(replay)));
    expect(promotionVoicesView(restored.snapshot().lastGrowth)).toEqual(expected);
    delete (saved as Partial<typeof saved>).lastGrowth;
    restored.hydratePersistState(saved);
    expect(promotionVoicesView(restored.snapshot().lastGrowth)).toEqual([]);
    delete (replay as Partial<typeof replay>).lastGrowth;
    restored.hydrateReplayFrame(replay);
    expect(promotionVoicesView(restored.snapshot().lastGrowth)).toEqual([]);
  });
});
