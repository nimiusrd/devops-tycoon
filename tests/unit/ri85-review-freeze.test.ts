import { describe, expect, it } from 'vitest';
import { effectiveKind, getEvent } from '../../src/data/events';
import {
  REVIEW_FREEZE_DANGER_HP,
  REVIEW_FREEZE_DANGER_PEAK,
  REVIEW_FREEZE_EVENT_HP,
  REVIEW_FREEZE_WATCH_PEAK,
  deriveHudMetrics,
  reviewFreezeHudCopy,
} from '../../src/render/status';
import { REVIEW_FREEZE_PEAK } from '../../src/sim/outcome';
import { eventEligible, eventSignals } from '../../src/sim/run/events';
import { RunEngine } from '../../src/sim/run/engine';
import { createOrgState } from '../../src/sim/org';

type BeatInternals = {
  phase: string;
  beat: { eventId: string; kind: 'judgment' | 'decision' } | null;
  org: ReturnType<RunEngine['snapshot']>['org'];
};

describe('RI-85 review-freeze soft judgment と予兆', () => {
  it('review-freeze は即死しない soft judgment である', () => {
    const def = getEvent('review-freeze');
    expect(def).toBeDefined();
    expect(effectiveKind(def!)).toBe('judgment');
    expect(def!.kind).toBe('judgment');
    expect(def!.choices).toHaveLength(1);
    expect(def!.choices[0]?.outcome.forceLose).toBeUndefined();
    expect(def!.choices[0]?.outcome.seniorHp).toBeLessThan(0);
  });

  it('seniorHp 境界で抽選適格が切り替わる', () => {
    const def = getEvent('review-freeze')!;
    const eligible = createOrgState('default', true);
    eligible.seniorHp = REVIEW_FREEZE_EVENT_HP;
    const blocked = createOrgState('default', true);
    blocked.seniorHp = REVIEW_FREEZE_EVENT_HP + 1;
    expect(eventEligible(def, eventSignals(eligible))).toBe(true);
    expect(eventEligible(def, eventSignals(blocked))).toBe(false);
  });

  it('了解後もランは継続し、reviewFreeze 即敗北にはならない', () => {
    const engine = new RunEngine({ seed: 'ri85-soft', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as BeatInternals;
    internals.org.seniorHp = 40;
    internals.phase = 'beat';
    internals.beat = { eventId: 'review-freeze', kind: 'judgment' };
    engine.resolveBeat();
    const after = engine.snapshot();
    expect(after.status).toBe('playing');
    expect(after.loseReason).toBeUndefined();
    // soft judgment の HP 減はスプリント間回復のあとも、無被害（100）より低い。
    expect(after.org.seniorHp).toBeLessThan(100);
    expect(after.org.seniorHp).toBeGreaterThan(1);
  });

  it('reviewFreezeHudCopy は HP / ピーク閾値でチップを出す', () => {
    expect(REVIEW_FREEZE_WATCH_PEAK).toBe(Math.round(REVIEW_FREEZE_PEAK * 0.75));
    expect(reviewFreezeHudCopy(80, 0).warningChip).toBeUndefined();
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_EVENT_HP, 0)).toMatchObject({
      tone: 'watch',
      warningChip: '凍結注意',
    });
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_DANGER_HP, 0)).toMatchObject({
      tone: 'danger',
      warningChip: 'PR凍結危険',
    });
    expect(reviewFreezeHudCopy(80, REVIEW_FREEZE_WATCH_PEAK)).toMatchObject({
      tone: 'watch',
      warningChip: '凍結注意',
    });
    expect(reviewFreezeHudCopy(80, REVIEW_FREEZE_DANGER_PEAK)).toMatchObject({
      tone: 'danger',
      warningChip: 'PR凍結危険',
    });
  });

  it('deriveHudMetrics のレビュー耐性に凍結予兆を載せる', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 40;
    const metrics = deriveHudMetrics(org, [], null, 0);
    expect(metrics.find((m) => m.id === 'reviewCapacity')).toMatchObject({
      warningChip: '凍結注意',
      tone: 'watch',
    });
  });
});
