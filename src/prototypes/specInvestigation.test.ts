import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/spec-investigation-comparison.json';
import priorComparison from '../../docs/prototypes/spec-investigation-prior-comparison.json';
import {
  actionFromPrior,
  compareInvestigationStrategies,
  comparePriorInformationStrategies,
  createInvestigationPrototype,
  investigationView,
  PRIOR_PROFILES,
  PRIOR_STRATEGIES,
  priorComparisonSeeds,
  replayInvestigation,
  tickInvestigationPrototype,
  type PriorStrategy,
} from './specInvestigation';

describe('RI-156 曖昧な一件の仕様調査', () => {
  it('調査前はリスクを隠し、読む回数で予定や結果を変えない', () => {
    const state = createInvestigationPrototype(comparison.seeds[1]);
    const before = structuredClone(state);
    const view = investigationView(state);
    expect(view.task.risk).toBeNull();
    expect(view.task.avoidedRework).toBeNull();
    for (let i = 0; i < 20; i++) expect(investigationView(state)).toEqual(view);
    expect(state).toEqual(before);
    expect(createInvestigationPrototype(comparison.seeds[1])).toEqual(state);
  });
  it('調査が2tickの容量を譲り、対象情報だけを更新する', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const started = tickInvestigationPrototype(initial, 'investigate');
    expect(started.researchLeft).toBe(1);
    expect(investigationView(started).task.risk).toBeNull();
    const done = tickInvestigationPrototype(started, 'work');
    expect(done.deadline.board.tick).toBe(2);
    expect(done.deadline.board.tasks).toEqual(initial.deadline.board.tasks);
    expect(done.researchTicks).toBe(2);
    expect(investigationView(done).task.risk).toBe(initial.hiddenRisk);
    expect(investigationView(done).otherTask).toEqual(investigationView(initial).otherTask);
    expect(done.deadline.focus).toBe(initial.deadline.focus);
    expect(tickInvestigationPrototype(done, 'investigate')).toBe(done);
  });
  it('低リスクは急ぎ、高リスクは調べる方が出荷価値を得る', () => {
    const results = compareInvestigationStrategies(comparison.seeds);
    expect(results).toEqual(comparison.results);
    expect(results.map((result) => result.risk)).toEqual(['low', 'low', 'high', 'high']);
    expect(results[0].shipped[0].value).toBeGreaterThan(results[1].shipped[0].value);
    expect(results[2].shipped).toEqual([]);
    expect(results[3].shipped[0].value).toBe(5);
    expect(results[0].researchTicks).toBe(0);
    expect(results[1].researchTicks).toBe(2);
  });
  it('調査途中の保存再開・入力再生・表示投影が一致する', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const snapshot = structuredClone(initial);
    let state = tickInvestigationPrototype(initial, 'investigate');
    expect(initial).toEqual(snapshot);
    let restored = JSON.parse(JSON.stringify(state));
    for (const action of ['work', 'work', 'work', 'work', 'work'] as const) {
      investigationView(restored);
      state = tickInvestigationPrototype(state, action);
      restored = tickInvestigationPrototype(restored, action);
    }
    expect(restored).toEqual(state);
    expect(replayInvestigation(comparison.seeds[1], state.history)).toEqual(state);
    expect(tickInvestigationPrototype(state, 'investigate')).toBe(state);
    expect(state.deadline.board.shipped).toHaveLength(1);
  });
  it('着手後の調査と資源不足の介入は予定・時間を変えない', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const limited = { ...initial, deadline: { ...initial.deadline, focus: 0 } };
    expect(tickInvestigationPrototype(limited, 'boost')).toBe(limited);
    const working = tickInvestigationPrototype(initial, 'work');
    expect(working.deadline.board.tasks[0].workLeft).toBe(6);
    expect(tickInvestigationPrototype(working, 'investigate')).toBe(working);
  });
});

