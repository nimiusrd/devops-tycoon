import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/sim/rng';
import {
  activeEngineerCount,
  aiAssignedCount,
  applySprintGrowth,
  assignMember,
  canRecruit,
  computeStaminaMax,
  createInitialRoster,
  createMember,
  effectiveAiMastery,
  effectiveImpl,
  effectiveReview,
  foldFormationEffects,
  memberExpression,
  pickRecruitArchetype,
  rankLabel,
  recoverStamina,
  recruitMember,
  reviewHpCostMulForReviewers,
  rosterSummary,
  setAiAssigned,
  staminaDrainShareMul,
  ROSTER_CAP,
  xpForLevel,
} from '../../../src/sim/member';
import type { Member, RosterState } from '../../../src/sim/member';
import { MEMBER_NAMES, RECRUIT_ARCHETYPES } from '../../../src/data/members';

/** テスト用の個体ビルダ。 */
function member(over: Partial<Member> = {}): Member {
  const base: Member = {
    id: 'x',
    name: 'テスト',
    rank: 'middle',
    level: 1,
    xp: 0,
    stats: { implementation: 50, review: 50, aiMastery: 50 },
    stamina: 80,
    staminaMax: 80,
    traits: [],
    assignment: 'coding',
    aiAssigned: false,
    onLeave: false,
  };
  return { ...base, ...over, stats: { ...base.stats, ...over.stats } };
}

function roster(members: Member[]): RosterState {
  return { members, nextId: members.length };
}

function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('ランク・基本式', () => {
  it('ランクラベルと必要XPを固定する', () => {
    expect(rankLabel('junior')).toBe('ジュニア');
    expect(rankLabel('middle')).toBe('ミドル');
    expect(rankLabel('senior')).toBe('シニア');
    expect(xpForLevel(1)).toBe(80);
    expect(xpForLevel(4)).toBe(170);
    expect(xpForLevel(8)).toBe(290);
  });

  it('スタミナ上限と有効ステータスはランク・レベル・トレイト倍率を反映する', () => {
    expect(computeStaminaMax('middle', 3, [])).toBe(89);
    expect(computeStaminaMax('middle', 3, ['burnoutProne'])).toBe(64);
    expect(
      effectiveImpl(
        member({ rank: 'senior', stats: { implementation: 80 }, traits: ['megaPrMaker'] }),
      ),
    ).toBe(125);
    expect(
      effectiveReview(member({ rank: 'senior', stats: { review: 80 }, traits: ['reviewDemon'] })),
    ).toBe(130);
    expect(effectiveAiMastery(member({ rank: 'junior', stats: { aiMastery: 100 } }))).toBe(82);
  });
});

