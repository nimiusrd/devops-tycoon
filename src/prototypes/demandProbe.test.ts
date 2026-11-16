import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyDemandProbe as apply,
  chooseDemandAction,
  compareDemandFactorReversals,
  compareDemandProbes,
  createDemandProbe as create,
  summarizeDemandProbe,
  viewDemandProbe,
  type ProbeFactorAxis,
  type ProbeSituation,
  type ProbeStrategy,
} from './demandProbe';
import comparison from '../../docs/prototypes/demand-probe-comparison.json';
import factors from '../../docs/prototypes/demand-probe-factor-comparison.json';

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

describe('RI-232 要因の反転', () => {
  const axes = [
    'rumorWeight',
    'otherWeight',
    'probeReward',
    'lateReward',
  ] as const satisfies readonly ProbeFactorAxis[];
  const strategies = [
    'shipNow',
    'probeThen',
    'shipOther',
  ] as const satisfies readonly ProbeStrategy[];
  const situations = ['confident', 'unsure', 'open'] as const satisfies readonly ProbeSituation[];

  it('上書きは基準の観測を書き換えず、渡した欄だけを変える', () => {
    const baseline = create('RI-232', 'confident', 'api');
    const moved = create('RI-232', 'confident', 'api', {
      rumorWeight: 0,
      probeReward: 7,
      lateReward: 12,
    });
    expect(create('RI-232', 'confident', 'api')).toEqual(baseline);
    expect(moved).toMatchObject({
      situation: 'confident',
      rumorWeight: 0,
      otherWeight: 1,
      probeReward: 7,
      lateReward: 12,
      fullReward: 14,
      fades: true,
    });
    expect(baseline).toMatchObject({ rumorWeight: 4, probeReward: 2, lateReward: 6 });
    expect(viewDemandProbe(moved)).not.toHaveProperty('demand');
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareDemandFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-232',
      capacity: 4,
      respondents: 4,
      horizon: 3,
      fullReward: 14,
      rumor: 'api',
      candidates: ['api', 'screen'],
      score: 'rumorWeight * rumorWorld + otherWeight * otherWorld',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baselines).toEqual({
      confident: { fades: true, rumorWeight: 4, otherWeight: 1, probeReward: 2, lateReward: 6 },
      unsure: { fades: true, rumorWeight: 1, otherWeight: 1, probeReward: 2, lateReward: 6 },
      open: { fades: false, rumorWeight: 1, otherWeight: 1, probeReward: 2, lateReward: 6 },
    });

    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        const baseline = data.conditions.baselines[series.anchor];
        expect(series.axis).toBe(axis);
        expect(series.held.fades).toBe(baseline.fades);
        expect(series.rows.length).toBeGreaterThan(1);
        for (const row of series.rows) {
          expect(row.axis).toBe(axis);
          expect(row.worlds.shipNow[0].initial.fades).toBe(series.held.fades);
          const changed = axes.filter((field) => row.rules[field] !== baseline[field]);
          if (row.parameter === String(baseline[axis])) expect(changed).toEqual([]);
          else expect(changed).toEqual([axis]);
          expect(row.margin).toBe(row.scores.probeThen - row.scores.shipNow);
          expect(row.preference).toBe(
            row.scores.probeThen > row.scores.shipNow
              ? 'probeThen'
              : row.scores.shipNow > row.scores.probeThen
                ? 'shipNow'
                : 'tie',
          );
          const { rumorWeight, otherWeight, probeReward, lateReward } = row.rules;
          const full = data.conditions.fullReward;
          const fades = series.held.fades;
          const rumorHit = full;
          const rumorMiss = fades ? lateReward : full;
          const probeScore = fades ? probeReward + lateReward : full + probeReward;
          expect(row.scores.shipNow).toBe(rumorWeight * rumorHit + otherWeight * rumorMiss);
          expect(row.scores.probeThen).toBe((rumorWeight + otherWeight) * probeScore);
          expect(row.scores.shipOther).toBe(rumorWeight * rumorMiss + otherWeight * rumorHit);
          expect(row.margin).toBe(
            fades
              ? rumorWeight * (probeReward + lateReward - full) + otherWeight * probeReward
              : (rumorWeight + otherWeight) * probeReward,
          );
          const loss = fades ? full - lateReward : 0;
          expect(row.opportunity.shipNow).toBe(otherWeight * loss);
          expect(row.opportunity.probeThen).toBe((rumorWeight + otherWeight) * loss);
          expect(row.opportunity.shipOther).toBe(rumorWeight * loss);
          for (const strategy of strategies) {
            const [rumorWorld, otherWorld] = row.worlds[strategy];
            expect(rumorWorld.demand).toBe('api');
            expect(otherWorld.demand).toBe('screen');
            expect(rumorWorld.inputs).toEqual(data.conditions.inputs[strategy].api);
            expect(otherWorld.inputs).toEqual(data.conditions.inputs[strategy].screen);
            expect(rumorWorld.result.lost).toBe(false);
            expect(otherWorld.result.lost).toBe(false);
            expect(rumorWorld.result.score).toBe(
              strategy === 'probeThen' ? probeScore : strategy === 'shipNow' ? rumorHit : rumorMiss,
            );
            expect(otherWorld.result.score).toBe(
              strategy === 'probeThen' ? probeScore : strategy === 'shipNow' ? rumorMiss : rumorHit,
            );
          }
        }
      }
    }

    for (const situation of situations) {
      for (const strategy of strategies) {
        const first = comparison.results.find(
          (row) => row.situation === situation && row.strategy === strategy,
        );
        expect(first).toBeDefined();
        const matched = axes.flatMap((axis) =>
          data.sweeps[axis].flatMap((series) =>
            series.rows.filter((row) => {
              const baseline = data.conditions.baselines[situation];
              return (
                row.rules.rumorWeight === baseline.rumorWeight &&
                row.rules.otherWeight === baseline.otherWeight &&
                row.rules.probeReward === baseline.probeReward &&
                row.rules.lateReward === baseline.lateReward &&
                row.worlds.shipNow[0].initial.fades === baseline.fades
              );
            }),
          ),
        );
        expect(matched.length).toBeGreaterThan(0);
        for (const row of matched) {
          expect(row.situation).toBe(situation);
          expect(row.worlds[strategy].map((world) => world.initial)).toEqual(
            first!.worlds.map((world) => world.initial),
          );
          expect(row.worlds[strategy].map((world) => world.inputs)).toEqual(
            first!.worlds.map((world) => world.inputs),
          );
          expect(row.worlds[strategy].map((world) => world.result)).toEqual(
            first!.worlds.map((world) => world.result),
          );
          expect(row.scores[strategy]).toBe(first!.expected);
          expect(row.opportunity[strategy]).toBe(first!.opportunity);
        }
      }
    }
  });

  it('即出荷と試作品の優劣が反転する位置は重み、試作品報酬、遅延報酬に分かれる', () => {
    const data = compareDemandFactorReversals();
    const line = (axis: ProbeFactorAxis, anchor: ProbeSituation) => {
      const series = data.sweeps[axis].find((item) => item.anchor === anchor);
      expect(series).toBeDefined();
      return series!.rows.map((row) => [
        row.parameter,
        row.scores.shipNow,
        row.scores.probeThen,
        row.scores.shipOther,
        row.preference,
        row.leaders,
      ]);
    };
    expect(line('rumorWeight', 'confident')).toEqual([
      ['0', 6, 8, 14, 'probeThen', ['shipOther']],
      ['1', 20, 16, 20, 'shipNow', ['shipNow', 'shipOther']],
      ['4', 62, 40, 38, 'shipNow', ['shipNow']],
    ]);
    expect(line('rumorWeight', 'open')).toEqual([
      ['1', 28, 32, 28, 'probeThen', ['probeThen']],
      ['4', 70, 80, 70, 'probeThen', ['probeThen']],
    ]);
    expect(line('otherWeight', 'confident')).toEqual([
      ['1', 62, 40, 38, 'shipNow', ['shipNow']],
      ['4', 80, 64, 80, 'shipNow', ['shipNow', 'shipOther']],
      ['11', 122, 120, 178, 'shipNow', ['shipOther']],
      ['12', 128, 128, 192, 'tie', ['shipOther']],
      ['13', 134, 136, 206, 'probeThen', ['shipOther']],
    ]);
    expect(line('otherWeight', 'unsure')).toEqual([
      ['1', 20, 16, 20, 'shipNow', ['shipNow', 'shipOther']],
      ['2', 26, 24, 34, 'shipNow', ['shipOther']],
      ['3', 32, 32, 48, 'tie', ['shipOther']],
      ['4', 38, 40, 62, 'probeThen', ['shipOther']],
    ]);
    expect(line('probeReward', 'confident')).toEqual([
      ['2', 62, 40, 38, 'shipNow', ['shipNow']],
      ['6', 62, 60, 38, 'shipNow', ['shipNow']],
      ['7', 62, 65, 38, 'probeThen', ['probeThen']],
    ]);
    expect(line('probeReward', 'unsure')).toEqual([
      ['2', 20, 16, 20, 'shipNow', ['shipNow', 'shipOther']],
      ['3', 20, 18, 20, 'shipNow', ['shipNow', 'shipOther']],
      ['4', 20, 20, 20, 'tie', ['shipNow', 'probeThen', 'shipOther']],
      ['5', 20, 22, 20, 'probeThen', ['probeThen']],
    ]);
    expect(line('probeReward', 'open')).toEqual([
      ['0', 28, 28, 28, 'tie', ['shipNow', 'probeThen', 'shipOther']],
      ['1', 28, 30, 28, 'probeThen', ['probeThen']],
      ['2', 28, 32, 28, 'probeThen', ['probeThen']],
    ]);
    expect(line('lateReward', 'confident')).toEqual([
      ['6', 62, 40, 38, 'shipNow', ['shipNow']],
      ['11', 67, 65, 58, 'shipNow', ['shipNow']],
      ['12', 68, 70, 62, 'probeThen', ['probeThen']],
    ]);
    expect(line('lateReward', 'unsure')).toEqual([
      ['6', 20, 16, 20, 'shipNow', ['shipNow', 'shipOther']],
      ['9', 23, 22, 23, 'shipNow', ['shipNow', 'shipOther']],
      ['10', 24, 24, 24, 'tie', ['shipNow', 'probeThen', 'shipOther']],
      ['11', 25, 26, 25, 'probeThen', ['probeThen']],
    ]);
    expect(line('lateReward', 'open')).toEqual([
      ['0', 28, 32, 28, 'probeThen', ['probeThen']],
      ['6', 28, 32, 28, 'probeThen', ['probeThen']],
      ['14', 28, 32, 28, 'probeThen', ['probeThen']],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.held,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      [
        'rumorWeight',
        { fades: true, otherWeight: 1, probeReward: 2, lateReward: 6 },
        '0',
        'probeThen',
        '1',
        'shipNow',
      ],
      [
        'otherWeight',
        { fades: true, rumorWeight: 4, probeReward: 2, lateReward: 6 },
        '11',
        'shipNow',
        '12',
        'tie',
      ],
      [
        'otherWeight',
        { fades: true, rumorWeight: 4, probeReward: 2, lateReward: 6 },
        '12',
        'tie',
        '13',
        'probeThen',
      ],
      [
        'otherWeight',
        { fades: true, rumorWeight: 1, probeReward: 2, lateReward: 6 },
        '2',
        'shipNow',
        '3',
        'tie',
      ],
      [
        'otherWeight',
        { fades: true, rumorWeight: 1, probeReward: 2, lateReward: 6 },
        '3',
        'tie',
        '4',
        'probeThen',
      ],
      [
        'probeReward',
        { fades: true, rumorWeight: 4, otherWeight: 1, lateReward: 6 },
        '6',
        'shipNow',
        '7',
        'probeThen',
      ],
      [
        'probeReward',
        { fades: true, rumorWeight: 1, otherWeight: 1, lateReward: 6 },
        '3',
        'shipNow',
        '4',
        'tie',
      ],
      [
        'probeReward',
        { fades: true, rumorWeight: 1, otherWeight: 1, lateReward: 6 },
        '4',
        'tie',
        '5',
        'probeThen',
      ],
      [
        'probeReward',
        { fades: false, rumorWeight: 1, otherWeight: 1, lateReward: 6 },
        '0',
        'tie',
        '1',
        'probeThen',
      ],
      [
        'lateReward',
        { fades: true, rumorWeight: 4, otherWeight: 1, probeReward: 2 },
        '11',
        'shipNow',
        '12',
        'probeThen',
      ],
      [
        'lateReward',
        { fades: true, rumorWeight: 1, otherWeight: 1, probeReward: 2 },
        '9',
        'shipNow',
        '10',
        'tie',
      ],
      [
        'lateReward',
        { fades: true, rumorWeight: 1, otherWeight: 1, probeReward: 2 },
        '10',
        'tie',
        '11',
        'probeThen',
      ],
    ]);
    expect(data.sweeps.rumorWeight.find((series) => series.anchor === 'open')!.reversals).toEqual(
      [],
    );
    expect(data.sweeps.lateReward.find((series) => series.anchor === 'open')!.reversals).toEqual(
      [],
    );
  });

  it('入力列は係数で変わらず、保存再開と再生が一致する', () => {
    const data = compareDemandFactorReversals();
    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        for (const row of series.rows) {
          for (const strategy of strategies) {
            for (const world of row.worlds[strategy]) {
              expect(create(data.conditions.seed, row.situation, world.demand, row.rules)).toEqual(
                world.initial,
              );
              let live = world.initial;
              let saved = structuredClone(live);
              for (const input of world.inputs) {
                const previous = live;
                const before = structuredClone(live);
                expect(chooseDemandAction(previous, strategy)).toEqual(input);
                live = apply(live, input);
                saved = apply(JSON.parse(JSON.stringify(saved)), input);
                expect(previous).toEqual(before);
                expect(saved).toEqual(live);
              }
              expect(summarizeDemandProbe(live)).toEqual(world.result);
              expect(live.tick).toBe(world.initial.horizon);
            }
          }
        }
      }
    }
  });
});
