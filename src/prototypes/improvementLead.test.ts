import { describe, expect, it } from 'vitest';
import {
  applyImprovementLead as apply,
  assignLead,
  chooseLeadAction,
  compareImprovementLeads,
  createImprovementLead as create,
  summarizeImprovementLead,
  viewImprovementLead,
} from './improvementLead';
import comparison from '../../docs/prototypes/improvement-lead-comparison.json';

describe('RI-223 改善の旗振り役', () => {
  it('進捗、再開、現場の危機を操作前に示す', () => {
    const first = create('RI-223', 'near');
    expect(create('RI-223', 'near')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewImprovementLead(first);
    for (let i = 0; i < 8; i++) expect(viewImprovementLead(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      assignee: 'lead',
      progress: 3,
      need: 4,
      remaining: 1,
      restartPending: false,
      periodsOnImprovement: 0,
      crisis: false,
      shipIfField: 4,
      advanceIfImprove: 1,
    });
    expect(viewImprovementLead(create('RI-223', 'urgent'))).toMatchObject({
      crisis: true,
      penaltyIfImprove: 16,
      progress: 2,
    });
  });

  it('専任中は出荷せず、中断の再開は進捗を進めず、担当変更では完成しない', () => {
    const fresh = create('RI-223', 'near');
    expect(apply(fresh, { type: 'swap' })).toBe(fresh);
    expect(assignLead(fresh, 'other')).toBe(fresh);
    const improving = apply(fresh, { type: 'assign', mode: 'improve' });
    expect(summarizeImprovementLead(improving)).toMatchObject({
      shipped: 0,
      improvement: 18,
      periods: 1,
      progress: 4,
      completed: true,
    });
    const again = apply(improving, { type: 'assign', mode: 'improve' });
    expect(again.improvementValue).toBe(18);
    expect(again.shipped).toBe(0);
    expect(again.periodsOnImprovement).toBe(2);

    const urgent = create('RI-223', 'urgent');
    const paused = apply(urgent, { type: 'assign', mode: 'field' });
    expect(paused).toMatchObject({ shipped: 4, progress: 2, restartPending: true, penalty: 0 });
    const restarted = apply(paused, { type: 'assign', mode: 'improve' });
    expect(restarted).toMatchObject({
      progress: 2,
      restartPending: false,
      completed: false,
      shipped: 4,
      periodsOnImprovement: 1,
    });
    expect(apply(restarted, { type: 'view' })).toBe(restarted);
  });

  it('完成間近は継続、現場の危機は中断、改善価値が低い盤面は現場が上回る', () => {
    const rows = compareImprovementLeads(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('near', 'finish'), score('near', 'field'), score('near', 'pause')]).toEqual([
      22, 8, 4,
    ]);
    expect([score('urgent', 'pause'), score('urgent', 'field'), score('urgent', 'finish')]).toEqual(
      [22, 16, 10],
    );
    expect([score('calm', 'field'), score('calm', 'finish'), score('calm', 'pause')]).toEqual([
      16, 10, 4,
    ]);
    const finished = rows.find((row) => row.board === 'urgent' && row.strategy === 'finish')!;
    expect(finished.result).toMatchObject({
      completed: true,
      penalty: 16,
      periods: 2,
      lost: false,
    });
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareImprovementLeads(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseLeadAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeImprovementLead(live)).toEqual(row.result);
    }
  });
});
