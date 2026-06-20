import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/sim/engine';

describe('Engine', () => {
  it('同一 seed・同一 step 列なら同一状態になる（決定論）', () => {
    const a = createEngine({ seed: 'spec-22.3' });
    const b = createEngine({ seed: 'spec-22.3' });
    a.step(1000);
    b.step(1000);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('固定タイムステップに分解して tick を進め、端数を持ち越す', () => {
    const e = createEngine({ seed: 's', fixedStepMs: 100 });
    e.step(250);
    expect(e.snapshot().tick).toBe(2);
    expect(e.snapshot().elapsedMs).toBe(200);
    e.step(50); // 端数 50ms + 50ms = 100ms で 1 step
    expect(e.snapshot().tick).toBe(3);
  });

  it('load で seed をリセットすると初期状態に戻る', () => {
    const e = createEngine({ seed: 'a' });
    e.step(1000);
    e.load('b');
    const s = e.snapshot();
    expect(s.tick).toBe(0);
    expect(s.elapsedMs).toBe(0);
    expect(s.seed).toBe('b');
  });

  it('異なる seed では進行後の乱数が異なる', () => {
    const a = createEngine({ seed: 'x' });
    const b = createEngine({ seed: 'y' });
    a.step(1000);
    b.step(1000);
    expect(a.snapshot().lastRandom).not.toBe(b.snapshot().lastRandom);
  });

  it('snapshot は内部状態のコピーを返す（変更が漏れない）', () => {
    const e = createEngine({ seed: 'z' });
    const snap = e.snapshot();
    snap.tick = 999;
    expect(e.snapshot().tick).toBe(0);
  });
});
