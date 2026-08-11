/**
 * src/sim/orgscale/teamState.ts の単体テスト。
 * ミューテーションテストの Survived / 境界 mutation を exact 断言で潰す（旧 RI-91-B1）。
 */
import { describe, expect, it } from 'vitest';
import { TASK_BASE_VALUE } from '../../../src/sim/model/process';
import {
  advanceCoarseTeams,
  coarseShipToCompleted,
  stripMetricAdjustments,
} from '../../../src/sim/orgscale/teamState';
import { emptyAdjust, emptyAdjustState } from '../../../src/sim/orgscale/levers';
import type { OrgAdjust, TeamRunState } from '../../../src/sim/orgscale/types';

const metricHeavy = (overrides: Partial<OrgAdjust> = {}): OrgAdjust => ({
  ...emptyAdjust(),
  aiDependencyDelta: -12,
  reviewQueueDelta: -5,
  incidentDelta: -2,
  moraleDelta: 4,
  techDebtDelta: -3,
  infraBoost: 7,
  extraTeams: 2,
  ...overrides,
});

const makeTeam = (overrides: Partial<TeamRunState> = {}): TeamRunState => ({
  id: 'rival-t0',
  deptId: 'platform',
  name: 'ライバル',
  engineers: 4,
  headcount: 4,
  aiLiteracy: 40,
  aiDependency: 30,
  morale: 50,
  techDebt: 20,
  shipping: 100,
  reviewQueue: 3,
  incidents: 0,
  reviewCapacity: 40,
  incidentBias: 0.05,
  seniorHp: 60,
  aiEnabled: true,
  testCoverage: 40,
  documentation: 30,
  quality: 50,
  ...overrides,
});

