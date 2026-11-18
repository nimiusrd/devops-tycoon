import { describe, expect, it } from 'vitest';
import { quarterNewspaperView } from '../../../src/render/quarterNewspaperView';
import { RunEngine } from '../../../src/sim/run/engine';
import type { GoalKpiProgress, QuarterTrendSnapshot } from '../../../src/sim/run/types';

function snapshot(
  quarterNumber = 2,
  delivery: GoalKpiProgress['status'] = 'met',
  morale: GoalKpiProgress['status'] = 'missed',
): QuarterTrendSnapshot {
  return {
    quarterNumber,
    diagnosis: 'healthyAcceleration',
    kpis: [
      { id: 'delivery', label: 'Delivery', actual: 120, target: 100, status: delivery },
      { id: 'morale', label: 'Morale', actual: 30, target: 40, status: morale },
    ],
    company: {
      shipping: 99999,
      morale: 99,
      aiDependency: 0,
      techDebt: 0,
      onFire: 0,
      healthRank: 'A',
      selfRank: 1,
    },
    departments: [],
  };
}

describe('quarterNewspaperView', () => {
  it.each(['met', 'exceeded', 'missed'] as const)(
    '保存された%sの判定と数値を記事にする',
    (status) => {
      const input = { quarterNumber: 2, trendHistory: [snapshot(2, status, status)] };
      const before = structuredClone(input);
      const view = quarterNewspaperView(input);
      expect(view.articles).toHaveLength(2);
      expect(view.articles.map((article) => article.status)).toEqual([status, status]);
      expect(view.articles[0].basis).toContain('Q2 出荷 — 実績 120 / 目標 100');
      expect(view.articles[1].basis).toContain('Q2 士気 — 実績 30 / 目標 40');
      if (status === 'missed') {
        expect(view.articles.map((article) => article.headline)).toEqual([
          '出荷目標に届かず',
          '士気が目標を下回る',
        ]);
      }
      expect(input).toEqual(before);
    },
  );

  it('出荷達成と士気未達を別々に示し、会社集約や別の期を使わない', () => {
    const view = quarterNewspaperView({
      quarterNumber: 2,
      trendHistory: [snapshot(1, 'missed', 'met'), snapshot(), snapshot(3, 'exceeded', 'met')],
    });
    expect(view.articles.map((article) => article.headline)).toEqual([
      '出荷目標を達成',
      '士気が目標を下回る',
    ]);
    expect(JSON.stringify(view)).not.toMatch(/99999|採用|投資|育成|危機を脱出/);
  });

  it.each([undefined, [], [snapshot(1)], [snapshot(3)]])(
    '当該期の履歴がなければ欠損理由を出す (%j)',
    (trendHistory) => {
      const view = quarterNewspaperView({ quarterNumber: 2, trendHistory });
      expect(
        view.articles.every((article) => article.basis.includes('Q2 の四半期履歴がない')),
      ).toBe(true);
      expect(view.articles.every((article) => article.status === undefined)).toBe(true);
    },
  );

  it('片方または両方のKPI欠損を区別し、実績0・目標0も記録として表示する', () => {
    const entry = snapshot();
    entry.kpis = [{ id: 'delivery', label: '出荷', actual: 0, target: 0, status: 'met' }];
    const view = quarterNewspaperView({ quarterNumber: 2, trendHistory: [entry] });
    expect(view.articles[0].basis).toContain('実績 0 / 目標 0');
    expect(view.articles[1].basis).toContain('保存履歴に士気KPIがない');
    entry.kpis = [];
    expect(
      quarterNewspaperView({ quarterNumber: 2, trendHistory: [entry] }).articles[0].basis,
    ).toContain('保存履歴に出荷KPIがない');
  });

  it('保存再開とリプレイ復元で同じ新聞を保ち、現行の目標・人物・所持品に依存しない', () => {
    const engine = new RunEngine({ seed: 'ri287-newspaper', difficulty: 'easy' });
    engine.startRun();
    const frame = engine.exportPersistState()!;
    frame.quarterNumber = 2;
    frame.trendHistory = [snapshot()];
    const expected = quarterNewspaperView(frame);
    frame.org.morale = 100;
    frame.totals.delivered = 0;
    frame.quarterGoal.deliveryTarget = 99999;
    frame.roster.members = [];
    frame.relics = [];
    const resumed = new RunEngine({ seed: 'other', difficulty: 'hard' });
    resumed.hydratePersistState(JSON.parse(JSON.stringify(frame)));
    const replay = new RunEngine({ seed: 'replay', difficulty: 'normal' });
    replay.hydrateReplayFrame(JSON.parse(JSON.stringify(frame)));
    expect(quarterNewspaperView(resumed.snapshot())).toEqual(expected);
    expect(quarterNewspaperView(replay.snapshot())).toEqual(expected);
  });
});
