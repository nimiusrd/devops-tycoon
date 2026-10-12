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
  it('操作前に、噂の重みと機会の消失を示し、真の需要は出さない', () => {
    const first = create('RI-232', 'confident', 'api');
    expect(create('RI-232', 'confident', 'api')).toEqual(first);
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
      situation: 'confident',
      rumorWeight: 4,
      otherWeight: 1,
      probed: false,
      probedFeature: null,
      reaction: null,
      shipped: false,
      fullReward: 14,
      lateReward: 6,
      probeReward: 2,
      fades: true,
    });
    expect(blank).not.toHaveProperty('demand');
    expect(viewDemandProbe(create('RI-232', 'open', 'screen'))).toMatchObject({
      fades: false,
      lateReward: 14,
      rumorWeight: 1,
      otherWeight: 1,
    });
  });

  it('出荷後は正解でなくても試作品を拒否し、反応は試した候補に従う', () => {
    const open = create('RI-232', 'open', 'screen');
    const wrong = apply(open, { type: 'ship', feature: 'api' });
    expect(wrong.delivered).toBe(false);
    expect(wrong.shipped).toBe(true);
    expect(apply(wrong, { type: 'probe', feature: 'api' })).toBe(wrong);
    const probedScreen = apply(open, { type: 'probe', feature: 'screen' });
    expect(probedScreen.reaction).toBe('yes');
    expect(chooseDemandAction(probedScreen, 'probeThen')).toEqual({
      type: 'ship',
      feature: 'screen',
    });
    const probedMiss = apply(create('RI-232', 'open', 'api'), { type: 'probe', feature: 'screen' });
    expect(probedMiss.reaction).toBe('no');
    expect(chooseDemandAction(probedMiss, 'probeThen')).toEqual({ type: 'ship', feature: 'api' });
    const faded = apply(create('RI-232', 'confident', 'api'), { type: 'probe', feature: 'api' });
    expect(faded.opportunityLoss).toBe(8);
    expect(apply(faded, { type: 'view' })).toBe(faded);
  });

  it('観測できる重みで、確信度が高いときだけ即出荷が試作品を上回る', () => {
    const rows = compareDemandProbes(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const expected = (situation: string, strategy: string) =>
      rows.find((row) => row.situation === situation && row.strategy === strategy)!.expected;
    expect([
      expected('confident', 'shipNow'),
      expected('confident', 'probeThen'),
      expected('confident', 'shipOther'),
    ]).toEqual([62, 40, 38]);
    expect([
      expected('unsure', 'shipNow'),
      expected('unsure', 'shipOther'),
      expected('unsure', 'probeThen'),
    ]).toEqual([20, 20, 16]);
    expect([
      expected('open', 'probeThen'),
      expected('open', 'shipNow'),
      expected('open', 'shipOther'),
    ]).toEqual([32, 28, 28]);
    const missed = rows.find((row) => row.situation === 'unsure' && row.strategy === 'shipNow')!;
    const screen = missed.worlds.find((world) => world.demand === 'screen')!;
    expect(screen.inputs.slice(0, 2)).toEqual([
      { type: 'ship', feature: 'api' },
      { type: 'ship', feature: 'screen' },
    ]);
    expect(screen.result.score).toBe(6);
    const confident = rows.find(
      (row) => row.situation === 'confident' && row.strategy === 'shipNow',
    )!;
    expect(confident.opportunity).toBe(8);
    const unsure = rows.find((row) => row.situation === 'unsure' && row.strategy === 'probeThen')!;
    expect(unsure.opportunity).toBe(16);
    for (const row of rows) {
      for (const world of row.worlds) expect(world.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareDemandProbes(comparison.seed)) {
      for (const world of row.worlds) {
        let live = world.initial;
        let saved = structuredClone(live);
        for (const input of world.inputs) {
          const previous = live;
          const before = structuredClone(live);
          expect(chooseDemandAction(previous, row.strategy)).toEqual(input);
          live = apply(live, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
        }
        expect(summarizeDemandProbe(live)).toEqual(world.result);
      }
    }
  });
});