describe('RI-91-B1 teamState survived mutants', () => {
  describe('stripMetricAdjustments', () => {
    it('指標差分を落とし infraBoost/extraTeams と byTeam を残す', () => {
      const byTeamAdj = metricHeavy({ infraBoost: 3, extraTeams: 1, moraleDelta: 9 });
      const stripped = stripMetricAdjustments({
        company: metricHeavy(),
        byDept: {
          product: metricHeavy({ infraBoost: 11, extraTeams: 4 }),
          platform: metricHeavy({ infraBoost: 0, extraTeams: 0 }),
        },
        byTeam: {
          'product-t0': byTeamAdj,
          'platform-t0': emptyAdjust(),
        },
      });

      expect(stripped.company).toEqual({
        ...emptyAdjust(),
        infraBoost: 7,
        extraTeams: 2,
      });
      expect(stripped.byDept).toEqual({
        product: { ...emptyAdjust(), infraBoost: 11, extraTeams: 4 },
        platform: { ...emptyAdjust(), infraBoost: 0, extraTeams: 0 },
      });
      // byTeam は焼き込み対象外のため、指標差分ごと保持する（空 ObjectLiteral 置換を殺す）。
      expect(stripped.byTeam).toEqual({
        'product-t0': byTeamAdj,
        'platform-t0': emptyAdjust(),
      });
      expect(Object.keys(stripped.byTeam!)).toEqual(['product-t0', 'platform-t0']);
    });

    it('byTeam が undefined のとき空オブジェクトへ正規化する', () => {
      const input = {
        company: metricHeavy({ infraBoost: 5, extraTeams: 1 }),
        byDept: { product: metricHeavy({ infraBoost: 2, extraTeams: 0 }) },
      };
      const stripped = stripMetricAdjustments(input);
      expect(stripped.byTeam).toEqual({});
      expect(Object.keys(stripped.byTeam!)).toEqual([]);
      expect(stripped.company).toEqual({ ...emptyAdjust(), infraBoost: 5, extraTeams: 1 });
      expect(stripped.byDept.product).toEqual({ ...emptyAdjust(), infraBoost: 2, extraTeams: 0 });
    });

    it('byDept が空でも company / byTeam だけ処理する', () => {
      const base = emptyAdjustState();
      const stripped = stripMetricAdjustments({
        ...base,
        company: metricHeavy({ infraBoost: 9, extraTeams: 3 }),
        byDept: {},
        byTeam: { 'home-t0': metricHeavy({ reviewQueueDelta: -99 }) },
      });
      expect(stripped.byDept).toEqual({});
      expect(stripped.company.infraBoost).toBe(9);
      expect(stripped.company.extraTeams).toBe(3);
      expect(stripped.company.aiDependencyDelta).toBe(0);
      expect(stripped.byTeam?.['home-t0']?.reviewQueueDelta).toBe(-99);
    });
  });

  describe('coarseShipToCompleted', () => {
    it.each([
      { shipGain: -5, expected: 0 },
      { shipGain: 0, expected: 0 },
      { shipGain: 1, expected: 1 },
      { shipGain: 2, expected: 1 },
      { shipGain: 3, expected: 1 },
      { shipGain: 2.5, expected: 1 },
      { shipGain: 4, expected: 1 },
      { shipGain: 7, expected: 1 },
      { shipGain: 7.5, expected: 2 },
      { shipGain: 8, expected: 2 },
      { shipGain: 20, expected: 4 },
    ])('shipGain=$shipGain → $expected（normal=5pt）', ({ shipGain, expected }) => {
      expect(TASK_BASE_VALUE.normal).toBe(5);
      expect(coarseShipToCompleted(shipGain)).toBe(expected);
    });

    it('0 ちょうどは早期 return（<= と < の違いを刺す）', () => {
      expect(coarseShipToCompleted(0)).toBe(0);
      // < 0 に変異すると 0 が max(1, round(0/5))=1 になる。
      expect(coarseShipToCompleted(0)).not.toBe(1);
    });
  });

  describe('advanceCoarseTeams AI delivery mul (RI-77)', () => {
    it('AI 配布推定があるチームは出荷が上がる', () => {
      const lowAi = [makeTeam({ id: 'a', aiDependency: 0, aiLiteracy: 100, engineers: 8 })];
      const highAi = [makeTeam({ id: 'a', aiDependency: 80, aiLiteracy: 100, engineers: 8 })];
      const low = advanceCoarseTeams(lowAi, {
        seed: 'ri77-coarse-del',
        stepKey: 's1',
        excludeId: 'none',
      });
      const high = advanceCoarseTeams(highAi, {
        seed: 'ri77-coarse-del',
        stepKey: 's1',
        excludeId: 'none',
      });
      expect(high.teams[0]!.shipping).toBeGreaterThan(low.teams[0]!.shipping);
    });

    it('完了件数は倍率適用前の基礎出荷から換算し、出荷増分だけ倍率が掛かる', () => {
      const lowAi = [makeTeam({ id: 'a', aiDependency: 0, aiLiteracy: 100, engineers: 8 })];
      const highAi = [makeTeam({ id: 'a', aiDependency: 80, aiLiteracy: 100, engineers: 8 })];
      const low = advanceCoarseTeams(lowAi, {
        seed: 'ri77-coarse-completed',
        stepKey: 's1',
        excludeId: 'none',
      });
      const high = advanceCoarseTeams(highAi, {
        seed: 'ri77-coarse-completed',
        stepKey: 's1',
        excludeId: 'none',
      });
      expect(high.teams[0]!.shipping).toBeGreaterThan(low.teams[0]!.shipping);
      expect(high.completed).toBe(low.completed);
    });
  });

  describe('advanceCoarseTeams boundaries', () => {
    it('engineers<=0 なら出荷増分も completed も 0', () => {
      const teams = [
        makeTeam({ id: 'home', engineers: 3, shipping: 10 }),
        makeTeam({
          id: 'idle',
          engineers: 0,
          headcount: 2,
          shipping: 40,
          aiLiteracy: 0,
          techDebt: 0,
        }),
      ];
      const stepped = advanceCoarseTeams(teams, {
        seed: 'ri91-b1-zero-eng',
        stepKey: 's1',
        excludeId: 'home',
        modifiers: { shipMul: 1 },
      });
      const idle = stepped.teams.find((t) => t.id === 'idle')!;
      expect(idle.shipping).toBe(40);
      expect(stepped.completed).toBe(0);
    });

    it('計算出荷が床未満でも Math.max(4) で出荷が増える', () => {
      // shipMul 下限 0.2・少人数なら生計算は 4 未満になりやすい。
      const teams = [
        makeTeam({ id: 'home', engineers: 1 }),
        makeTeam({
          id: 'tiny',
          engineers: 1,
          headcount: 1,
          aiLiteracy: 0,
          techDebt: 80,
          shipping: 0,
          reviewQueue: 0,
          incidents: 0,
          incidentBias: 0,
          reviewCapacity: 80,
        }),
      ];
      const stepped = advanceCoarseTeams(teams, {
        seed: 'ri91-b1-ship-floor',
        stepKey: 'floor',
        excludeId: 'home',
        modifiers: { shipMul: 0.2 },
      });
      const tiny = stepped.teams.find((t) => t.id === 'tiny')!;
      expect(tiny.shipping).toBe(4);
      expect(stepped.completed).toBe(coarseShipToCompleted(4));
      // min(4, …) に変異すると床が効かず 4 未満になり得る。
      expect(tiny.shipping).toBeGreaterThanOrEqual(4);
    });

    it('reviewQueue 帯で morale 差分が -3 / -1 / +1 になる', () => {
      const seed = 'ri91-b1-m3';
      const stepKey = 'band';
      const excludeId = 'home';
      const base = makeTeam({
        id: 'focus',
        engineers: 1,
        aiDependency: 0,
        incidentBias: 0,
        incidents: 0,
        reviewCapacity: 25,
        morale: 60,
        techDebt: 0,
        aiLiteracy: 0,
      });

      const run = (reviewQueue: number) =>
        advanceCoarseTeams([makeTeam({ id: 'home', engineers: 1 }), { ...base, reviewQueue }], {
          seed,
          stepKey,
          excludeId,
          modifiers: { incidentRateMul: 0.2, reviewMul: 0.5 },
        }).teams.find((t) => t.id === 'focus')!;

      // 事前探査済み: in 10→9(>8), in 9→8(4<q<=8), in 5→4(<=4)
      const high = run(10);
      const mid = run(9);
      const low = run(5);

      expect(high.reviewQueue).toBeGreaterThan(8);
      expect(mid.reviewQueue).toBeGreaterThan(4);
      expect(mid.reviewQueue).toBeLessThanOrEqual(8);
      expect(low.reviewQueue).toBeLessThanOrEqual(4);

      expect(high.morale - mid.morale).toBe(-2); // -3 - (-1)
      expect(mid.morale - low.morale).toBe(-2); // -1 - (+1)
      expect(high.morale - low.morale).toBe(-4); // -3 - (+1)
    });

    it('RI-83: reworkRateAdd 低下は粗粒度の行列圧力を緩める', () => {
      const teams = [
        makeTeam({ id: 'home' }),
        makeTeam({
          id: 'pressured',
          engineers: 8,
          headcount: 8,
          reviewQueue: 10,
          reviewCapacity: 10,
          aiDependency: 40,
        }),
      ];
      const plain = advanceCoarseTeams(teams, {
        seed: 'ri83-coarse-rework',
        stepKey: 'r1',
        excludeId: 'home',
      });
      const improved = advanceCoarseTeams(teams, {
        seed: 'ri83-coarse-rework',
        stepKey: 'r1',
        excludeId: 'home',
        modifiers: { reworkRateAdd: -0.1 },
      });
      const plainQ = plain.teams.find((t) => t.id === 'pressured')!.reviewQueue;
      const improvedQ = improved.teams.find((t) => t.id === 'pressured')!.reviewQueue;
      expect(improvedQ).toBeLessThan(plainQ);
    });

    it('RI-73: seniorHpCostMul が粗粒度のシニア消耗に掛かる', () => {
      const teams = [
        makeTeam({ id: 'home' }),
        makeTeam({
          id: 'pressured',
          engineers: 8,
          headcount: 8,
          reviewQueue: 10,
          seniorHp: 50,
        }),
      ];
      const plain = advanceCoarseTeams(teams, {
        seed: 'ri73-coarse-hp',
        stepKey: 's1',
        excludeId: 'home',
      });
      const eased = advanceCoarseTeams(teams, {
        seed: 'ri73-coarse-hp',
        stepKey: 's1',
        excludeId: 'home',
        modifiers: { seniorHpCostMul: 0.5 },
      });
      const plainHp = plain.teams.find((t) => t.id === 'pressured')!.seniorHp;
      const easedHp = eased.teams.find((t) => t.id === 'pressured')!.seniorHp;
      expect(easedHp).toBeGreaterThan(plainHp);
    });

    it('RI-73 / F-1: 粗粒度でも配置済み人数でシニア消耗が薄まる', () => {
      const teams = [
        makeTeam({ id: 'home' }),
        makeTeam({
          id: 'pressured',
          engineers: 8,
          headcount: 8,
          reviewQueue: 10,
          seniorHp: 50,
        }),
      ];
      const benchHeavy = advanceCoarseTeams(teams, {
        seed: 'ri73-coarse-share',
        stepKey: 's1',
        excludeId: 'home',
        assignedByTeamId: { pressured: 3 },
      });
      const assignedHeavy = advanceCoarseTeams(teams, {
        seed: 'ri73-coarse-share',
        stepKey: 's1',
        excludeId: 'home',
        assignedByTeamId: { pressured: 8 },
      });
      const benchHp = benchHeavy.teams.find((t) => t.id === 'pressured')!.seniorHp;
      const assignedHp = assignedHeavy.teams.find((t) => t.id === 'pressured')!.seniorHp;
      expect(assignedHp).toBeGreaterThan(benchHp);
    });

    it('byTeam 調整は緩和に効き永続指標へ焼き込まない', () => {
      // 行列圧力と炎上バイアスを高め、byTeam 無視時に plain===relieved になる穴を塞ぐ。
      const teams = [
        makeTeam({ id: 'home' }),
        makeTeam({
          id: 'pressured',
          engineers: 8,
          headcount: 8,
          reviewQueue: 10,
          reviewCapacity: 10,
          incidents: 1,
          incidentBias: 0.4,
          aiDependency: 40,
          shipping: 50,
        }),
      ];
      const plain = advanceCoarseTeams(teams, {
        seed: 'ri91-b1-byteam',
        stepKey: 'adj',
        excludeId: 'home',
      });
      const relieved = advanceCoarseTeams(teams, {
        seed: 'ri91-b1-byteam',
        stepKey: 'adj',
        excludeId: 'home',
        adjust: {
          company: emptyAdjust(),
          byDept: {},
          byTeam: {
            pressured: {
              ...emptyAdjust(),
              reviewQueueDelta: -20,
              incidentDelta: -5,
            },
          },
        },
      });
      const plainT = plain.teams.find((t) => t.id === 'pressured')!;
      const relievedT = relieved.teams.find((t) => t.id === 'pressured')!;
      // byTeam を無視すると同値になるため、厳密減少と exact 値で刺す。
      expect(plainT.reviewQueue).toBe(14);
      expect(relievedT.reviewQueue).toBe(10);
      expect(relievedT.reviewQueue).toBeLessThan(plainT.reviewQueue);
      expect(plain.ignited).toBe(1);
      expect(relieved.ignited).toBe(0);
      expect(plainT.incidents).toBe(1);
      expect(relievedT.incidents).toBe(0);
      // 指標差分は永続値へ加算されない。
      expect(relievedT.aiDependency).toBe(plainT.aiDependency);
      expect(relievedT.aiDependency).toBe(40);
    });
  });
});
