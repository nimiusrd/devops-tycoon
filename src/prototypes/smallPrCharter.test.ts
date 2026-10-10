import { describe, expect, it } from 'vitest';
import {
  applySmallPrCharter as apply,
  chooseCharterAction,
  compareSmallPrCharters,
  createSmallPrCharter as create,
  effectiveSizeLimit,
  summarizeSmallPrCharter,
  viewSmallPrCharter,
} from './smallPrCharter';
import comparison from '../../docs/prototypes/small-pr-charter-comparison.json';

describe('RI-219 小PR憲章', () => {
  it('禁止する出荷と上限を示し、既存上限とは厳しい方だけを併用する', () => {
    const first = create('RI-219', 'safe');
    expect(create('RI-219', 'safe')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewSmallPrCharter(first);
    for (let i = 0; i < 8; i++) expect(viewSmallPrCharter(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      charter: false,
      limit: null,
      forbids: null,
      change: '開始時のみ',
    });
    expect(blank).not.toHaveProperty('cultureBonus');
    const adopted = apply(first, { type: 'adopt' });
    expect(viewSmallPrCharter(adopted)).toMatchObject({
      charter: true,
      adoptedAt: 0,
      limit: 2,
      forbids: 'sizeが2を超える出荷',
    });
    expect(effectiveSizeLimit(false, null)).toBeNull();
    expect(effectiveSizeLimit(false, 3)).toBe(3);
    expect(effectiveSizeLimit(true, null)).toBe(2);
    expect(effectiveSizeLimit(true, 3)).toBe(2);
    expect(effectiveSizeLimit(true, 1)).toBe(1);
  });

  it('憲章中の大きい出荷は進まず、開始後の採用と無憲章の分割は受け付けない', () => {
    const fresh = create('RI-219', 'risky');
    expect(apply(fresh, { type: 'split', id: 'large' })).toBe(fresh);
    const adopted = apply(fresh, { type: 'adopt' });
    expect(apply(adopted, { type: 'adopt' })).toBe(adopted);
    expect(apply(adopted, { type: 'ship', id: 'large' })).toBe(adopted);
    const moved = apply(fresh, { type: 'ship', id: 'small' });
    expect(apply(moved, { type: 'adopt' })).toBe(moved);
    const split = apply(adopted, { type: 'split', id: 'large' });
    expect(split.jobs.map((job) => job.id)).toEqual(['small', 'large-a', 'large-b']);
    expect(
      split.jobs.filter((job) => job.id.startsWith('large')).every((job) => job.risk === 0),
    ).toBe(true);
    expect(apply(split, { type: 'split', id: 'large' })).toBe(split);
  });

  it('危険が小さい盤面は無憲章、大きい盤面は憲章の差引が上回る', () => {
    const rows = compareSmallPrCharters(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('safe', 'free'), score('safe', 'charter')]).toEqual([14, 10]);
    expect([score('risky', 'free'), score('risky', 'charter')]).toEqual([8, 10]);
    const riskyFree = rows.find((row) => row.board === 'risky' && row.strategy === 'free')!;
    expect(riskyFree.result).toMatchObject({ value: 8, charter: false, lost: false, pending: [] });
    const riskyCharter = rows.find((row) => row.board === 'risky' && row.strategy === 'charter')!;
    expect(riskyCharter.result.pending).toEqual(['small']);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSmallPrCharters(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseCharterAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSmallPrCharter(live)).toEqual(row.result);
    }
  });
});
