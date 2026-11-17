import { describe, expect, it } from 'vitest';
import { runEndingView } from '../../../src/render/runEndingView';
import { RunEngine } from '../../../src/sim/run/engine';

describe('勝ち方別の結末', () => {
  it.each(['happiness', 'chaos'] as const)(
    '保存された %s と結果フレームを使い、再生でも一致する',
    (winType) => {
      const engine = new RunEngine({ seed: 'ri288-ending', difficulty: 'easy' });
      engine.startRun();
      const frame = engine.exportReplayFrame()!;
      frame.phase = 'won';
      frame.status = 'won';
      frame.winType = winType;
      // 現行閾値を満たさなくても、旧記録を再判定しない。
      frame.org.morale = 42.4;
      frame.org.seniorHp = 31.6;
      frame.totals.delivered = 123;
      frame.totals.incidents = 7;
      const before = structuredClone(frame);
      const view = runEndingView(frame)!;
      expect(view.type).toBe(winType);
      expect(view.facts).toEqual([
        { label: '累計出荷', value: '123 pt' },
        ...(winType === 'chaos' ? [{ label: '累計障害', value: '7 件' }] : []),
        { label: '士気', value: '42 / 100' },
        { label: 'シニア体力', value: '32 / 100' },
      ]);
      engine.hydrateReplayFrame(JSON.parse(JSON.stringify(frame)));
      expect(runEndingView(engine.snapshot())).toEqual(view);
      expect(runEndingView(frame)).toEqual(view);
      expect(frame).toEqual(before);
    },
  );

  it('欠落・非有限値を0や現行値で補わない', () => {
    const view = runEndingView({
      status: 'won',
      winType: 'chaos',
      org: { seniorHp: NaN },
      totals: { delivered: Infinity },
    })!;
    expect(view.facts.every((fact) => fact.value === '記録なし')).toBe(true);
  });

  it('敗北・勝利種別なし・対象外の勝利には追加しない', () => {
    expect(runEndingView({ status: 'lost', winType: 'chaos' })).toBeNull();
    expect(runEndingView({ status: 'won' })).toBeNull();
    expect(runEndingView({ status: 'won', winType: 'healthy' })).toBeNull();
  });
});
