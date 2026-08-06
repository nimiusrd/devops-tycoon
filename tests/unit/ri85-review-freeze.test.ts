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
import { autoplayBeatChoiceIndex } from '../playtest/harness';

type BeatInternals = {
  phase: string;
  beat: { eventId: string; kind: 'judgment' | 'decision' } | null;
  org: ReturnType<RunEngine['snapshot']>['org'];
};

describe('RI-85 review-freeze decision と予兆', () => {
  it('review-freeze は回避可能な 3 択 decision である', () => {
    const def = getEvent('review-freeze');
    expect(def).toBeDefined();
    expect(effectiveKind(def!)).toBe('decision');
    expect(def!.kind).toBe('decision');
    expect(def!.choices).toHaveLength(3);
    expect(def!.choices[0]?.outcome.forceLose).toBeUndefined();
    expect(def!.choices[1]?.outcome.forceLose).toBeUndefined();
    expect(def!.choices[2]?.outcome.forceLose).toBe('reviewFreeze');
    // HP40 からでも資格帯（<=45）を抜け出せる回復量。
    expect(def!.choices[0]?.outcome.seniorHp).toBeGreaterThanOrEqual(6);
  });

  it('seniorHp 境界で抽選適格が切り替わる', () => {
    const def = getEvent('review-freeze')!;
    const eligible = createOrgState('easy', true);
    eligible.seniorHp = REVIEW_FREEZE_EVENT_HP;
    const blocked = createOrgState('easy', true);
    blocked.seniorHp = REVIEW_FREEZE_EVENT_HP + 1;
    expect(eventEligible(def, eventSignals(eligible))).toBe(true);
    expect(eventEligible(def, eventSignals(blocked))).toBe(false);
  });

  it('回復肢は生存し、押し通し肢は reviewFreeze で敗北する', () => {
    const recover = new RunEngine({ seed: 'ri85-recover', difficulty: 'easy' });
    recover.startRun();
    const recoverInternals = recover as unknown as BeatInternals;
    recoverInternals.phase = 'beat';
    recoverInternals.org = { ...recover.snapshot().org, seniorHp: 40 };
    recoverInternals.beat = { eventId: 'review-freeze', kind: 'decision' };
    recover.resolveBeat(0);
    const afterRecover = recover.snapshot();
    expect(afterRecover.status).toBe('playing');
    expect(afterRecover.loseReason).toBeUndefined();
    expect(afterRecover.org.seniorHp).toBeGreaterThan(REVIEW_FREEZE_EVENT_HP);

    const push = new RunEngine({ seed: 'ri85-push', difficulty: 'easy' });
    push.startRun();
    const pushInternals = push as unknown as BeatInternals;
    pushInternals.phase = 'beat';
    pushInternals.org = { ...push.snapshot().org, seniorHp: 40 };
    pushInternals.beat = { eventId: 'review-freeze', kind: 'decision' };
    push.resolveBeat(2);
    const afterPush = push.snapshot();
    expect(afterPush.status).toBe('lost');
    expect(afterPush.phase).toBe('lost');
    expect(afterPush.loseReason).toBe('reviewFreeze');
  });

  it('stateAware は forceLose 肢を選ばない', () => {
    const org = createOrgState('easy', true);
    org.seniorHp = 40;
    const idx = autoplayBeatChoiceIndex('review-freeze', 'decision', false, 'stateAware', {
      org,
      budget: 40,
      trust: { management: 50, customers: 50, team: 50 },
      moraleDamageMul: 1,
      rest: 'heal',
      roster: { members: [], nextId: 1 },
      relics: [],
      relicSlots: 3,
      restHealBonus: 0,
      difficulty: 'easy',
    });
    expect(idx).toBeDefined();
    expect(idx).not.toBe(2);
    expect(getEvent('review-freeze')!.choices[idx!]!.outcome.forceLose).toBeUndefined();
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
    const org = createOrgState('easy', true);
    org.seniorHp = 40;
    const metrics = deriveHudMetrics(org, [], null, 0);
    expect(metrics.find((m) => m.id === 'reviewCapacity')).toMatchObject({
      warningChip: '凍結注意',
      tone: 'watch',
    });
  });
});
