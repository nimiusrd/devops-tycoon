import { describe, expect, it } from 'vitest';
import { getEvent } from '../data/events';
import { RECRUIT_ARCHETYPES, STARTER_ARCHETYPES } from '../data/members';
import { createInitialRoster, createMember, recruitMember } from '../sim/member';
import { createRng } from '../sim/rng';
import { compareMemberProposal, openMemberProposal, viewMemberProposal } from './memberProposal';

const SEEDS = ['RI-211-a', 'RI-211-b', 'RI-211-c', 'RI-211-d', 'RI-211-e', 'RI-211-f'];
const DOC_ARCHETYPE = RECRUIT_ARCHETYPES.find((arch) => arch.id === 'recruit-doc')!;
const REVIEW_ARCHETYPE = STARTER_ARCHETYPES.find((arch) => arch.id === 'starter-reviewer')!;

describe('RI-211 巨大PRの提案者', () => {
  it('休職中の社員や採用前の候補を話者にせず、元の二択を出す', () => {
    const rng = createRng('RI-211');
    const roster = createInitialRoster(rng);
    const reviewer = roster.members.find((member) => member.traits.includes('reviewDemon'))!;
    reviewer.onLeave = true;
    reviewer.assignment = 'bench';

    const unstaffed = viewMemberProposal(openMemberProposal('RI-211', roster));
    expect(unstaffed.eventId).toBe('giant-pr');
    expect(unstaffed.choices.map(({ label }) => label)).toEqual(
      getEvent('giant-pr')!.choices.map(({ label }) => label),
    );
    expect(unstaffed.choices.map(({ proposer }) => proposer)).toEqual([null, null]);

    const staffed = recruitMember(roster, DOC_ARCHETYPE, rng);
    const doc = staffed.members.find((member) => member.traits.includes('docMaster'))!;
    expect(doc.assignment).toBe('bench');
    expect(openMemberProposal('RI-211', staffed).proposers).toEqual({
      review: null,
      split: { id: doc.id, name: doc.name, trait: 'docMaster' },
    });
  });

  it('同じseedとロスターでIDが決まり、閲覧とJSON往復で変化しない', () => {
    const rng = createRng('RI-211');
    const initial = createInitialRoster(rng);
    const hired = recruitMember(initial, DOC_ARCHETYPE, rng);
    const secondReviewer = createMember(REVIEW_ARCHETYPE, 'アオイ', 'm4');
    const roster = { members: [...hired.members, secondReviewer], nextId: 5 };
    const reversed = { ...roster, members: [...roster.members].reverse() };

    const selectedIds = new Set<string>();
    for (const seed of SEEDS) {
      const proposal = openMemberProposal(seed, roster);
      expect(openMemberProposal(seed, reversed)).toEqual(proposal);
      const view = viewMemberProposal(proposal);
      const restored = JSON.parse(JSON.stringify(proposal));
      expect(viewMemberProposal(restored)).toEqual(view);
      const proposer = view.choices[0].proposer!;
      expect(['m2', secondReviewer.id]).toContain(proposer.id);
      selectedIds.add(proposer.id);
      proposer.name = '表示への変更';
      expect(viewMemberProposal(proposal)).toEqual(viewMemberProposal(restored));
    }
    expect(selectedIds.size).toBe(2);
  });

  it('両方のトレイトを持つ人物がいても、可能なら別々の人が提案する', () => {
    const rng = createRng('RI-211');
    const roster = createInitialRoster(rng);
    const reviewer = roster.members.find((member) => member.traits.includes('reviewDemon'))!;
    reviewer.traits.push('docMaster');
    expect(openMemberProposal('RI-211', roster).proposers.split).toBeNull();

    const otherReviewer = createMember(REVIEW_ARCHETYPE, 'アオイ', 'm3');
    const both = { members: [...roster.members, otherReviewer], nextId: 4 };
    for (const seed of SEEDS) {
      const proposal = openMemberProposal(seed, both);
      expect(proposal.proposers.review?.id).toBe(otherReviewer.id);
      expect(proposal.proposers.split?.id).toBe(reviewer.id);
    }
  });
});

describe('RI-211 巨大PRの選択比較', () => {
  it('予算と仕事は共通で、即時HP・品質と士気・レビュー効率を交換する', () => {
    const comparison = compareMemberProposal(SEEDS[0]);
    expect(compareMemberProposal(SEEDS[0])).toEqual(comparison);
    const [review, split] = comparison.cases[0].results;
    expect(review.choice).toBe('review');
    expect(split.choice).toBe('split');
    expect([review.budget, split.budget]).toEqual([comparison.budget, comparison.budget]);
    expect(review.afterEvent).toEqual({ seniorHp: 86, morale: 70, quality: 64 });
    expect(split.afterEvent).toEqual({ seniorHp: 100, morale: 64, quality: 60 });
    expect(split.relic).toBe('small-pr');
    expect(split.reviewEfficiencyMul / review.reviewEfficiencyMul).toBeCloseTo(1.15);
  });

  it('同じ2案の出荷差が、残り時間・渋滞・負債で変わる', () => {
    const comparisons = SEEDS.map(compareMemberProposal);
    const deliveryDifferences = new Map<string, number>();
    for (const comparison of comparisons) {
      for (const {
        id,
        results: [review, split],
      } of comparison.cases) {
        deliveryDifferences.set(
          id,
          (deliveryDifferences.get(id) ?? 0) + review.delivered - split.delivered,
        );
      }
    }
    const deadline = deliveryDifferences.get('deadline')!;
    const highDebt = deliveryDifferences.get('high-debt')!;
    expect(deadline).toBeGreaterThan(0);
    expect(highDebt).toBeLessThan(deadline);
    expect(deliveryDifferences.get('light-queue')).toBeLessThan(0);
    expect(deliveryDifferences.get('more-time')).toBeLessThan(0);
  });
});
