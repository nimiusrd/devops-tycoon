import { describe, expect, it } from 'vitest';
import {
  applySharedExpert as apply,
  assignMany,
  chooseExpertAction,
  compareSharedExperts,
  createSharedExpert as create,
  summarizeSharedExpert,
  viewSharedExpert,
} from './sharedExpert';
import comparison from '../../docs/prototypes/shared-expert-comparison.json';

describe('RI-218 共有専門家の取り合い', () => {
  it('1期間の支援枠と、依頼ごとの必要枠・チームを事前に示す', () => {
    const first = create('RI-218', 'due');
    expect(create('RI-218', 'due')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewSharedExpert(first);
    for (let i = 0; i < 8; i++) expect(viewSharedExpert(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank.slots).toBe(1);
    expect(blank.expert).toBeNull();
    expect(blank.requests.map((item) => [item.id, item.team, item.slots, item.status])).toEqual([
      ['ship', 'product', 2, 'pending'],
      ['risk', 'incident', 2, 'pending'],
      ['design', 'platform', 2, 'pending'],
    ]);
    expect(new Set(blank.requests.map((item) => item.team)).size).toBe(3);
  });

  it('同じ期間に複数チームへ配置できず、期限後の完了は価値0で保留を解く', () => {
    const fresh = create('RI-218', 'exposure');
    expect(assignMany(fresh, ['ship', 'risk'])).toBe(fresh);
    expect(assignMany(fresh, ['ship', 'ship'])).toBe(fresh);
    expect(apply(fresh, { type: 'assign', id: 'missing' })).toBe(fresh);

    let state = fresh;
    state = apply(state, { type: 'assign', id: 'ship' });
    expect(state.expert).toBe('product');
    state = apply(state, { type: 'assign', id: 'ship' });
    expect(state.delivered).toEqual([{ id: 'ship', tick: 1, value: 8 }]);
    expect(apply(state, { type: 'assign', id: 'ship' })).toBe(state);
    state = apply(state, { type: 'assign', id: 'risk' });
    state = apply(state, { type: 'assign', id: 'risk' });
    expect(state.expert).toBe('incident');
    expect(state.delivered[1]).toEqual({ id: 'risk', tick: 3, value: 0 });
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'risk')).toMatchObject({
      status: 'done',
      openRisk: 0,
    });
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'design')).toMatchObject({
      status: 'pending',
      openRisk: 4,
    });
    expect(summarizeSharedExpert(state).lost).toBe(false);
  });

  it('閲覧しても進捗は変わらず、全待ちでも敗北にしない', () => {
    const fresh = create('RI-218', 'due');
    let seen = fresh;
    for (const id of ['ship', 'risk', 'design']) seen = apply(seen, { type: 'view', id });
    expect(apply(seen, { type: 'view', id: 'ship' })).toBe(seen);
    expect(seen.requests).toEqual(fresh.requests);
    expect(seen.tick).toBe(0);
    let idle = fresh;
    while (idle.tick < idle.horizon) idle = apply(idle, { type: 'wait' });
    expect(summarizeSharedExpert(idle)).toMatchObject({
      value: 0,
      risk: 10,
      score: -10,
      pending: ['ship', 'risk', 'design'],
      lost: false,
    });
    expect(apply(idle, { type: 'assign', id: 'ship' })).toBe(idle);
  });

  it('期限が近い盤面は期限順、リスクが大きい盤面は影響順の差引が上回る', () => {
    const rows = compareSharedExperts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('due', 'deadline'), score('due', 'impact')]).toEqual([8, 4]);
    expect([score('exposure', 'impact'), score('exposure', 'deadline')]).toEqual([7, 4]);
    const late = rows.find((row) => row.board === 'exposure' && row.strategy === 'deadline')!;
    expect(late.result.delivered).toContainEqual({ id: 'risk', tick: 3, value: 0 });
    expect(late.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSharedExperts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseExpertAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSharedExpert(live)).toEqual(row.result);
    }
  });
});