describe('RI-156 公開兆候と事前情報だけの方針', () => {
  const report = comparePriorInformationStrategies();

  function summaryOf(strategy: PriorStrategy) {
    const found = report.summary.find((item) => item.strategy === strategy);
    if (!found) throw new Error(strategy);
    return found;
  }

  it('同じ公開兆候でも seed で高低が分かれ、調査前の投影はリスクを隠す', () => {
    expect(new Set(report.seeds).size).toBe(report.seeds.length);
    for (const seed of comparison.seeds) expect(report.seeds).not.toContain(seed);
    for (const profile of PRIOR_PROFILES) {
      const seeds = priorComparisonSeeds().filter((seed) =>
        seed.startsWith(`RI-156-${profile.id}-`),
      );
      const states = seeds.map((seed) => createInvestigationPrototype(seed));
      expect(new Set(states.map((state) => state.hiddenRisk))).toEqual(new Set(['low', 'high']));
      const views = states.map((state) => investigationView(state));
      expect(new Set(views.map((view) => `${view.workArea}:${view.pastCase}`)).size).toBe(1);
      expect(
        views.every((view) => view.task.risk === null && view.task.avoidedRework === null),
      ).toBe(true);
      const sample = states[0];
      const before = structuredClone(sample);
      const view = investigationView(sample);
      expect(view).not.toHaveProperty('hiddenRisk');
      for (let i = 0; i < 20; i++) expect(investigationView(sample)).toEqual(view);
      expect(sample).toEqual(before);
    }
  });

  it('方針は公開兆候だけを見て、同じ兆候の当たり外れで着手を変えない', () => {
    expect(actionFromPrior('always-rush', { workArea: 'unfamiliar', pastCase: 'none' })).toBe(
      'work',
    );
    expect(
      actionFromPrior('always-investigate', { workArea: 'familiar', pastCase: 'matched' }),
    ).toBe('investigate');
    expect(
      actionFromPrior('prior-any-warning', { workArea: 'familiar', pastCase: 'matched' }),
    ).toBe('work');
    expect(
      actionFromPrior('prior-any-warning', { workArea: 'unfamiliar', pastCase: 'matched' }),
    ).toBe('investigate');
    expect(actionFromPrior('prior-any-warning', { workArea: 'familiar', pastCase: 'none' })).toBe(
      'investigate',
    );
    expect(
      actionFromPrior('prior-both-warnings', { workArea: 'unfamiliar', pastCase: 'matched' }),
    ).toBe('work');
    expect(actionFromPrior('prior-both-warnings', { workArea: 'familiar', pastCase: 'none' })).toBe(
      'work',
    );
    expect(
      actionFromPrior('prior-both-warnings', { workArea: 'unfamiliar', pastCase: 'none' }),
    ).toBe('investigate');
    for (const profile of PRIOR_PROFILES) {
      const seeds = priorComparisonSeeds().filter((seed) =>
        seed.startsWith(`RI-156-${profile.id}-`),
      );
      for (const strategy of PRIOR_STRATEGIES) {
        const actions = seeds.map((seed) =>
          actionFromPrior(strategy, investigationView(createInvestigationPrototype(seed))),
        );
        expect(new Set(actions).size).toBe(1);
      }
    }
  });

  it('複数 seed の期待値・判断回数・機会費用を再計算できる', () => {
    expect(report).toEqual(priorComparison);
    expect(report.note).toContain('固定戦略');
    expect(report.note).toContain('人間のプレイ評価はしていない');
    expect(report.conditions.humanPlaytest).toBe(false);
    expect(report.conditions.productionIntegrated).toBe(false);
    expect(report.conditions.weight).toBe('equal-per-seed');
    for (const row of report.results) {
      expect(row.history[0]).toBe(row.openingAction);
      expect(actionFromPrior(row.strategy, row)).toBe(row.openingAction);
      expect(row.focus).toBe(2);
      expect(row.stamina).toBe(10);
      const replayed = replayInvestigation(row.seed, row.history);
      expect(replayed.deadline.board.shipped).toEqual(row.shipped);
      expect(replayed.hiddenRisk).toBe(row.risk);
      expect(replayed.workArea).toBe(row.workArea);
      expect(replayed.pastCase).toBe(row.pastCase);
    }
    for (const profile of PRIOR_PROFILES) {
      const group = report.signalGroups.find((item) => item.id === profile.id);
      if (!group) throw new Error(profile.id);
      expect(group.highRiskCount).toBe(profile.highCount);
      expect(group.lowRiskCount).toBe(profile.count - profile.highCount);
      expect(group.highRiskCount).toBeGreaterThan(0);
      expect(group.lowRiskCount).toBeGreaterThan(0);
    }
    const bothWarnings = summaryOf('prior-both-warnings');
    const anyWarning = summaryOf('prior-any-warning');
    const alwaysRush = summaryOf('always-rush');
    const alwaysInvestigate = summaryOf('always-investigate');
    expect(bothWarnings.meanValue).toBeGreaterThan(alwaysRush.meanValue);
    expect(bothWarnings.meanValue).toBeGreaterThan(alwaysInvestigate.meanValue);
    expect(anyWarning.meanValue).toBe(alwaysRush.meanValue);
    expect(anyWarning.meanValue).toBeGreaterThan(alwaysInvestigate.meanValue);
    expect(bothWarnings.decisionCount).toBe(report.seeds.length);
    expect(anyWarning.decisionCount).toBe(report.seeds.length);
    expect(alwaysRush.decisionCount).toBe(0);
    expect(alwaysInvestigate.decisionCount).toBe(0);
    expect(bothWarnings.opportunityCost).toBeGreaterThan(0);
    expect(bothWarnings.opportunityCost).toBeLessThan(alwaysInvestigate.opportunityCost);
    expect(bothWarnings.lowRiskInvestigated).toBeGreaterThan(0);
    expect(bothWarnings.highRiskRushed).toBeGreaterThan(0);
    const bothGroup = report.signalGroups.find((group) => group.id === 'both');
    if (!bothGroup) throw new Error('both');
    expect(bothGroup.investigationAdvantage).toBeGreaterThan(0);
    for (const group of report.signalGroups) {
      if (group.id !== 'both') expect(group.investigationAdvantage).toBeLessThan(0);
    }
    const investigatedLow = report.results.find(
      (row) => row.seed === 'RI-156-both-3' && row.strategy === 'prior-both-warnings',
    );
    if (!investigatedLow) throw new Error('RI-156-both-3');
    expect(investigatedLow.risk).toBe('low');
    expect(investigatedLow.value).toBe(5);
    expect(investigatedLow.rushValue).toBe(12);
    expect(investigatedLow.opportunityCost).toBe(7);
    const rushedHigh = report.results.find(
      (row) => row.seed === 'RI-156-both-0' && row.strategy === 'always-rush',
    );
    if (!rushedHigh) throw new Error('RI-156-both-0');
    expect(rushedHigh.risk).toBe('high');
    expect(rushedHigh.value).toBe(0);
    expect(rushedHigh.shipped).toEqual([]);
  });
});
