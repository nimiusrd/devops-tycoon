import { describe, expect, it } from 'vitest';
import {
  applyOnCallRotation as apply,
  assignOnCall,
  chooseOnCallAction,
  compareOnCallRotations,
  createOnCallRotation as create,
  summarizeOnCallRotation,
  viewOnCallRotation,
} from './onCallRotation';
import comparison from '../../docs/prototypes/oncall-rotation-comparison.json';

describe('RI-221 当番の持ち回り', () => {
  it('当番、期間、通常作業へ残る余力を事前に示す', () => {
    const first = create('RI-221', 'quiet');
    expect(create('RI-221', 'quiet')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewOnCallRotation(first);
    for (let i = 0; i < 8; i++) expect(viewOnCallRotation(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ onCall: null, period: 0, horizon: 2, ordinaryCapacity: 6 });
    const ace = apply(first, { type: 'assign', id: 'ace' });
    expect(viewOnCallRotation(ace)).toMatchObject({
      onCall: 'ace',
      period: 1,
      ordinaryCapacity: 2,
    });
  });

  it('同じ期間に二人を当番にせず、消耗と経験は一度だけ足す', () => {
    const fresh = create('RI-221', 'mixed');
    expect(assignOnCall(fresh, ['ace', 'jun'])).toBe(fresh);
    expect(assignOnCall(fresh, [])).toBe(fresh);
    const once = apply(fresh, { type: 'assign', id: 'jun' });
    expect(once.people).toEqual([
      expect.objectContaining({ id: 'ace', fatigue: 0, experience: 0 }),
      expect.objectContaining({ id: 'jun', fatigue: 1, experience: 1 }),
    ]);
    expect(once.incidentLeft).toBe(3);
    const twice = apply(once, { type: 'assign', id: 'ace' });
    expect(twice.people).toEqual([
      expect.objectContaining({ id: 'ace', fatigue: 2, experience: 0 }),
      expect.objectContaining({ id: 'jun', fatigue: 1, experience: 1 }),
    ]);
    expect(twice.incidentLeft).toBe(0);
    expect(apply(twice, { type: 'view' })).toBe(twice);
  });

  it('同じ人を当番に固定でき、未解決でも敗北にしない', () => {
    let ace = create('RI-221', 'severe');
    while (ace.tick < ace.horizon) ace = apply(ace, { type: 'assign', id: 'ace' });
    expect(ace.inputs).toEqual([
      { type: 'assign', id: 'ace' },
      { type: 'assign', id: 'ace' },
    ]);
    expect(summarizeOnCallRotation(ace).lost).toBe(false);
    const junior = compareOnCallRotations('RI-221').find(
      (row) => row.board === 'severe' && row.strategy === 'junior',
    )!;
    expect(junior.result.score).toBeLessThan(0);
    expect(junior.result.lost).toBe(false);
    expect(summarizeOnCallRotation(ace)).toEqual(summarizeOnCallRotation(ace));
  });

  it('静穏は新人、重大は主力、中間は持ち回りの差引が上回る', () => {
    const rows = compareOnCallRotations(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('quiet', 'junior'), score('quiet', 'rotate'), score('quiet', 'ace')]).toEqual([
      6, 3, 0,
    ]);
    expect([score('severe', 'ace'), score('severe', 'junior'), score('severe', 'rotate')]).toEqual([
      0, -6, -9,
    ]);
    expect([score('mixed', 'rotate'), score('mixed', 'ace'), score('mixed', 'junior')]).toEqual([
      3, 0, -2,
    ]);
    const rotated = rows.find((row) => row.board === 'mixed' && row.strategy === 'rotate')!;
    expect(rotated.result.experience).toEqual([
      { id: 'ace', experience: 0 },
      { id: 'jun', experience: 1 },
    ]);
    expect(rotated.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareOnCallRotations(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseOnCallAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeOnCallRotation(live)).toEqual(row.result);
    }
  });
});
