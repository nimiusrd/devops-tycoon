import { describe, expect, it } from 'vitest';
import { getBoss } from '../data/bosses';
import {
  applyBossPrep as apply,
  chooseBossPrepAction,
  compareBossPreps,
  createBossPrep as create,
  projectBossPrep,
  summarizeBossPrep,
  viewBossPrep,
} from './bossPrep';
import comparison from '../../docs/prototypes/boss-prep-comparison.json';

describe('RI-242 ボス前の作戦会議', () => {
  it('在籍する主力だけを温存候補にし、会議を開いただけでは得点しない', () => {
    const boss = getBoss('big-release');
    const first = create('RI-242', 'small');
    expect(create('RI-242', 'small')).toEqual(first);
    expect(boss?.name).toBe('大型リリース');
    const before = structuredClone(first);
    const blank = viewBossPrep(first);
    for (let i = 0; i < 8; i++) expect(viewBossPrep(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toMatchObject({
      bossId: 'big-release',
      bossName: '大型リリース',
      bossQueue: 8,
      reason: 'before-big-release',
      helpsWhen: 'boss-queue-at-least-16',
      hindersWhen: 'boss-queue-at-most-8',
      choices: ['conserve', 'advance'],
      ace: { present: true, active: true, output: 16, drain: 24, stamina: 30 },
    });
    expect(blank.forecasts.map((item) => item.score)).toEqual([20, 30]);
    expect(blank.forecasts.every((item) => item.once)).toBe(true);
    const met = apply(first, { type: 'meet' });
    expect(met.opened).toBe(true);
    expect(met.value).toBe(0);
    expect(met.spent).toBe(0);
    expect(met.budget).toBe(0);
    expect(met.tick).toBe(0);
    expect(apply(met, { type: 'meet' })).toBe(met);
    expect(apply(first, { type: 'choose', prep: 'conserve' })).toBe(first);
    const absent = create('RI-242', 'absent');
    expect(viewBossPrep(absent).choices).toEqual(['cover']);
    expect(viewBossPrep(absent).ace).toMatchObject({ present: false, active: false });
    const absentMet = apply(absent, { type: 'meet' });
    expect(apply(absentMet, { type: 'choose', prep: 'conserve' })).toBe(absentMet);
    expect(apply(absentMet, { type: 'choose', prep: 'advance' })).toBe(absentMet);
    expect(apply(absent, { type: 'note' })).toBe(absent);
  });

  it('準備の効果は次のボススプリントで一度だけ消費し、処理量を超えた分は積まない', () => {
    const open = apply(create('RI-242', 'large'), { type: 'meet' });
    expect(apply(open, { type: 'note' })).toBe(open);
    expect(apply(open, { type: 'resolve' })).toBe(open);
    const conserved = apply(open, { type: 'choose', prep: 'conserve' });
    expect(conserved.periods[0]).toMatchObject({
      phase: 'prep',
      member: 'steady',
      cleared: 8,
      remaining: 12,
    });
    expect(conserved.bossQueue).toBe(16);
    expect(conserved.consumed).toBe(false);
    expect(viewBossPrep(conserved).choices).toEqual([]);
    const boss = apply(conserved, { type: 'resolve' });
    expect(boss.periods[1]).toMatchObject({
      phase: 'boss',
      member: 'ace',
      cleared: 16,
      remaining: 0,
      drain: 24,
    });
    expect(boss.consumed).toBe(true);
    expect(boss.members[1].stamina).toBe(6);
    expect(summarizeBossPrep(boss).score).toBe(60);
    expect(apply(boss, { type: 'resolve' })).toBe(boss);
    expect(apply(boss, { type: 'choose', prep: 'advance' })).toBe(boss);
    const advanced = apply(apply(open, { type: 'choose', prep: 'advance' }), { type: 'resolve' });
    expect(advanced.periods.map((period) => period.member)).toEqual(['ace', 'steady']);
    expect(advanced.budget).toBe(6);
    expect(advanced.members[1].stamina).toBe(6);
    expect(projectBossPrep(create('RI-242', 'large'), 'conserve').score).toBe(60);
    expect(projectBossPrep(create('RI-242', 'small'), 'advance').score).toBe(30);
  });

  it('山場が大きいときは温存、準備仕事が余るときは前倒しが上回る', () => {
    const rows = compareBossPreps(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('small', 'conserve').result).toMatchObject({
      score: 20,
      budget: 0,
      path: [4, 20],
      assigned: ['steady', 'ace'],
      prep: 'conserve',
      skipped: false,
    });
    expect(row('small', 'advance').result).toMatchObject({
      score: 30,
      budget: 6,
      path: [2, 30],
      assigned: ['ace', 'steady'],
      prep: 'advance',
    });
    expect(row('large', 'conserve').result).toMatchObject({
      score: 60,
      value: 96,
      path: [4, 60],
      assigned: ['steady', 'ace'],
    });
    expect(row('large', 'advance').result).toMatchObject({ score: 30, budget: 6, path: [2, 30] });
    expect(row('small', 'advance').result.score).toBeGreaterThan(
      row('small', 'conserve').result.score,
    );
    expect(row('large', 'conserve').result.score).toBeGreaterThan(
      row('large', 'advance').result.score,
    );
    expect(row('absent', 'conserve').result).toMatchObject({
      score: 32,
      prep: 'cover',
      assigned: ['steady', 'steady'],
      skipped: true,
    });
    expect(row('absent', 'advance').result.score).toBe(row('absent', 'conserve').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareBossPreps(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseBossPrepAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeBossPrep(live)).toEqual(row.result);
    }
  });
});
