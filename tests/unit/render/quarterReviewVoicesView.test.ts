import { describe, expect, it } from 'vitest';
import { quarterReviewVoicesView } from '../../../src/render/quarterReviewVoicesView';
import { RunEngine } from '../../../src/sim/run/engine';
import type { GrowthOutcome, Member } from '../../../src/sim/member/types';
import type { QuarterOutcome, QuarterReview } from '../../../src/sim/run/types';
import { adjustableReview } from '../helpers/runEngineFixtures';

const members = (): Member[] => {
  const engine = new RunEngine({ seed: 'ri244-voices', difficulty: 'easy' });
  engine.startRun();
  return engine.snapshot().roster.members;
};
const growth = (overrides: Partial<GrowthOutcome> = {}): GrowthOutcome => ({
  promotions: [],
  leveledUp: [],
  wentOnLeave: [],
  docGain: 0,
  ...overrides,
});
const review = (overrides: Partial<QuarterReview> = {}): QuarterReview => ({
  ...adjustableReview(['cut_scope']),
  outcome: 'met',
  progress: [
    { id: 'delivery', label: 'Delivery', actual: 100, target: 100, status: 'met' },
    { id: 'quality', label: 'Quality', actual: 50, target: 50, status: 'met' },
  ],
  ...overrides,
});

describe('quarterReviewVoicesView', () => {
  it('レビューなしでは声を作らず、ロスターなしでは顧客要約だけを作る', () => {
    expect(quarterReviewVoicesView({ quarterReview: null })).toBeNull();
    for (const roster of [undefined, null, { members: [] }]) {
      const view = quarterReviewVoicesView({ quarterReview: review(), roster });
      expect(view?.member).toBeNull();
      expect(view?.customer.speaker).toBe('顧客の声（抽象的な要約）');
    }
  });

  it.each([
    null,
    growth(),
    growth({ promotions: [{ id: 'absent', name: '退職者', to: 'senior' }], docGain: 10 }),
  ])('個人の成長記録がなければ昇格・育成・四半期全体の成長を捏造しない (%j)', (lastGrowth) => {
    const roster = { members: members() };
    const voice = quarterReviewVoicesView({ quarterReview: review(), roster, lastGrowth })!.member!;
    expect(voice.speaker).toBe(roster.members[0].name);
    expect(voice.quote).not.toMatch(/昇格|レベル|育成|研修|四半期で成長/);
    expect(voice.basis).toContain('成長・休職記録なし');
  });

  it('成長した本人を選び、記録名よりロスターの現在名を使い、直近スプリントに限定する', () => {
    const roster = { members: members() };
    const member = roster.members[1];
    const lastGrowth = growth({
      promotions: [{ id: member.id, name: '古い名前', to: 'senior' }],
      leveledUp: [member.id],
    });
    const voice = quarterReviewVoicesView({ quarterReview: review(), roster, lastGrowth })!.member!;
    expect(voice.speaker).toBe(member.name);
    expect(voice.quote).toContain('直近スプリントでシニアに昇格しました');
    expect(voice.quote).not.toContain('レベル');
  });

  it('昇格より休職を優先し、レベルアップも本人の記録に限る', () => {
    const roster = { members: members() };
    const first = roster.members[0];
    const second = roster.members[1];
    const lastGrowth = growth({
      promotions: [{ id: first.id, name: first.name, to: 'senior' }],
      wentOnLeave: [{ id: second.id, name: second.name }],
    });
    const voice = quarterReviewVoicesView({ quarterReview: review(), roster, lastGrowth })!.member!;
    expect(voice.speaker).toBe(second.name);
    expect(voice.quote).toContain('直近スプリントで休職');
    expect(voice.quote).not.toContain('昇格');
    const levelVoice = quarterReviewVoicesView({
      quarterReview: review(),
      roster,
      lastGrowth: growth({ leveledUp: [second.id] }),
    })!.member!;
    expect(levelVoice.speaker).toBe(second.name);
    expect(levelVoice.quote).toContain('直近スプリントでレベルが上がりました');
  });

  it.each(['delivery', 'quality', 'both'])(
    '未達 %s を両者が指摘し、達成の賛辞を流用しない',
    (missed) => {
      const current = review();
      current.outcome = 'missed_adjustable';
      current.progress = current.progress.map((kpi) => ({
        ...kpi,
        actual: 0,
        status: kpi.id === missed || missed === 'both' ? 'missed' : 'met',
      }));
      const view = quarterReviewVoicesView({
        quarterReview: current,
        roster: { members: members() },
      })!;
      for (const voice of [view.member!, view.customer]) {
        expect(voice.quote).toMatch(missed === 'quality' ? /品質が目標を下回り/ : /出荷/);
        expect(voice.quote).not.toContain('目標達成を評価');
      }
      expect(view.customer.basis).toContain('出荷 0 / 目標 100');
    },
  );

  it.each<QuarterOutcome>([
    'exceeded',
    'met',
    'missed_adjustable',
    'missed_crisis',
    'reorg_required',
    'shutdown',
  ])('%s の判定・信頼・報酬を変えず、JSON再生でも同じ声になる', (outcome) => {
    const engine = new RunEngine({ seed: 'ri244-voices', difficulty: 'easy' });
    engine.startRun();
    const state = {
      ...engine.snapshot(),
      quarterReview: review({ outcome, trust: { management: 50, customers: 0, team: 40 } }),
    };
    const before = structuredClone(state);
    const view = quarterReviewVoicesView(state);
    expect(view).toEqual(quarterReviewVoicesView(JSON.parse(JSON.stringify(state))));
    expect(state).toEqual(before);
    expect(view?.customer.basis).toContain('顧客信頼 0 / 100');
    if (outcome !== 'met' && outcome !== 'exceeded') {
      expect(view?.customer.quote).not.toContain('目標達成を評価');
    }
  });

  it('KPI履歴が欠ける旧記録では出荷や品質を達成したと推測しない', () => {
    const view = quarterReviewVoicesView({ quarterReview: review({ progress: [] }) })!;
    expect(view.customer.quote).not.toContain('出荷と品質の目標達成');
    expect(view.customer.basis).not.toContain('目標 100');
  });
});