describe('初期ロスター生成（第12章）', () => {
  it('コーダー2 + レビュアー1 を満タンのスタミナで配置する', () => {
    const r = createInitialRoster(createRng('roster-a'));
    expect(r.members).toHaveLength(3);
    const sum = rosterSummary(r);
    expect(sum.coders).toBe(2);
    expect(sum.reviewers).toBe(1);
    for (const m of r.members) {
      expect(m.stamina).toBe(m.staminaMax);
      expect(m.onLeave).toBe(false);
    }
  });

  it('初期 AI 配布は starter-ai-junior のみ（RI-77 部分配布）', () => {
    const r = createInitialRoster(createRng('roster-a'));
    const [coder, aiJunior, reviewer] = r.members;
    expect(coder.aiAssigned).toBe(false);
    expect(aiJunior.aiAssigned).toBe(true);
    expect(reviewer.aiAssigned).toBe(false);
    expect(foldFormationEffects(r).aiAdoptionShare).toBeCloseTo(0.5);
  });

  it('同一 seed なら完全再現する（決定論）', () => {
    const a = createInitialRoster(createRng('same'));
    const b = createInitialRoster(createRng('same'));
    expect(a).toEqual(b);
  });

  it('名前抽選が重複し続けると初期メンバーへ連番を付ける', () => {
    const r = createInitialRoster(sequenceRng([0]));
    expect(r.members.map((m) => m.name)).toEqual(['アオイ', 'アオイ2', 'アオイ3']);
    expect(r.members.map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
  });
});

describe('編成効果の集約（個体値→CardEffects）', () => {
  it('コーダーを増やすと Coding 速度と並列枠が上がる', () => {
    const one = roster([member({ id: 'a', assignment: 'coding' })]);
    const two = roster([
      member({ id: 'a', assignment: 'coding' }),
      member({ id: 'b', assignment: 'coding' }),
    ]);
    const f1 = foldFormationEffects(one);
    const f2 = foldFormationEffects(two);
    expect(f2.effects.codingSpeedMul!).toBeGreaterThan(f1.effects.codingSpeedMul!);
    expect(f2.codingSlotBonus).toBeGreaterThan(f1.codingSlotBonus);
  });

  it('レビュアーを置くと Review 効率・容量が上がる', () => {
    const none = roster([member({ id: 'a', assignment: 'coding' })]);
    const withReviewer = roster([
      member({ id: 'a', assignment: 'coding' }),
      member({
        id: 'b',
        assignment: 'review',
        stats: { implementation: 40, review: 70, aiMastery: 40 },
      }),
    ]);
    const f0 = foldFormationEffects(none);
    const f1 = foldFormationEffects(withReviewer);
    expect(f1.effects.reviewEfficiencyMul!).toBeGreaterThan(f0.effects.reviewEfficiencyMul!);
    expect(f1.effects.reviewCapacityMul!).toBeGreaterThan(f0.effects.reviewCapacityMul!);
  });

  it('AIを習熟者へ配ると平均習熟が上がり、編成の reworkRateAdd には載せない', () => {
    const skilled = roster([
      member({
        id: 'a',
        assignment: 'coding',
        aiAssigned: true,
        stats: { implementation: 50, review: 40, aiMastery: 90 },
      }),
    ]);
    const novice = roster([
      member({
        id: 'a',
        assignment: 'coding',
        aiAssigned: true,
        stats: { implementation: 50, review: 40, aiMastery: 15 },
      }),
    ]);
    const fs = foldFormationEffects(skilled);
    const fn = foldFormationEffects(novice);
    expect(fs.aiMasteryNorm).toBeGreaterThan(fn.aiMasteryNorm);
    expect(fs.effects.reworkRateAdd).toBe(0);
    expect(fn.effects.reworkRateAdd).toBe(0);
  });

  it('AI職人トレイトはAI配布時の手戻り低減をさらに強める', () => {
    const plain = roster([
      member({ id: 'a', assignment: 'coding', aiAssigned: true, stats: { aiMastery: 60 } }),
    ]);
    const artisan = roster([
      member({
        id: 'a',
        assignment: 'coding',
        aiAssigned: true,
        traits: ['aiArtisan'],
        stats: { aiMastery: 60 },
      }),
    ]);
    expect(foldFormationEffects(artisan).effects.reworkRateAdd!).toBeLessThan(
      foldFormationEffects(plain).effects.reworkRateAdd!,
    );
  });

  it('休職中・ベンチのメンバーは編成効果に寄与しない', () => {
    const benched = roster([
      member({ id: 'a', assignment: 'coding' }),
      member({ id: 'b', assignment: 'bench' }),
      member({ id: 'c', assignment: 'coding', onLeave: true }),
    ]);
    const onlyOne = roster([member({ id: 'a', assignment: 'coding' })]);
    expect(foldFormationEffects(benched).effects.codingSpeedMul).toBe(
      foldFormationEffects(onlyOne).effects.codingSpeedMul,
    );
  });

  it('コーダー不在では実装能力が大幅に落ちる（幽霊実装者を残さない）', () => {
    const withCoder = foldFormationEffects(roster([member({ id: 'a', assignment: 'coding' })]));
    const noCoder = foldFormationEffects(roster([member({ id: 'a', assignment: 'review' })]));
    expect(noCoder.effects.codingSpeedMul!).toBeLessThan(withCoder.effects.codingSpeedMul!);
    expect(noCoder.effects.codingSpeedMul!).toBeLessThan(0.3);
    // 並列枠も削る（beginSprint の下限まで落とす負値）。
    expect(noCoder.codingSlotBonus).toBeLessThan(0);
  });

  it('編成効果の下限・上限と空コーダー時の値を固定する', () => {
    const noCoder = foldFormationEffects(roster([member({ id: 'r', assignment: 'review' })]));
    expect(noCoder.effects.codingSpeedMul).toBe(0.15);
    expect(noCoder.codingSlotBonus).toBe(-99);

    const weak = foldFormationEffects(
      roster([member({ id: 'c', assignment: 'coding', stats: { implementation: -100 } })]),
    );
    expect(weak.effects.codingSpeedMul).toBe(0.6);

    const strong = foldFormationEffects(
      roster([
        member({ id: 'c1', assignment: 'coding', stats: { implementation: 300 } }),
        member({ id: 'c2', assignment: 'coding', stats: { implementation: 300 } }),
        member({ id: 'c3', assignment: 'coding', stats: { implementation: 300 } }),
        member({ id: 'c4', assignment: 'coding', stats: { implementation: 300 } }),
        member({ id: 'c5', assignment: 'coding', stats: { implementation: 300 } }),
      ]),
    );
    expect(strong.effects.codingSpeedMul).toBe(1.8);
    expect(strong.codingSlotBonus).toBe(3);
  });

  it('レビュー負荷トレイトとシニア配置の focusBonus を厳密に畳み込む', () => {
    const plain = foldFormationEffects(
      roster([
        member({ id: 'c', assignment: 'coding' }),
        member({ id: 'r', assignment: 'review', stats: { review: 50 } }),
      ]),
    );
    const mega = foldFormationEffects(
      roster([
        member({ id: 'c', assignment: 'coding', traits: ['megaPrMaker'] }),
        member({ id: 'r', assignment: 'review', stats: { review: 50 } }),
      ]),
    );
    expect(plain.effects.reviewEfficiencyMul).toBe(0.95);
    expect(mega.effects.reviewEfficiencyMul).toBeCloseTo(0.855);

    const seniors = foldFormationEffects(
      roster([
        member({ id: 's1', rank: 'senior', assignment: 'coding' }),
        member({ id: 's2', rank: 'senior', assignment: 'review' }),
        member({ id: 's3', rank: 'senior', assignment: 'review' }),
        member({ id: 'bench', rank: 'senior', assignment: 'bench' }),
        member({ id: 'leave', rank: 'senior', assignment: 'review', onLeave: true }),
      ]),
    );
    expect(seniors.focusBonus).toBe(2);
  });
});

describe('AI配布が実採用率に反映される（第12.2 / レビュー#C）', () => {
  it('コーダー全員にAIを配れば share=1、誰にも配らなければ share=0', () => {
    const allAi = roster([member({ id: 'a', assignment: 'coding', aiAssigned: true })]);
    const noAi = roster([member({ id: 'a', assignment: 'coding', aiAssigned: false })]);
    expect(foldFormationEffects(allAi).aiAdoptionShare).toBe(1);
    expect(foldFormationEffects(noAi).aiAdoptionShare).toBe(0);
  });

  it('一部のコーダーのみAIなら share は割合になる', () => {
    const half = roster([
      member({ id: 'a', assignment: 'coding', aiAssigned: true }),
      member({ id: 'b', assignment: 'coding', aiAssigned: false }),
    ]);
    expect(foldFormationEffects(half).aiAdoptionShare).toBeCloseTo(0.5);
  });

  it('コーダー不在なら share は 0', () => {
    const onlyReviewer = roster([member({ id: 'a', assignment: 'review', aiAssigned: true })]);
    expect(foldFormationEffects(onlyReviewer).aiAdoptionShare).toBe(0);
  });

  it('レビュアーへのAI配布は手戻り係数に影響しない（AIはコーダー限定）', () => {
    const withCoder = member({ id: 'c', assignment: 'coding', aiAssigned: false });
    const reviewerNoAi = roster([
      withCoder,
      member({ id: 'r', assignment: 'review', aiAssigned: false }),
    ]);
    const reviewerAi = roster([
      withCoder,
      member({ id: 'r', assignment: 'review', aiAssigned: true }),
    ]);
    // レビュアーに AI を配っても reworkRateAdd / aiAdoptionShare は変わらない。
    expect(foldFormationEffects(reviewerAi).effects.reworkRateAdd).toBe(
      foldFormationEffects(reviewerNoAi).effects.reworkRateAdd,
    );
    expect(foldFormationEffects(reviewerAi).aiAdoptionShare).toBe(0);
  });

  it('AI未配布のコーダーは手戻り・障害率へ影響せず、配布時だけ係数を動かす', () => {
    const noAi = foldFormationEffects(
      roster([
        member({ id: 'a', assignment: 'coding', aiAssigned: false, stats: { aiMastery: 0 } }),
      ]),
    );
    expect(noAi.effects.reworkRateAdd).toBe(0);
    expect(noAi.effects.incidentRateMul).toBe(1);

    const riskyAi = foldFormationEffects(
      roster([
        member({ id: 'a', assignment: 'coding', aiAssigned: true, stats: { aiMastery: 0 } }),
      ]),
    );
    expect(riskyAi.effects.reworkRateAdd).toBe(0);
    expect(riskyAi.aiMasteryNorm).toBeGreaterThanOrEqual(0);
    expect(riskyAi.effects.incidentRateMul).toBe(1.05);
  });

  it('setAiAssigned はコーディング担当だけ true にでき、対象なしなら同じロスターを返す', () => {
    const r = roster([member({ id: 'a', assignment: 'coding', aiAssigned: false })]);
    const enabled = setAiAssigned(r, 'a', true);
    expect(enabled.members[0].aiAssigned).toBe(true);
    expect(setAiAssigned(r, 'missing', true)).toBe(r);
  });

  it('setAiAssigned は非ブール値を真偽値へ強制する（structuredClone を壊さない）', () => {
    const r = roster([member({ id: 'a', assignment: 'coding', aiAssigned: false })]);
    // 素の JS から関数など非ブール値が来てもクローン可能な boolean を保つ。
    const fn = () => undefined;
    const out = setAiAssigned(r, 'a', fn as unknown as boolean);
    expect(typeof out.members[0].aiAssigned).toBe('boolean');
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('コーディング以外へ移すと AI 配布は外れる', () => {
    const r = roster([member({ id: 'a', assignment: 'coding', aiAssigned: true })]);
    expect(assignMember(r, 'a', 'review').members[0].aiAssigned).toBe(false);
    expect(assignMember(r, 'a', 'bench').members[0].aiAssigned).toBe(false);
    // setAiAssigned もレビュー担当には効かない。
    const reviewer = roster([member({ id: 'a', assignment: 'review', aiAssigned: false })]);
    expect(setAiAssigned(reviewer, 'a', true).members[0].aiAssigned).toBe(false);
  });
});

describe('トレイト効果（第12.1）', () => {
  it('燃え尽き気味はスタミナ上限を下げる', () => {
    const normal = computeStaminaMax('middle', 1, []);
    const burnout = computeStaminaMax('middle', 1, ['burnoutProne']);
    expect(burnout).toBeLessThan(normal);
  });

  it('レビュー鬼はレビュー寄与を高める', () => {
    const plain = member({ assignment: 'review', traits: [] });
    const demon = member({ assignment: 'review', traits: ['reviewDemon'] });
    expect(effectiveReview(demon)).toBeGreaterThan(effectiveReview(plain));
  });

  it('ドキュメント魔は在籍するだけでドキュメントを積む', () => {
    const r = roster([member({ id: 'a', assignment: 'coding', traits: ['docMaster'] })]);
    const { outcome } = applySprintGrowth(r, { delivered: 50, done: 10 }, createRng('doc'));
    expect(outcome.docGain).toBeGreaterThan(0);
  });

  it('休職中のドキュメント魔はドキュメントを積まない', () => {
    const r = roster([
      member({ id: 'a', assignment: 'bench', traits: ['docMaster'], onLeave: true }),
    ]);
    const { outcome } = applySprintGrowth(r, { delivered: 50, done: 10 }, sequenceRng([0.99]));
    expect(outcome.docGain).toBe(0);
  });
});

describe('成長・昇格（第12.2）', () => {
  it('1スプリントの経験値・消耗を厳密に反映し、イベントなしなら結果配列は空', () => {
    const r = roster([member({ id: 'a', assignment: 'coding', xp: 0, stamina: 80 })]);
    const { roster: after, outcome } = applySprintGrowth(
      r,
      { delivered: 10, done: 10 },
      sequenceRng([0.99]),
    );
    expect(after.members[0]).toMatchObject({ xp: 30, level: 1, rank: 'middle', stamina: 58 });
    expect(outcome).toEqual({ promotions: [], leveledUp: [], wentOnLeave: [], docGain: 0 });
  });

  it('経験値が閾値ちょうどに達するとレベルアップし、ミドル・シニア昇格を記録する', () => {
    const level2 = applySprintGrowth(
      roster([
        member({ id: 'a', name: '境界', rank: 'middle', level: 1, xp: 50, assignment: 'coding' }),
      ]),
      { delivered: 0, done: 10 },
      sequenceRng([0.99]),
    );
    expect(level2.roster.members[0]).toMatchObject({ level: 2, xp: 0, rank: 'middle' });
    expect(level2.outcome.leveledUp).toEqual(['a']);
    expect(level2.outcome.promotions).toEqual([]);

    const toMiddle = applySprintGrowth(
      roster([
        member({ id: 'j', name: '昇格J', rank: 'junior', level: 3, xp: 101, assignment: 'coding' }),
      ]),
      { delivered: 0, done: 10 },
      sequenceRng([0.99]),
    );
    expect(toMiddle.roster.members[0]).toMatchObject({ level: 4, rank: 'middle' });
    expect(toMiddle.outcome.promotions).toEqual([{ id: 'j', name: '昇格J', to: 'middle' }]);

    const toSenior = applySprintGrowth(
      roster([
        member({ id: 's', name: '昇格S', rank: 'middle', level: 7, xp: 230, assignment: 'coding' }),
      ]),
      { delivered: 0, done: 10 },
      sequenceRng([0.99]),
    );
    expect(toSenior.roster.members[0]).toMatchObject({ level: 8, rank: 'senior' });
    expect(toSenior.outcome.promotions).toEqual([{ id: 's', name: '昇格S', to: 'senior' }]);
  });

  it('AI配布とレビューレーンのスタミナ消耗を固定する', () => {
    const after = applySprintGrowth(
      roster([
        member({ id: 'ai', assignment: 'coding', aiAssigned: true, stamina: 80 }),
        member({ id: 'review', assignment: 'review', stamina: 80 }),
        member({ id: 'demon', assignment: 'review', traits: ['reviewDemon'], stamina: 80 }),
      ]),
      { delivered: 0, done: 0 },
      sequenceRng([0.99]),
    ).roster;
    expect(after.members.map((m) => m.stamina)).toEqual([61, 52, 43]);
  });

  it('RI-73 / F-1: 稼働人数が増えると個人スタミナ消費が薄まる', () => {
    expect(staminaDrainShareMul(3)).toBe(1);
    expect(staminaDrainShareMul(5)).toBeCloseTo(0.6, 5);
    expect(staminaDrainShareMul(6)).toBe(0.5);
    expect(staminaDrainShareMul(1)).toBe(1);

    const three = applySprintGrowth(
      roster([
        member({ id: 'a', assignment: 'coding', stamina: 80 }),
        member({ id: 'b', assignment: 'coding', stamina: 80 }),
        member({ id: 'c', assignment: 'review', stamina: 80 }),
      ]),
      { delivered: 0, done: 0 },
      sequenceRng([0.99, 0.99, 0.99]),
    ).roster;
    const five = applySprintGrowth(
      roster([
        member({ id: 'a', assignment: 'coding', stamina: 80 }),
        member({ id: 'b', assignment: 'coding', stamina: 80 }),
        member({ id: 'c', assignment: 'review', stamina: 80 }),
        member({ id: 'd', assignment: 'coding', stamina: 80 }),
        member({ id: 'e', assignment: 'review', stamina: 80 }),
      ]),
      { delivered: 0, done: 0 },
      sequenceRng([0.99, 0.99, 0.99, 0.99, 0.99]),
    ).roster;
    // コーダー a の残スタミナが人数増で高く残る（消耗が薄い）。
    expect(five.members[0].stamina).toBeGreaterThan(three.members[0].stamina);
  });

  it('RI-73 / F-1: レビュアー人数で reviewHpCostMul が下がる', () => {
    expect(reviewHpCostMulForReviewers(1)).toBe(1);
    expect(reviewHpCostMulForReviewers(2)).toBeCloseTo(1 / 1.15, 5);
    expect(reviewHpCostMulForReviewers(6)).toBe(0.65);

    const one = foldFormationEffects(roster([member({ id: 'r', assignment: 'review' })]));
    const three = foldFormationEffects(
      roster([
        member({ id: 'r1', assignment: 'review' }),
        member({ id: 'r2', assignment: 'review' }),
        member({ id: 'r3', assignment: 'review' }),
      ]),
    );
    expect(one.effects.reviewHpCostMul).toBe(1);
    expect(three.effects.reviewHpCostMul!).toBeLessThan(1);
    expect(three.effects.reviewHpCostMul).toBe(reviewHpCostMulForReviewers(3));
  });

  it('RI-73 / F-1: 稼働人数で seniorHpCostMul が下がる', () => {
    const three = foldFormationEffects(
      roster([
        member({ id: 'a', assignment: 'coding' }),
        member({ id: 'b', assignment: 'coding' }),
        member({ id: 'c', assignment: 'review' }),
      ]),
    );
    const five = foldFormationEffects(
      roster([
        member({ id: 'a', assignment: 'coding' }),
        member({ id: 'b', assignment: 'coding' }),
        member({ id: 'c', assignment: 'review' }),
        member({ id: 'd', assignment: 'coding' }),
        member({ id: 'e', assignment: 'review' }),
      ]),
    );
    expect(three.effects.seniorHpCostMul).toBe(1);
    expect(five.effects.seniorHpCostMul!).toBeLessThan(1);
  });

  it('配置された稼働メンバーは経験値を得てレベルアップし、やがて昇格する', () => {
    let r = roster([member({ id: 'a', rank: 'junior', level: 1, assignment: 'coding' })]);
    let promoted = false;
    for (let i = 0; i < 20; i += 1) {
      const res = applySprintGrowth(r, { delivered: 60, done: 12 }, createRng(`g${i}`));
      r = res.roster;
      // スタミナ枯渇で休職しないよう毎回回復させる。
      r = recoverStamina(r, 100);
      if (res.outcome.promotions.length > 0) promoted = true;
    }
    const m = r.members[0];
    expect(m.level).toBeGreaterThan(1);
    expect(['middle', 'senior']).toContain(m.rank);
    expect(promoted).toBe(true);
  });

  it('ジュニアはミドルより速く伸びる（学習速度）', () => {
    const jr = roster([member({ id: 'a', rank: 'junior', assignment: 'coding' })]);
    const mid = roster([member({ id: 'a', rank: 'middle', assignment: 'coding' })]);
    const jrXp = applySprintGrowth(jr, { delivered: 40, done: 10 }, createRng('j')).roster
      .members[0];
    const midXp = applySprintGrowth(mid, { delivered: 40, done: 10 }, createRng('m')).roster
      .members[0];
    // junior は同条件で XP（または level）の伸びが大きい。
    const jrTotal = jrXp.xp + jrXp.level * 1000;
    const midTotal = midXp.xp + midXp.level * 1000;
    expect(jrTotal).toBeGreaterThan(midTotal);
  });

  it('ベンチのメンバーは消耗も成長もしない', () => {
    const r = roster([member({ id: 'a', assignment: 'bench', stamina: 50, staminaMax: 80 })]);
    const { roster: after } = applySprintGrowth(r, { delivered: 60, done: 12 }, createRng('b'));
    expect(after.members[0].stamina).toBe(50);
    expect(after.members[0].xp).toBe(0);
  });

  it('入力ロスターは破壊されない（純関数）', () => {
    const r = roster([member({ id: 'a', assignment: 'coding' })]);
    const snapshot = structuredClone(r);
    applySprintGrowth(r, { delivered: 60, done: 12 }, createRng('imm'));
    expect(r).toEqual(snapshot);
  });
});

describe('スタミナと離脱（休職）（第12.2）', () => {
  it('離脱判定の閾値と乱数境界を固定する', () => {
    let calls = 0;
    const atThreshold = applySprintGrowth(
      roster([member({ id: 'a', assignment: 'coding', stamina: 36 })]),
      { delivered: 0, done: 0 },
      () => {
        calls += 1;
        return 0.99;
      },
    );
    expect(atThreshold.roster.members[0].stamina).toBe(14);
    expect(atThreshold.roster.members[0].onLeave).toBe(false);
    expect(calls).toBe(1);

    const boundaryRng = applySprintGrowth(
      roster([member({ id: 'b', assignment: 'coding', stamina: 22, aiAssigned: false })]),
      { delivered: 0, done: 0 },
      sequenceRng([0.5]),
    );
    expect(boundaryRng.roster.members[0].stamina).toBe(0);
    expect(boundaryRng.roster.members[0].onLeave).toBe(false);

    const leave = applySprintGrowth(
      roster([
        member({ id: 'c', name: '離脱者', assignment: 'coding', stamina: 22, aiAssigned: true }),
      ]),
      { delivered: 0, done: 0 },
      sequenceRng([0]),
    );
    expect(leave.outcome.wentOnLeave).toEqual([{ id: 'c', name: '離脱者' }]);
    expect(leave.roster.members[0]).toMatchObject({
      stamina: 3,
      onLeave: true,
      assignment: 'bench',
      aiAssigned: false,
    });
  });

  it('連続稼働でスタミナが枯渇し、やがて休職する', () => {
    let r = roster([member({ id: 'a', assignment: 'review', stamina: 30, staminaMax: 80 })]);
    let leftAt = -1;
    for (let i = 0; i < 12; i += 1) {
      const res = applySprintGrowth(r, { delivered: 10, done: 3 }, createRng(`leave${i}`));
      r = res.roster;
      if (res.outcome.wentOnLeave.length > 0) {
        leftAt = i;
        break;
      }
    }
    expect(leftAt).toBeGreaterThanOrEqual(0);
    expect(r.members[0].onLeave).toBe(true);
    expect(r.members[0].assignment).toBe('bench');
  });

  it('休息で回復すると休職から復帰する', () => {
    const r = roster([
      member({ id: 'a', assignment: 'bench', stamina: 0, staminaMax: 80, onLeave: true }),
    ]);
    const after = recoverStamina(r, 80);
    expect(after.members[0].onLeave).toBe(false);
    expect(after.members[0].stamina).toBeGreaterThan(0);
  });

  it('休職中は復帰閾値未満なら休職を継続し、閾値ちょうどで復帰する', () => {
    const below = recoverStamina(
      roster([member({ id: 'a', assignment: 'bench', stamina: 0, staminaMax: 80, onLeave: true })]),
      25,
    );
    expect(below.members[0]).toMatchObject({ stamina: 31, onLeave: true });

    const exact = recoverStamina(
      roster([member({ id: 'a', assignment: 'bench', stamina: 0, staminaMax: 80, onLeave: true })]),
      25.6,
    );
    expect(exact.members[0]).toMatchObject({ stamina: 32, onLeave: false });
  });

  it('skipIds のメンバーは回復しない（休職直後の即復帰を防ぐ）', () => {
    const r = roster([
      member({ id: 'a', assignment: 'bench', stamina: 0, staminaMax: 50, onLeave: true }),
      member({ id: 'b', assignment: 'coding', stamina: 40, staminaMax: 80 }),
    ]);
    const after = recoverStamina(r, 20, new Set(['a']));
    // a は今回スキップ（据え置き・休職継続）、b は通常回復。
    expect(after.members[0].stamina).toBe(0);
    expect(after.members[0].onLeave).toBe(true);
    expect(after.members[1].stamina).toBeGreaterThan(40);
  });
});

describe('編成操作と表情演出', () => {
  it('assignMember は新しいロスターを返し、元を変えない', () => {
    const r = roster([member({ id: 'a', assignment: 'coding' })]);
    const moved = assignMember(r, 'a', 'review');
    expect(moved).not.toBe(r);
    expect(moved.members[0].assignment).toBe('review');
    expect(r.members[0].assignment).toBe('coding');
  });

  it('assignMember は対象なしなら同じロスターを返し、coding への移動では既存AI配布を保つ', () => {
    const r = roster([member({ id: 'a', assignment: 'review', aiAssigned: true })]);
    expect(assignMember(r, 'missing', 'coding')).toBe(r);
    const moved = assignMember(r, 'a', 'coding');
    expect(moved.members[0]).toMatchObject({ assignment: 'coding', aiAssigned: true });
  });

  it('休職中のメンバーは配置できない', () => {
    const r = roster([member({ id: 'a', assignment: 'bench', onLeave: true })]);
    expect(assignMember(r, 'a', 'coding').members[0].assignment).toBe('bench');
  });

  it('ベンチへ移すと AI 配布が即座に外れる（隠れた割り当てを残さない）', () => {
    let r = roster([member({ id: 'a', assignment: 'coding', aiAssigned: true })]);
    r = assignMember(r, 'a', 'bench');
    expect(r.members[0].aiAssigned).toBe(false);
    // ベンチ中は setAiAssigned で再度 ON にできない。
    r = setAiAssigned(r, 'a', true);
    expect(r.members[0].aiAssigned).toBe(false);
  });

  it('不正なレーン値は無視され、ロスターを破壊しない（window.game 防御）', () => {
    const r = roster([member({ id: 'a', assignment: 'coding' })]);
    // 素の JS から不正な文字列が渡る状況を模す。
    const result = assignMember(r, 'a', 'invalid' as unknown as 'coding');
    expect(result).toBe(r);
    expect(result.members[0].assignment).toBe('coding');
  });

  it('表情はスタミナと休職状態から導かれる', () => {
    expect(memberExpression(member({ onLeave: true }))).toBe('leave');
    expect(memberExpression(member({ stamina: 5, staminaMax: 80 }))).toBe('tired');
    expect(memberExpression(member({ stamina: 80, staminaMax: 80 }))).toBe('great');
    expect(memberExpression(member({ stamina: 40, staminaMax: 80 }))).toBe('normal');
  });

  it('表情の境界値は 25% と 80% ちょうどを normal とし、上限0は tired に倒す', () => {
    expect(memberExpression(member({ stamina: 20, staminaMax: 80 }))).toBe('normal');
    expect(memberExpression(member({ stamina: 64, staminaMax: 80 }))).toBe('normal');
    expect(memberExpression(member({ stamina: 1, staminaMax: 0 }))).toBe('tired');
  });
});

describe('組織スケール向け個体集約（RI-27）', () => {
  it('activeEngineerCount は休職者を除外する', () => {
    const r = roster([
      member({ id: 'a', onLeave: false }),
      member({ id: 'b', onLeave: true }),
      member({ id: 'c', onLeave: false }),
    ]);
    expect(activeEngineerCount(r)).toBe(2);
    expect(rosterSummary(r).active).toBe(2);
  });

  it('aiAssignedCount は稼働かつ AI 配布中のみ数える', () => {
    const r = roster([
      member({ id: 'a', aiAssigned: true, onLeave: false }),
      member({ id: 'b', aiAssigned: true, onLeave: true }),
      member({ id: 'c', aiAssigned: false, onLeave: false }),
    ]);
    expect(aiAssignedCount(r)).toBe(1);
  });
});

describe('採用（第12.2）', () => {
  it('採用候補アーキタイプは乱数を候補数に掛けて選ぶ', () => {
    expect(pickRecruitArchetype(sequenceRng([0]))).toBe(RECRUIT_ARCHETYPES[0]);
    expect(pickRecruitArchetype(sequenceRng([0.999]))).toBe(
      RECRUIT_ARCHETYPES[RECRUIT_ARCHETYPES.length - 1],
    );
  });

  it('採用時の名前重複が続くと + を付け、次IDを採番してベンチに入れる', () => {
    const r = roster([member({ id: 'a', name: MEMBER_NAMES[0] })]);
    const hired = recruitMember(r, RECRUIT_ARCHETYPES[0], sequenceRng([0]));
    expect(hired.members[1]).toMatchObject({
      id: 'm1',
      name: `${MEMBER_NAMES[0]}+`,
      assignment: 'bench',
      aiAssigned: false,
    });
    expect(hired.nextId).toBe(2);
  });

  it('上限まで採用でき、満員になると採用できない', () => {
    let r = roster([member({ id: 'a' })]);
    let guard = 0;
    while (canRecruit(r) && guard < 20) {
      r = recruitMember(r, RECRUIT_ARCHETYPES[0], createRng(`rec${guard}`));
      guard += 1;
    }
    expect(r.members.length).toBe(ROSTER_CAP);
    const before = r;
    r = recruitMember(r, RECRUIT_ARCHETYPES[0], createRng('over'));
    expect(r).toBe(before);
  });

  it('採用直後はベンチに入る（編成は明示配置）', () => {
    const r = recruitMember(roster([member({ id: 'a' })]), RECRUIT_ARCHETYPES[0], createRng('r'));
    expect(r.members[1].assignment).toBe('bench');
  });
});

describe('createMember の既定編成', () => {
  it('推奨レーンが coding のアーキタイプは AI 配布つきで生成される', () => {
    const arch = RECRUIT_ARCHETYPES.find((a) => a.preferred === 'coding')!;
    const m = createMember(arch, 'テスト', 'm9');
    expect(m.assignment).toBe('coding');
    expect(m.aiAssigned).toBe(true);
    expect(m.stamina).toBe(m.staminaMax);
  });
});
