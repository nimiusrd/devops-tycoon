import { describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../../src/sim/engine';
import type { SimState } from '../../src/sim/types';

const reviewCount = (s: SimState): number =>
  s.sprint.tasks.filter((t) => t.lane === 'review').length;

/** 述語が満たされるまで（または上限まで）1 tick ずつ前進させる。 */
function stepUntil(e: Engine, pred: (s: SimState) => boolean, maxTicks = 4000): SimState {
  let s = e.snapshot();
  let guard = 0;
  while (!pred(s) && !e.isComplete() && guard < maxTicks) {
    e.step(100);
    s = e.snapshot();
    guard += 1;
  }
  return s;
}

describe('集中力の消費とクールダウン（第6.1）', () => {
  it('発動すると集中力がコスト分減り、クールダウンが入る', () => {
    const e = createEngine({ seed: 'act', aiEnabled: true });
    const before = stepUntil(e, (s) => reviewCount(s) >= 4);
    expect(reviewCount(before)).toBeGreaterThanOrEqual(4);

    const outcome = e.dispatch('interruptReview');
    expect(outcome.ok).toBe(true);

    const after = e.snapshot();
    expect(after.sprint.focus).toBe(before.sprint.focus - 3);
    expect(after.sprint.cooldowns.interruptReview ?? 0).toBeGreaterThan(0);
    expect(after.sprint.metrics.interventionsUsed).toBe(1);
    expect(after.sprint.metrics.focusSpent).toBe(3);
  });

  it('クールダウン中の再発動は失敗し、集中力は減らない', () => {
    const e = createEngine({ seed: 'cd', aiEnabled: true });
    stepUntil(e, (s) => reviewCount(s) >= 4);
    expect(e.dispatch('interruptReview').ok).toBe(true);
    const mid = e.snapshot();

    const retry = e.dispatch('interruptReview');
    expect(retry.ok).toBe(false);
    expect(retry.reason).toBe('cooldown');
    expect(e.snapshot().sprint.focus).toBe(mid.sprint.focus);
  });

  it('集中力が足りないと失敗する（no-focus）', () => {
    const e = createEngine({ seed: 'nofocus', aiEnabled: true });
    // 常に成立する重い系で集中力を 12 → 1 まで枯らす。
    e.dispatch('andon'); // ⚡5
    e.dispatch('overtime'); // ⚡4
    e.dispatch('aiThrottle'); // ⚡2
    expect(e.snapshot().sprint.focus).toBe(1);

    const outcome = e.dispatch('splitPr'); // ⚡2 > 1
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('no-focus');
  });

  it('対象が無い緊急対応は失敗し、コストを消費しない（no-target）', () => {
    const e = createEngine({ seed: 'notarget', aiEnabled: true });
    const before = e.snapshot();
    const outcome = e.dispatch('firefight');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('no-target');
    expect(e.snapshot().sprint.focus).toBe(before.sprint.focus);
  });
});

describe('介入の副作用（第6.1）', () => {
  it('残業号令は Morale とシニアHP を削る', () => {
    const e = createEngine({ seed: 'overtime', aiEnabled: true });
    const before = e.snapshot();
    expect(e.dispatch('overtime').ok).toBe(true);
    const after = e.snapshot();
    expect(after.org.morale).toBeLessThan(before.org.morale);
    expect(after.org.seniorHp).toBeLessThan(before.org.seniorHp);
  });

  it('割り込みレビューは Review 渋滞を即座に減らす（第6.1 / DoD）', () => {
    const e = createEngine({ seed: 'sweep', aiEnabled: true });
    const before = stepUntil(e, (s) => reviewCount(s) >= 4);
    const q0 = reviewCount(before);
    expect(e.dispatch('interruptReview').ok).toBe(true);
    expect(reviewCount(e.snapshot())).toBeLessThan(q0);
  });
});

describe('介入で結果が変わる（DoD: 操作で結果が変わる）', () => {
  /** 指定 tick で 1 度だけ overtime を撃ち、最後までまわした結果を返す。 */
  function runWithIntervention(dispatchAt: number | null) {
    const e = createEngine({ seed: 'intervene', aiEnabled: true });
    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      if (dispatchAt !== null && e.snapshot().tick === dispatchAt) {
        e.dispatch('overtime');
      }
      e.step(100);
      guard += 1;
    }
    return e.result();
  }

  it('介入の有無でリザルトが変わる', () => {
    const base = runWithIntervention(null);
    const intervened = runWithIntervention(20);
    const differs =
      base.delivered !== intervened.delivered ||
      base.reviewQueueMax !== intervened.reviewQueueMax ||
      base.rework !== intervened.rework ||
      base.seniorHpDelta !== intervened.seniorHpDelta;
    expect(differs).toBe(true);
  });
});
