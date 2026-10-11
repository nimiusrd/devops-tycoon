import { describe, expect, it } from 'vitest';
import {
  applyRescueTeam as apply,
  availableCapacity,
  chooseRescueAction,
  compareRescueTeams,
  createRescueTeam as create,
  summarizeRescueTeam,
  viewRescueTeam,
} from './rescueTeam';
import comparison from '../../docs/prototypes/rescue-team-comparison.json';

describe('RI-224 期間限定の救援チーム', () => {
  it('派遣元、派遣量、救援期間、元チームの余力を操作前に示す', () => {
    const first = create('RI-224', 'deadline');
    expect(create('RI-224', 'deadline')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewRescueTeam(first);
    for (let i = 0; i < 8; i++) expect(viewRescueTeam(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ phase: 'plan', duration: 1, incidentLeft: 4 });
    expect(blank.teams).toEqual([
      { id: 'alpha', capacity: 4, output: 6, loaned: 0, available: 4 },
      { id: 'bravo', capacity: 4, output: 2, loaned: 0, available: 4 },
      { id: 'spare', capacity: 4, output: 2, loaned: 0, available: 4 },
    ]);
    expect(blank.plans.find((plan) => plan.strategy === 'focus')).toMatchObject({
      loans: { alpha: 0, bravo: 0, spare: 4 },
      recovery: 4,
      duration: 1,
    });
  });

  it('貸し出した余力を元チームで使わず、終了と中断は一度だけ返す', () => {
    const fresh = create('RI-224', 'local');
    expect(apply(fresh, { type: 'dispatch', loans: { alpha: 0, bravo: 0, spare: 5 } })).toBe(fresh);
    expect(apply(fresh, { type: 'resolve' })).toBe(fresh);
    const sent = apply(fresh, { type: 'dispatch', loans: { alpha: 0, bravo: 0, spare: 4 } });
    const pool = sent.teams.reduce((sum, team) => sum + team.loaned, 0);
    const available = sent.teams.reduce((sum, team) => sum + availableCapacity(team), 0);
    expect(pool).toBe(4);
    expect(pool + available).toBe(12);
    const worked = apply(sent, { type: 'resolve' });
    expect(worked.shipped).toBe(16);
    expect(worked.recovered).toBe(4);
    const back = apply(worked, { type: 'return' });
    expect(back.teams.every((team) => team.loaned === 0)).toBe(true);
    expect(back.returned).toBe(true);
    expect(back.shipped).toBe(40);
    expect(apply(back, { type: 'return' })).toBe(back);
    expect(apply(back, { type: 'resolve' })).toBe(back);

    const cancelled = apply(sent, { type: 'return' });
    expect(cancelled).toMatchObject({ recovered: 0, returned: true, penalty: 20, shipped: 24 });
    expect(cancelled.teams.every((team) => team.loaned === 0)).toBe(true);
    expect(apply(cancelled, { type: 'return' })).toBe(cancelled);
    expect(apply(sent, { type: 'view' })).toBe(sent);
  });

  it('収まる障害は集中、足りない障害は分散、納期チームを削る均等派遣は見送りが上回る', () => {
    const rows = compareRescueTeams(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('local', 'focus'), score('local', 'spread'), score('local', 'none')]).toEqual([
      40, 36, 28,
    ]);
    expect([score('wide', 'spread'), score('wide', 'focus'), score('wide', 'none')]).toEqual([
      36, 28, 12,
    ]);
    expect([
      score('deadline', 'focus'),
      score('deadline', 'none'),
      score('deadline', 'spread'),
    ]).toEqual([72, 68, 60]);
    for (const row of rows) {
      expect(row.result.returned).toBe(true);
      expect(row.result.loaned).toEqual([
        { id: 'alpha', loaned: 0 },
        { id: 'bravo', loaned: 0 },
        { id: 'spare', loaned: 0 },
      ]);
      expect(row.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareRescueTeams(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRescueAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeRescueTeam(live)).toEqual(row.result);
    }
  });
});
