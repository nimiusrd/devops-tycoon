/**
 * 育成メンバー状態 → 現場キャラ表情の写像の検証（RI-08 / SPEC §12.2）。
 */
import { describe, expect, it } from 'vitest';
import { deriveMemberMoodOverrides } from '../../../src/render/memberMood';
import { mergeStationMood } from '../../../src/render/boardScene';
import type { LaneAssignment, Member, RosterState } from '../../../src/sim/member/types';

let seq = 0;

function member(overrides: Partial<Member> & { assignment: LaneAssignment }): Member {
  seq += 1;
  return {
    id: `m${seq}`,
    name: `メンバー${seq}`,
    rank: 'junior',
    level: 1,
    xp: 0,
    stats: { implementation: 3, review: 2, aiMastery: 2 },
    stamina: 40,
    staminaMax: 80,
    traits: [],
    aiAssigned: false,
    onLeave: false,
    ...overrides,
  };
}

function roster(members: Member[]): RosterState {
  return { members, nextId: members.length + 1 };
}

describe('deriveMemberMoodOverrides', () => {
  it('半数以上が休職なら exhausted', () => {
    const r = roster([
      member({ assignment: 'coding', onLeave: true, stamina: 0 }),
      member({ assignment: 'coding', stamina: 40 }),
    ]);
    expect(deriveMemberMoodOverrides(r).coding).toBe('exhausted');
  });

  it('休職＋疲労が半数以上なら tired', () => {
    const r = roster([
      member({ assignment: 'review', stamina: 10 }), // ratio 0.125 → tired
      member({ assignment: 'review', stamina: 40 }),
    ]);
    expect(deriveMemberMoodOverrides(r).review).toBe('tired');
  });

  it('過半が絶好調なら cheer', () => {
    const r = roster([
      member({ assignment: 'coding', stamina: 75 }), // ratio > 0.8 → great
      member({ assignment: 'coding', stamina: 78 }),
      member({ assignment: 'coding', stamina: 40 }),
    ]);
    expect(deriveMemberMoodOverrides(r).coding).toBe('cheer');
  });

  it('普通のメンバーだけなら上書きしない', () => {
    const r = roster([
      member({ assignment: 'coding', stamina: 40 }),
      member({ assignment: 'review', stamina: 40 }),
    ]);
    expect(deriveMemberMoodOverrides(r)).toEqual({});
  });

  it('bench は集計対象外・配属ゼロのレーンは上書きしない', () => {
    const r = roster([
      member({ assignment: 'bench', onLeave: true, stamina: 0 }),
      member({ assignment: 'bench', stamina: 5 }),
    ]);
    expect(deriveMemberMoodOverrides(r)).toEqual({});
  });

  it('レーンごとに独立して判定する', () => {
    const r = roster([
      member({ assignment: 'coding', stamina: 78 }),
      member({ assignment: 'review', onLeave: true, stamina: 0 }),
    ]);
    const out = deriveMemberMoodOverrides(r);
    expect(out.coding).toBe('cheer');
    expect(out.review).toBe('exhausted');
  });
});

describe('mergeStationMood', () => {
  it('panic は上書きより常に優先する', () => {
    expect(mergeStationMood('panic', 'exhausted')).toBe('panic');
    expect(mergeStationMood('panic', 'cheer')).toBe('panic');
  });

  it('panic 以外は override > 基底', () => {
    expect(mergeStationMood('happy', 'exhausted')).toBe('exhausted');
    expect(mergeStationMood('neutral', 'cheer')).toBe('cheer');
    expect(mergeStationMood('tired', undefined)).toBe('tired');
  });
});
