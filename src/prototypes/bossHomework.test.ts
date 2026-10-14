import { describe, expect, it } from 'vitest';
import {
  applyBossHomework as apply,
  chooseBossHomeworkAction,
  compareBossHomework,
  createBossHomework as create,
  summarizeBossHomework,
  viewBossHomework,
} from './bossHomework';
import comparison from '../../docs/prototypes/boss-homework-comparison.json';

describe('RI-251 失敗したボスの宿題', () => {
  it('継続できる未達理由と解消条件を先に示し、選択だけでは解消しない', () => {
    const first = create('RI-251', 'lasting');
    expect(create('RI-251', 'lasting')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewBossHomework(first);
    for (let i = 0; i < 8; i++) expect(viewBossHomework(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      reason: 'evidence-short',
      continuable: true,
      endedRunsContinued: false,
      homeworkLeft: 4,
      homeworkTotal: 4,
      goalWindow: 3,
      goalValue: 14,
      penaltyRate: 5,
      sourceFailures: 1,
      resolution: 'finish-evidence',
      choices: ['homework', 'goal'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.residual])).toEqual([
      ['homework', 14, 0],
      ['goal', 9, 0],
    ]);
    const chosen = apply(first, { type: 'homework' });
    expect(chosen).toMatchObject({ resolved: false, delivered: 0, homeworkLeft: 4 });
    expect(apply(chosen, { type: 'goal' })).toBe(chosen);
    expect(viewBossHomework(chosen).choices).toEqual([]);
    expect(
      viewBossHomework(create('RI-251', 'exposed')).forecasts.map((item) => item.score),
    ).toEqual([0, 11]);
  });

  it('目標が残る期間は宿題優先、目標が今期限りの期間は新目標が上回る', () => {
    const rows = compareBossHomework(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('lasting', 'homework').result).toMatchObject({
      score: 14,
      delivered: 14,
      penalty: 0,
      residual: 0,
      resolved: true,
      goalMissed: false,
      sourceFailures: 1,
      path: [0, 0, 14, 14],
    });
    expect(row('lasting', 'goal').result).toMatchObject({
      score: 9,
      penalty: 5,
      residual: 0,
      resolved: true,
      sourceFailures: 1,
    });
    expect(row('exposed', 'goal').result).toMatchObject({
      score: 11,
      delivered: 14,
      penalty: 3,
      residual: 12,
      homeworkLeft: 4,
      resolved: false,
      lost: false,
    });
    expect(row('exposed', 'homework').result).toMatchObject({
      score: 0,
      delivered: 0,
      residual: 0,
      resolved: true,
      goalMissed: true,
    });
    expect(row('lasting', 'homework').result.score).toBeGreaterThan(
      row('lasting', 'goal').result.score,
    );
    expect(row('exposed', 'goal').result.score).toBeGreaterThan(
      row('exposed', 'homework').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.sourceFailures).toBe(1);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareBossHomework(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseBossHomeworkAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeBossHomework(live)).toEqual(row.result);
    }
  });
});
