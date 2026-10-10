import { describe, expect, it } from 'vitest';
import {
  applyRoleChallengeInput as apply,
  chooseRoleChallengeAction,
  compareRoleChallenges,
  createRoleChallengePrototype as create,
  summarizeRoleChallenge,
  viewRoleChallenge,
} from './roleChallenge';
import comparison from '../../docs/prototypes/role-challenge-comparison.json';

describe('RI-202 本人が望む挑戦', () => {
  it('誰がどの担当を望み、現在値と次期の見通しを配置前に示す', () => {
    const first = create('RI-202', 'pressed');
    expect(create('RI-202', 'pressed')).toEqual(first);
    expect(create('other', 'slack').board).toBe('slack');
    const before = structuredClone(first);
    const blank = viewRoleChallenge(first);
    for (let i = 0; i < 10; i++) expect(viewRoleChallenge(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      seats: 1,
      targets: [8, 4],
      wish: { id: 'mei', role: 'review', review: 2, outlook: 5, assignment: null },
      senior: { id: 'sato', review: 8, assignment: 'review' },
    });
  });

  it('レビューへ置いた期だけ成長し、コーディング配置のままでは増えない', () => {
    let accepted = apply(create('RI-202', 'slack'), { type: 'place', assignment: 'review' });
    expect(accepted.members.find((item) => item.id === 'sato')?.assignment).toBe('review');
    accepted = apply(accepted, { type: 'period' });
    expect(summarizeRoleChallenge(accepted)).toMatchObject({
      assignment: 'review',
      meiReview: 5,
      growth: 3,
      growthEvents: 1,
      reviewValue: 10,
    });
    accepted = apply(accepted, { type: 'period' });
    expect(accepted.growthEvents).toBe(1);
    expect(accepted.members.find((item) => item.id === 'mei')?.review).toBe(5);

    const declined = apply(
      apply(create('RI-202', 'slack'), { type: 'place', assignment: 'coding' }),
      { type: 'period' },
    );
    expect(summarizeRoleChallenge(declined)).toMatchObject({
      assignment: 'coding',
      meiReview: 2,
      growth: 0,
      growthEvents: 0,
      reviewValue: 8,
    });
  });

  it('未配置の進行、担当外の値、二度目の配置、期末は無消費で拒否する', () => {
    const initial = create('RI-202', 'pressed');
    expect(apply(initial, { type: 'period' })).toBe(initial);
    expect(apply(initial, { type: 'place', assignment: 'lead' })).toBe(initial);
    const placed = apply(initial, { type: 'place', assignment: 'review' });
    expect(memberAssignment(placed, 'sato')).toBe('coding');
    expect(apply(placed, { type: 'place', assignment: 'coding' })).toBe(placed);
    let ended = placed;
    while (ended.period < ended.horizon) ended = apply(ended, { type: 'period' });
    expect(apply(ended, { type: 'period' })).toBe(ended);
    expect(apply(ended, { type: 'place', assignment: 'coding' })).toBe(ended);
  });

  it('主力不足では見送り、余力があるときは受諾の差引が上回る', () => {
    const rows = compareRoleChallenges(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('pressed', 'accept'), score('pressed', 'decline')]).toEqual([1, 16]);
    expect([score('slack', 'accept'), score('slack', 'decline')]).toEqual([23, 10]);
    const declined = rows.find((row) => row.board === 'pressed' && row.strategy === 'decline')!;
    expect(declined.result.reviewValue).toBeGreaterThan(0);
    expect(declined.result.growth).toBe(0);
    const accepted = rows.find((row) => row.board === 'slack' && row.strategy === 'accept')!.result;
    expect(accepted.history.map((item) => item.met)).toEqual([true, true]);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareRoleChallenges(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRoleChallengeAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeRoleChallenge(live)).toEqual(row.result);
    }
  });
});

function memberAssignment(
  state: ReturnType<typeof create>,
  id: string,
): 'review' | 'coding' | null | undefined {
  return state.members.find((item) => item.id === id)?.assignment;
}
