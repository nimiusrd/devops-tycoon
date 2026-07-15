import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import {
  activeEngineerCount,
  aiAssignedCount,
  applySprintGrowth,
  assignMember,
  canRecruit,
  computeStaminaMax,
  createInitialRoster,
  createMember,
  effectiveReview,
  foldFormationEffects,
  memberExpression,
  recoverStamina,
  recruitMember,
  rosterSummary,
  setAiAssigned,
  ROSTER_CAP,
} from '../../src/sim/member';
import type { Member, RosterState } from '../../src/sim/member';
import { RECRUIT_ARCHETYPES } from '../../src/data/members';

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

  it('同一 seed なら完全再現する（決定論）', () => {
    const a = createInitialRoster(createRng('same'));
    const b = createInitialRoster(createRng('same'));
    expect(a).toEqual(b);
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

  it('AIを習熟者へ配ると手戻りが減り、未熟者へ配ると増える（編成が戦術になる）', () => {
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
    expect(fs.effects.reworkRateAdd!).toBeLessThan(0);
    expect(fn.effects.reworkRateAdd!).toBeGreaterThan(0);
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
});

describe('成長・昇格（第12.2）', () => {
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
