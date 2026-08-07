/** RI-85: review-freeze soft judgment regression coverage. */
import { describe, expect, it } from 'vitest';
import { effectiveKind, getEvent } from '../../src/data/events';
import {
  REVIEW_FREEZE_DANGER_PEAK,
  REVIEW_FREEZE_EVENT_HP,
  REVIEW_FREEZE_WATCH_PEAK,
  deriveHudMetrics,
  reviewFreezeHudCopy,
  reviewFreezeWarningPeak,
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
    // 閾値直前キューへの加算で操作前に敗北確定しないよう、次スプリント負荷は付けない。
    expect(def!.choices[0]?.outcome.nextSprint?.reviewLoadAdd).toBeUndefined();
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

  it('了解後もランは継続し、reviewFreeze / seniorBurnout 即敗北にはならない', () => {
    const engine = new RunEngine({ seed: 'ri85-soft', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as BeatInternals;
    internals.org.seniorHp = 40;
    internals.org.morale = 50;
    internals.phase = 'beat';
    internals.beat = { eventId: 'review-freeze', kind: 'judgment' };
    engine.resolveBeat();
    const after = engine.snapshot();
    expect(after.status).toBe('playing');
    expect(after.loseReason).toBeUndefined();
    // soft judgment の HP 減はスプリント間回復のあとも、無被害（100）より低い。
    expect(after.org.seniorHp).toBeLessThan(100);
    expect(after.org.seniorHp).toBeGreaterThan(1);
    expect(after.org.morale).toBeGreaterThan(1);
  });

  it('低リソースでも preserveAboveLose により即時敗北しない', () => {
    const def = getEvent('review-freeze')!;
    expect(def.choices[0]?.outcome.preserveAboveLose).toBe(true);
    const engine = new RunEngine({ seed: 'ri85-floor', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as BeatInternals;
    internals.org.seniorHp = 8;
    internals.org.morale = 3;
    internals.phase = 'beat';
    internals.beat = { eventId: 'review-freeze', kind: 'judgment' };
    engine.resolveBeat();
    const after = engine.snapshot();
    expect(after.status).toBe('playing');
    expect(after.loseReason).toBeUndefined();
    expect(after.org.seniorHp).toBeGreaterThan(1);
    expect(after.org.morale).toBeGreaterThan(1);
  });

  it('reviewFreezeHudCopy はキューピーク閾値だけでチップを出す', () => {
    expect(REVIEW_FREEZE_WATCH_PEAK).toBe(Math.round(REVIEW_FREEZE_PEAK * 0.75));
    expect(reviewFreezeHudCopy(0).warningChip).toBeUndefined();
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_WATCH_PEAK)).toMatchObject({
      tone: 'watch',
      warningChip: '凍結注意',
    });
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_DANGER_PEAK)).toMatchObject({
      tone: 'danger',
      warningChip: 'PR凍結危険',
    });
  });

  it('deriveHudMetrics のレビュー耐性に凍結予兆を載せる', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 80;
    const metrics = deriveHudMetrics(org, [], null, REVIEW_FREEZE_WATCH_PEAK);
    expect(metrics.find((m) => m.id === 'reviewCapacity')).toMatchObject({
      warningChip: '凍結注意',
      tone: 'watch',
    });
  });

  it('低HPだけでは凍結予兆を出さず、ライブピークがあるときだけ出す', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 40;
    expect(
      deriveHudMetrics(org, [], null, 0).find((m) => m.id === 'reviewCapacity')?.warningChip,
    ).toBeUndefined();
    expect(
      deriveHudMetrics(org, [], null, REVIEW_FREEZE_WATCH_PEAK).find(
        (m) => m.id === 'reviewCapacity',
      ),
    ).toMatchObject({ warningChip: '凍結注意', tone: 'watch' });
  });

  it('reviewFreezeWarningPeak は非選択チームの現在キューも畳み込む', () => {
    expect(reviewFreezeWarningPeak(0, [])).toBe(0);
    expect(reviewFreezeWarningPeak(10, [4, 36, 2])).toBe(36);
    expect(reviewFreezeWarningPeak(40, [12])).toBe(40);
  });
});
