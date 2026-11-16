import { describe, expect, it } from 'vitest';
import {
  applyCustomerSegments as apply,
  baselineCustomerCoefficients,
  chooseCustomerAction,
  compareCustomerSegmentFactorReversals,
  compareCustomerSegments,
  createCustomerFactorState,
  createCustomerSegments as create,
  rosterHeadcount,
  summarizeCustomerSegments,
  viewCustomerSegments,
  type CustomerFactorPatch,
  type CustomerStrategy,
} from './customerSegments';
import comparison from '../../docs/prototypes/customer-segments-comparison.json';
import factors from '../../docs/prototypes/customer-segments-factor-comparison.json';

describe('RI-229 顧客層', () => {
  it('新機能層と安定層の求める成果と、許容できない失敗を操作前に示す', () => {
    const first = create('RI-229', 'pioneer');
    expect(create('RI-229', 'pioneer')).toEqual(first);
    expect(rosterHeadcount('pioneer')).toBe(rosterHeadcount('keeper'));
    const before = structuredClone(first);
    const blank = viewCustomerSegments(first);
    for (let i = 0; i < 8; i++) expect(viewCustomerSegments(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      tick: 0,
      mix: 'pioneer',
      pioneers: 3,
      keepers: 1,
      pioneerWants: 'feature-completion',
      pioneerRejects: 'no-feature-work',
      keeperWants: 'ops-cover',
      keeperRejects: 'incident',
      pioneerPerFeature: 10,
      pioneerIfNoFeature: -3,
      keeperPerSafe: 2,
      keeperPerIncident: -4,
    });
    expect(blank.product.ready).toEqual([]);
    expect(viewCustomerSegments(create('RI-229', 'keeper'))).toMatchObject({
      pioneers: 1,
      keepers: 3,
    });
  });

  it('未完了の進捗は新機能層を満足させず、機能を置かない期間だけ失敗になる', () => {
    const fresh = create('RI-229', 'pioneer');
    expect(apply(fresh, { type: 'spend', spend: { api: 3, screen: 0, billing: 0, ops: 0 } })).toBe(
      fresh,
    );
    const partial = apply(fresh, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(partial.pioneerScore).toBe(0);
    expect(partial.keeperScore).toBe(-4);
    const idle = apply(fresh, { type: 'spend', spend: { api: 0, screen: 0, billing: 0, ops: 4 } });
    expect(idle.pioneerScore).toBe(-9);
    expect(idle.keeperScore).toBe(2);
    expect(idle.product.features.every((feature) => !feature.complete)).toBe(true);
    const done = apply(partial, {
      type: 'spend',
      spend: { api: 1, screen: 0, billing: 0, ops: 3 },
    });
    expect(done.pioneerScore).toBe(30);
    const repeated = apply(done, {
      type: 'spend',
      spend: { api: 3, screen: 1, billing: 0, ops: 0 },
    });
    expect(repeated.pioneerScore).toBe(30);
    expect(repeated.product.completedValue).toBe(8);
    const wasted = apply(done, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(wasted.pioneerScore).toBe(30);
    expect(wasted.product.shippedWork).toBe(done.product.shippedWork);
    expect(apply(repeated, { type: 'view' })).toBe(repeated);
  });

  it('同じ出荷でも新機能層は集中、安定層は運用枠が上回る', () => {
    const rows = compareCustomerSegments(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (mix: string, strategy: string) =>
      rows.find((row) => row.mix === mix && row.strategy === strategy)!.result.score;
    expect([
      score('pioneer', 'focus'),
      score('pioneer', 'ops'),
      score('pioneer', 'spread'),
    ]).toEqual([48, 36, 18]);
    expect([score('keeper', 'ops'), score('keeper', 'focus'), score('keeper', 'spread')]).toEqual([
      28, -16, -26,
    ]);
    const pioneer = rows.find((row) => row.mix === 'pioneer' && row.strategy === 'focus')!;
    const keeper = rows.find((row) => row.mix === 'keeper' && row.strategy === 'focus')!;
    expect(pioneer.inputs).toEqual(keeper.inputs);
    expect(pioneer.result.shippedWork).toBe(keeper.result.shippedWork);
    expect(pioneer.result.completed).toEqual(keeper.result.completed);
    expect(pioneer.result.score).not.toBe(keeper.result.score);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomerSegments(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseCustomerAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomerSegments(live)).toEqual(row.result);
    }
  });
});

function play(patch: CustomerFactorPatch, strategy: CustomerStrategy) {
  let state = createCustomerFactorState(comparison.seed, patch);
  let guard = 0;
  while (state.product.tick < state.product.horizon) {
    if (++guard > 10) throw new Error(`${strategy}@${state.product.tick}`);
    state = apply(state, chooseCustomerAction(state, strategy));
  }
  return summarizeCustomerSegments(state).score;
}

describe('RI-229 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCustomerSegmentFactorReversals(comparison.seed);
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-229',
      board: 'blocked',
      horizon: 3,
      capacity: 4,
      featureNeed: 5,
      incidentIfIdle: 6,
      totalHeadcount: 4,
      pioneerIfNoFeature: -3,
      keeperPerSafe: 2,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(rosterHeadcount('pioneer')).toBe(data.conditions.totalHeadcount);
    expect(rosterHeadcount('keeper')).toBe(data.conditions.totalHeadcount);
    const first = compareCustomerSegments(comparison.seed);
    const recorded = (mix: string, strategy: CustomerStrategy) =>
      first.find((row) => row.mix === mix && row.strategy === strategy)!;
    expect(data.conditions.inputs.focus).toEqual(recorded('pioneer', 'focus').inputs);
    expect(data.conditions.inputs.spread).toEqual(recorded('pioneer', 'spread').inputs);
    expect(data.conditions.inputs.ops).toEqual(recorded('pioneer', 'ops').inputs);
    expect(recorded('keeper', 'focus').inputs).toEqual(recorded('pioneer', 'focus').inputs);
    const baselines = [
      data.sweeps.featurePoints.find((point) => point.parameter === '10'),
      data.sweeps.incidentDissatisfaction.find((point) => point.parameter === '-4'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.rosters[0]?.focus).toEqual(recorded('pioneer', 'focus').result);
      expect(point.rosters[0]?.spread).toEqual(recorded('pioneer', 'spread').result);
      expect(point.rosters[0]?.ops).toEqual(recorded('pioneer', 'ops').result);
      expect(point.rosters[1]?.focus).toEqual(recorded('keeper', 'focus').result);
      expect(point.rosters[1]?.spread).toEqual(recorded('keeper', 'spread').result);
      expect(point.rosters[1]?.ops).toEqual(recorded('keeper', 'ops').result);
    }
    const ratio31 = data.sweeps.headcountRatio.find((point) => point.parameter === '3:1');
    const ratio13 = data.sweeps.headcountRatio.find((point) => point.parameter === '1:3');
    expect(ratio31?.rosters[0]?.focus).toEqual(recorded('pioneer', 'focus').result);
    expect(ratio13?.rosters[0]?.ops).toEqual(recorded('keeper', 'ops').result);

    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point) => [
        point.parameter,
        point.rosters.map((roster) => [
          roster.pioneers,
          roster.keepers,
          roster.focus.score,
          roster.spread.score,
          roster.ops.score,
          roster.preference,
        ]),
      ]);
    expect(nets('featurePoints')).toEqual([
      [
        '0',
        [
          [3, 1, -12, -12, 6, 'ops'],
          [1, 3, -36, -36, 18, 'ops'],
        ],
      ],
      [
        '5',
        [
          [3, 1, 18, 3, 21, 'ops'],
          [1, 3, -26, -31, 23, 'ops'],
        ],
      ],
      [
        '6',
        [
          [3, 1, 24, 6, 24, 'tie'],
          [1, 3, -24, -30, 24, 'ops'],
        ],
      ],
      [
        '7',
        [
          [3, 1, 30, 9, 27, 'focus'],
          [1, 3, -22, -29, 25, 'ops'],
        ],
      ],
      [
        '10',
        [
          [3, 1, 48, 18, 36, 'focus'],
          [1, 3, -16, -26, 28, 'ops'],
        ],
      ],
      [
        '53',
        [
          [3, 1, 306, 147, 165, 'focus'],
          [1, 3, 70, 17, 71, 'ops'],
        ],
      ],
      [
        '54',
        [
          [3, 1, 312, 150, 168, 'focus'],
          [1, 3, 72, 18, 72, 'tie'],
        ],
      ],
      [
        '55',
        [
          [3, 1, 318, 153, 171, 'focus'],
          [1, 3, 74, 19, 73, 'focus'],
        ],
      ],
    ]);
    expect(nets('incidentDissatisfaction')).toEqual([
      [
        '-9',
        [
          [3, 1, 33, 3, 36, 'ops'],
          [1, 3, -61, -71, 28, 'ops'],
        ],
      ],
      [
        '-8',
        [
          [3, 1, 36, 6, 36, 'tie'],
          [1, 3, -52, -62, 28, 'ops'],
        ],
      ],
      [
        '-7',
        [
          [3, 1, 39, 9, 36, 'focus'],
          [1, 3, -43, -53, 28, 'ops'],
        ],
      ],
      [
        '-4',
        [
          [3, 1, 48, 18, 36, 'focus'],
          [1, 3, -16, -26, 28, 'ops'],
        ],
      ],
      [
        '0',
        [
          [3, 1, 60, 30, 36, 'focus'],
          [1, 3, 20, 10, 28, 'ops'],
        ],
      ],
    ]);
    expect(nets('headcountRatio')).toEqual([
      ['4:0', [[4, 0, 80, 40, 40, 'focus']]],
      ['3:1', [[3, 1, 48, 18, 36, 'focus']]],
      ['2:2', [[2, 2, 16, -4, 32, 'ops']]],
      ['1:3', [[1, 3, -16, -26, 28, 'ops']]],
      ['0:4', [[0, 4, -48, -48, 24, 'ops']]],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.before.parameter,
        item.before.pioneers,
        item.before.preference,
        item.after.parameter,
        item.after.pioneers,
        item.after.preference,
      ]),
    ).toEqual([
      ['featurePoints', '5', 3, 'ops', '6', 3, 'tie'],
      ['featurePoints', '6', 3, 'tie', '7', 3, 'focus'],
      ['featurePoints', '53', 1, 'ops', '54', 1, 'tie'],
      ['featurePoints', '54', 1, 'tie', '55', 1, 'focus'],
      ['incidentDissatisfaction', '-9', 3, 'ops', '-8', 3, 'tie'],
      ['incidentDissatisfaction', '-8', 3, 'tie', '-7', 3, 'focus'],
      ['headcountRatio', '3:1', 3, 'focus', '2:2', 2, 'ops'],
    ]);
    expect(
      data.reversals.some(
        (item) => item.axis === 'incidentDissatisfaction' && item.before.keepers === 3,
      ),
    ).toBe(false);
    expect(
      data.sweeps.headcountRatio.every((point) => point.rosters[0]?.preference !== 'tie'),
    ).toBe(true);

    for (const point of data.sweeps.featurePoints) {
      expect(point.keeperPerIncident).toBe(baselineCustomerCoefficients.keeperPerIncident);
      expect(point.pioneerPerFeature).toBe(Number(point.parameter));
      expect(point.rosters.map((roster) => [roster.pioneers, roster.keepers])).toEqual([
        [3, 1],
        [1, 3],
      ]);
    }
    for (const point of data.sweeps.incidentDissatisfaction) {
      expect(point.pioneerPerFeature).toBe(baselineCustomerCoefficients.pioneerPerFeature);
      expect(point.keeperPerIncident).toBe(Number(point.parameter));
      expect(point.keeperPerIncident).toBeLessThanOrEqual(0);
    }
    for (const point of data.sweeps.headcountRatio) {
      expect(point.pioneerPerFeature).toBe(10);
      expect(point.keeperPerIncident).toBe(-4);
      const roster = point.rosters[0];
      if (!roster) throw new Error(point.parameter);
      expect(roster.pioneers + roster.keepers).toBe(4);
      expect(point.parameter).toBe(`${roster.pioneers}:${roster.keepers}`);
    }
    for (const point of Object.values(data.sweeps).flat()) {
      for (const roster of point.rosters) {
        expect(roster.focus).toMatchObject({
          shippedWork: 12,
          completed: ['api', 'screen'],
          incident: 18,
          lost: false,
        });
        expect(roster.spread).toMatchObject({
          shippedWork: 12,
          completed: ['api'],
          incident: 18,
          lost: false,
        });
        expect(roster.ops).toMatchObject({
          shippedWork: 9,
          completed: ['api'],
          incident: 0,
          lost: false,
        });
        expect(roster.spread.score).toBeLessThanOrEqual(
          Math.max(roster.focus.score, roster.ops.score),
        );
        expect(roster.margin).toBe(roster.focus.score - roster.ops.score);
      }
    }
    const at3 = data.sweeps.headcountRatio.find((point) => point.parameter === '3:1')?.rosters[0];
    const at2 = data.sweeps.headcountRatio.find((point) => point.parameter === '2:2')?.rosters[0];
    if (!at3 || !at2) throw new Error('ratio');
    expect(at3.margin).toBe(12);
    expect(at2.margin).toBe(-16);
    const drop = at3.margin - at2.margin;
    expect(drop).toBe(28);
    const pioneerNumer = 3 * drop - at3.margin;
    const keeperNumer = 4 * drop - pioneerNumer;
    expect(pioneerNumer / drop).toBe(18 / 7);
    expect(keeperNumer / drop).toBe(10 / 7);
    expect(pioneerNumer / keeperNumer).toBe(18 / 10);
  });

  it('記録した点のあいだでも、隙間で優劣は戻らない', () => {
    const label = (focus: number, ops: number) =>
      focus > ops ? 'focus' : ops > focus ? 'ops' : 'tie';
    let heavyMargin: number | null = null;
    let lightMargin: number | null = null;
    for (let points = 0; points <= 55; points += 1) {
      const heavy = { pioneers: 3, keepers: 1, pioneerPerFeature: points, keeperPerIncident: -4 };
      const light = { pioneers: 1, keepers: 3, pioneerPerFeature: points, keeperPerIncident: -4 };
      const heavyFocus = play(heavy, 'focus');
      const heavyOps = play(heavy, 'ops');
      const lightFocus = play(light, 'focus');
      const lightOps = play(light, 'ops');
      expect(label(heavyFocus, heavyOps)).toBe(points < 6 ? 'ops' : points === 6 ? 'tie' : 'focus');
      expect(label(lightFocus, lightOps)).toBe(
        points < 54 ? 'ops' : points === 54 ? 'tie' : 'focus',
      );
      const nextHeavy = heavyFocus - heavyOps;
      const nextLight = lightFocus - lightOps;
      if (heavyMargin !== null) expect(nextHeavy - heavyMargin).toBe(3);
      if (lightMargin !== null) expect(nextLight - lightMargin).toBe(1);
      heavyMargin = nextHeavy;
      lightMargin = nextLight;
    }
    let heavyIncident: number | null = null;
    let lightIncident: number | null = null;
    for (let incident = -12; incident <= 0; incident += 1) {
      const heavy = { pioneers: 3, keepers: 1, pioneerPerFeature: 10, keeperPerIncident: incident };
      const light = { pioneers: 1, keepers: 3, pioneerPerFeature: 10, keeperPerIncident: incident };
      const heavyFocus = play(heavy, 'focus');
      const heavyOps = play(heavy, 'ops');
      const lightFocus = play(light, 'focus');
      const lightOps = play(light, 'ops');
      expect(label(heavyFocus, heavyOps)).toBe(
        incident < -8 ? 'ops' : incident === -8 ? 'tie' : 'focus',
      );
      expect(label(lightFocus, lightOps)).toBe('ops');
      const nextHeavy = heavyFocus - heavyOps;
      const nextLight = lightFocus - lightOps;
      if (heavyIncident !== null) expect(nextHeavy - heavyIncident).toBe(3);
      if (lightIncident !== null) expect(nextLight - lightIncident).toBe(9);
      heavyIncident = nextHeavy;
      lightIncident = nextLight;
    }
  });

  it('感度の閲覧は基準の未投入と無事故を書き換えず、再生が一致する', () => {
    const data = compareCustomerSegmentFactorReversals(comparison.seed);
    const tuned = createCustomerFactorState(comparison.seed, {
      pioneers: 3,
      keepers: 1,
      pioneerPerFeature: 6,
      keeperPerIncident: -8,
    });
    const before = structuredClone(tuned);
    expect(viewCustomerSegments(tuned)).toMatchObject({
      pioneers: 3,
      keepers: 1,
      pioneerPerFeature: 6,
      pioneerIfNoFeature: baselineCustomerCoefficients.pioneerIfNoFeature,
      keeperPerSafe: baselineCustomerCoefficients.keeperPerSafe,
      keeperPerIncident: -8,
    });
    expect(tuned).toEqual(before);
    const strategies = ['focus', 'spread', 'ops'] as const;
    for (const point of Object.values(data.sweeps).flat()) {
      for (const roster of point.rosters) {
        for (const strategy of strategies) {
          let live = createCustomerFactorState(comparison.seed, {
            pioneers: roster.pioneers,
            keepers: roster.keepers,
            pioneerPerFeature: point.pioneerPerFeature,
            keeperPerIncident: point.keeperPerIncident,
          });
          let saved = structuredClone(live);
          for (const input of data.conditions.inputs[strategy]) {
            const previous = live;
            const untouched = structuredClone(live);
            expect(chooseCustomerAction(previous, strategy)).toEqual(input);
            live = apply(live, input);
            saved = apply(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(untouched);
            expect(saved).toEqual(live);
          }
          expect(summarizeCustomerSegments(live)).toEqual(roster[strategy]);
          expect(live.pioneerIfNoFeature).toBe(baselineCustomerCoefficients.pioneerIfNoFeature);
          expect(live.keeperPerSafe).toBe(baselineCustomerCoefficients.keeperPerSafe);
          expect(live.product.capacity).toBe(4);
          expect(live.product.horizon).toBe(3);
          expect(live.product.board).toBe('blocked');
        }
      }
    }
  });
});
