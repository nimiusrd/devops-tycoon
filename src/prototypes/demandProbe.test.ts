import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyDemandProbe as apply,
  chooseDemandAction,
  compareDemandProbes,
  createDemandProbe as create,
  summarizeDemandProbe,
  viewDemandProbe,
} from './demandProbe';
import comparison from '../../docs/prototypes/demand-probe-comparison.json';

describe('RI-232 試作品で需要確認', () => {
  it('試作品の報酬と、出荷の報酬、機会の縮小を操作前に分ける', () => {
    const first = create('RI-232', 'fade');
    expect(create('RI-232', 'fade')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewDemandProbe(first);
    for (let i = 0; i < 8; i++) expect(viewDemandProbe(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      respondents: 4,
      candidates: ['api', 'screen'],
      rumor: 'api',
      probed: false,
      probedFeature: null,
      reaction: null,
      fullReward: 14,
      lateReward: 6,
      probeReward: 2,
      fades: true,
    });
    expect(blank).not.toHaveProperty('demand');
    expect(viewDemandProbe(create('RI-232', 'decoy')).lateReward).toBe(14);
  });

  it('試作品の反応は一度だけで、完成品の報酬にはならない', () => {
    const fade = create('RI-232', 'fade');
    const probed = apply(fade, { type: 'probe', feature: 'api' });
    expect(probed.reaction).toBe('yes');
    expect(probed.value).toBe(2);
    expect(probed.delivered).toBe(false);
    expect(apply(probed, { type: 'probe', feature: 'screen' })).toBe(probed);
    const late = apply(probed, { type: 'ship', feature: 'api' });
    expect(late.value).toBe(8);
    expect(late.opportunityLoss).toBe(8);
    const again = apply(late, { type: 'ship', feature: 'api' });
    expect(again.value).toBe(8);
    const decoy = apply(create('RI-232', 'decoy'), { type: 'probe', feature: 'api' });
    expect(decoy.reaction).toBe('no');
    expect(decoy.value).toBe(2);
    expect(apply(decoy, { type: 'view' })).toBe(decoy);
    expect(viewDemandProbe(decoy)).not.toHaveProperty('demand');
  });

  it('機会が消える盤面は即出荷、外れ候補の盤面は試作品が上回る', () => {
    const rows = compareDemandProbes(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('fade', 'shipNow'),
      score('fade', 'probeThen'),
      score('fade', 'shipOther'),
    ]).toEqual([14, 8, 0]);
    expect([
      score('decoy', 'probeThen'),
      score('decoy', 'shipOther'),
      score('decoy', 'shipNow'),
    ]).toEqual([16, 14, 0]);
    const faded = rows.find((row) => row.board === 'fade' && row.strategy === 'probeThen')!;
    expect(faded.result.opportunityLoss).toBe(8);
    expect(faded.result.probeValue).toBe(2);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareDemandProbes(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDemandAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeDemandProbe(live)).toEqual(row.result);
    }
  });
});
