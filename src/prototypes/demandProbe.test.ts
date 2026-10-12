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
    const first = create('RI-232', 'fadeHit');
    expect(create('RI-232', 'fadeHit')).toEqual(first);
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
    expect(viewDemandProbe(create('RI-232', 'stayMiss'))).toMatchObject({
      fades: false,
      lateReward: 14,
    });
    expect(viewDemandProbe(create('RI-232', 'fadeMiss')).fades).toBe(true);
    expect(create('RI-232', 'fadeMiss').demand).toBe('screen');
    expect(create('RI-232', 'stayHit').demand).toBe('api');
  });

  it('出荷後の試作品は拒否し、機会の消失は正解の出荷を待たない', () => {
    const fade = create('RI-232', 'fadeHit');
    const shipped = apply(fade, { type: 'ship', feature: 'api' });
    expect(shipped.value).toBe(14);
    expect(shipped.opportunityLoss).toBe(0);
    expect(apply(shipped, { type: 'probe', feature: 'api' })).toBe(shipped);
    const probed = apply(fade, { type: 'probe', feature: 'api' });
    expect(probed.reaction).toBe('yes');
    expect(probed.value).toBe(2);
    expect(probed.delivered).toBe(false);
    expect(probed.opportunityLoss).toBe(8);
    expect(apply(probed, { type: 'probe', feature: 'screen' })).toBe(probed);
    const late = apply(probed, { type: 'ship', feature: 'api' });
    expect(late.value).toBe(8);
    expect(late.opportunityLoss).toBe(8);
    const missed = apply(create('RI-232', 'fadeMiss'), { type: 'ship', feature: 'api' });
    expect(missed.value).toBe(0);
    expect(missed.opportunityLoss).toBe(8);
    const decoy = apply(create('RI-232', 'stayMiss'), { type: 'probe', feature: 'api' });
    expect(decoy.reaction).toBe('no');
    expect(decoy.opportunityLoss).toBe(0);
    expect(apply(decoy, { type: 'view' })).toBe(decoy);
    expect(viewDemandProbe(decoy)).not.toHaveProperty('demand');
  });

  it('消失と需要の組み合わせで、即出荷と試作品の優劣が入れ替わる', () => {
    const rows = compareDemandProbes(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    const loss = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.opportunityLoss;
    expect([
      score('fadeHit', 'shipNow'),
      score('fadeHit', 'probeThen'),
      score('fadeHit', 'shipOther'),
    ]).toEqual([14, 8, 0]);
    expect([
      score('fadeMiss', 'shipOther'),
      score('fadeMiss', 'probeThen'),
      score('fadeMiss', 'shipNow'),
    ]).toEqual([14, 8, 0]);
    expect([
      score('stayHit', 'probeThen'),
      score('stayHit', 'shipNow'),
      score('stayHit', 'shipOther'),
    ]).toEqual([16, 14, 0]);
    expect([
      score('stayMiss', 'probeThen'),
      score('stayMiss', 'shipOther'),
      score('stayMiss', 'shipNow'),
    ]).toEqual([16, 14, 0]);
    expect(loss('fadeHit', 'probeThen')).toBe(8);
    expect(loss('fadeHit', 'shipOther')).toBe(8);
    expect(loss('fadeHit', 'shipNow')).toBe(0);
    expect(loss('fadeMiss', 'shipNow')).toBe(8);
    expect(loss('stayMiss', 'probeThen')).toBe(0);
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
