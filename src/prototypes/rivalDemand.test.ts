import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import {
  applyRivalDemand as apply,
  chooseRivalAction,
  compareRivalDemand,
  createRivalDemand as create,
  summarizeRivalDemand,
  viewRivalDemand,
} from './rivalDemand';
import comparison from '../../docs/prototypes/rival-demand-comparison.json';

describe('RI-239 競合が変える需要', () => {
  it('予告、顧客層、需要が変わる時点を示し、閲覧では価格表が動かない', () => {
    const first = create('RI-239', 'preempt');
    expect(create('RI-239', 'preempt')).toEqual(first);
    expect(first.rival.respondents).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewRivalDemand(first);
    for (let i = 0; i < 8; i++) expect(viewRivalDemand(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toMatchObject({
      tick: 0,
      horizon: 2,
      capacity: 4,
      announcement: { feature: 'match', releaseTick: 1, segment: 'pioneer', respondents: 4 },
      changeTick: 1,
      before: { match: 8, own: 8 },
      after: { match: 3, own: 10 },
      now: { match: 8, own: 8 },
    });
    expect(viewRivalDemand(create('RI-239', 'proof')).after).toEqual({ match: 14, own: 6 });
  });

  it('完成済みへは価値を足さず、自社の作業順で競合の価格表は変わらない', () => {
    const open = create('RI-239', 'preempt');
    const notice = structuredClone(open.rival);
    const first = apply(open, { type: 'work', feature: 'match' });
    expect(first.value).toBe(8);
    expect(first.rival).toEqual(notice);
    expect(apply(first, { type: 'work', feature: 'match' })).toBe(first);
    const second = apply(first, { type: 'work', feature: 'own' });
    expect(second.value).toBe(18);
    expect(second.rival).toEqual(notice);
    expect(apply(second, { type: 'work', feature: 'own' })).toBe(second);
    const lateMatch = apply(apply(open, { type: 'work', feature: 'own' }), {
      type: 'work',
      feature: 'match',
    });
    expect(lateMatch.value).toBe(11);
    expect(lateMatch.rival.after).toEqual(notice.after);
  });

  it('公開前に追随する盤面と、公開後の需要増を取る盤面で有利な順が入れ替わる', () => {
    const rows = compareRivalDemand(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('preempt', 'follow').initial.rival).toEqual(
      row('preempt', 'differentiate').initial.rival,
    );
    expect(row('proof', 'follow').initial.rival).toEqual(
      row('proof', 'differentiate').initial.rival,
    );
    expect(row('preempt', 'follow').result).toMatchObject({
      value: 18,
      path: [8, 18],
      after: { match: 3, own: 10 },
      score: 18,
    });
    expect(row('preempt', 'differentiate').result).toMatchObject({
      value: 11,
      path: [8, 11],
      score: 11,
    });
    expect(row('proof', 'follow').result).toMatchObject({
      value: 14,
      path: [8, 14],
      after: { match: 14, own: 6 },
      score: 14,
    });
    expect(row('proof', 'differentiate').result).toMatchObject({
      value: 22,
      path: [8, 22],
      score: 22,
    });
    expect(row('preempt', 'follow').result.score).toBeGreaterThan(
      row('preempt', 'differentiate').result.score,
    );
    expect(row('proof', 'differentiate').result.score).toBeGreaterThan(
      row('proof', 'follow').result.score,
    );
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareRivalDemand(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRivalAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(live.rival).toEqual(row.initial.rival);
      }
      expect(summarizeRivalDemand(live)).toEqual(row.result);
    }
  });
});
