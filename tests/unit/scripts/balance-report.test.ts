import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BalanceReportError,
  compareMeasurements,
  loadMeasurement,
  parseArgs,
  renderMarkdown,
  summarizeRuns,
} from '../../../scripts/balance-report.mjs';
import { mean, quantile, summarizeNumeric } from '../../../scripts/playtest-statistics.mjs';

const TEMP_DIRS: string[] = [];

const cohort = {
  difficulties: ['easy'],
  policies: ['naive'],
  seeds: ['s-1', 's-2', 's-3'],
  meta: 'fresh',
  counterfactual: false,
  counterfactualPolicies: [],
  isDefault: false,
};

function ruleset(parameterValue: number, sequence: string[] = ['a', 'b']) {
  return {
    version: parameterValue === 1 ? 1 : 2,
    fingerprint: (parameterValue === 1 ? 'a' : 'b').repeat(64),
    fingerprintScheme: 1,
    registry: {
      values: [{ id: 'balance.test', value: parameterValue }],
      sequences: { 'balance.test.distribution': sequence },
    },
    parameters: [{ id: 'balance.test', value: parameterValue, unit: 'ratio', tags: ['test'] }],
    catalog: { cards: [{ id: 'card.test', order: 0, execution: { value: 'fixed' } }] },
    catalogFingerprint: 'c'.repeat(64),
  };
}

function run(seed: string, status: 'won' | 'lost', values: Record<string, number>) {
  return {
    meta: 'fresh',
    difficulty: 'easy',
    policy: 'naive',
    seed,
    status,
    totals: {
      delivered: values.delivery,
      incidents: values.incident,
      rework: values.rework,
    },
  };
}

function payload({
  runs,
  currentCohort = cohort,
  currentRuleset = ruleset(1),
  partial = false,
}: {
  runs: ReturnType<typeof run>[];
  currentCohort?: typeof cohort;
  currentRuleset?: ReturnType<typeof ruleset>;
  partial?: boolean;
}) {
  return {
    generatedAt: '2026-08-21T00:00:00.000Z',
    generation: 'generation-test',
    ...(partial ? { partial: true } : {}),
    cohort: currentCohort,
    ruleset: currentRuleset,
    runs,
  };
}

function writePayload(value: unknown, name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'balance-report-test-'));
  TEMP_DIRS.push(directory);
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

async function measurement(value: unknown, label = 'fixture') {
  return loadMeasurement(writePayload(value, `${label}.json`), label);
}

afterEach(() => {
  for (const directory of TEMP_DIRS.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('playtest-statistics', () => {
  it('既存レポートと同じ分位点位置で要約する', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(summarizeNumeric([])).toEqual({ n: 0, mean: null, p10: null, p50: null, p90: null });
    expect(summarizeNumeric([1, 2, 3])).toEqual({
      n: 3,
      mean: 2,
      p10: 1,
      p50: 2,
      p90: 3,
    });
  });
});

describe('balance-report', () => {
  it('既定のレポート出力先を保持する', () => {
    expect(parseArgs(['--before', 'before.json', '--after', 'after.json']).out_dir).toBe(
      'playtest-out/balance-report',
    );
  });

  const beforeRuns = [
    run('s-1', 'won', { delivery: 10, incident: 2, rework: 4 }),
    run('s-2', 'lost', { delivery: 20, incident: 3, rework: 2 }),
    run('s-3', 'lost', { delivery: 30, incident: 1, rework: 1 }),
  ];
  const afterRuns = [
    run('s-1', 'lost', { delivery: 12, incident: 1, rework: 5 }),
    run('s-2', 'won', { delivery: 22, incident: 2, rework: 1 }),
    run('s-3', 'lost', { delivery: 33, incident: 1, rework: 1 }),
  ];

  it('同一seedペアの勝率・分位点・主要指標差分を集計する', async () => {
    const before = await measurement(payload({ runs: beforeRuns }), 'before');
    const after = await measurement(
      payload({ runs: afterRuns, currentRuleset: ruleset(2, ['b', 'a']) }),
      'after',
    );
    const report = compareMeasurements(before, after);

    expect(report.sample).toMatchObject({
      expected: 3,
      before: 3,
      after: 3,
      paired: 3,
      complete: true,
    });
    expect(report.results.overall.winRate).toEqual({ before: 1 / 3, after: 1 / 3, delta: 0 });
    expect(report.results.overall.metrics.delivery.before.p50).toBe(20);
    expect(report.results.overall.metrics.delivery.after.p50).toBe(22);
    expect(report.results.overall.metrics.delivery.delta.p50).toBe(2);
    expect(report.results.cells).toHaveLength(1);
    expect(report.configuration.valueChanges[0]).toMatchObject({
      id: 'balance.test',
      before: 1,
      after: 2,
      delta: 1,
      relativeDelta: 1,
      unit: 'ratio',
    });
    expect(report.configuration.sequenceChanges[0]).toMatchObject({
      id: 'balance.test.distribution',
      before: ['a', 'b'],
      after: ['b', 'a'],
    });
    expect(report.configuration.catalogChanges).toEqual([]);
    expect(report.sensitivity.changes).toHaveLength(2);
    expect(report.sensitivity.interpretation).toContain('複数');
  });

  it('欠損ランを勝敗へ補完せず未完了として記録する', async () => {
    const before = await measurement(payload({ runs: beforeRuns }), 'before');
    const after = await measurement(payload({ runs: afterRuns.slice(0, 2) }), 'after');
    const report = compareMeasurements(before, after);

    expect(report.sample.complete).toBe(false);
    expect(report.sample.paired).toBe(2);
    expect(report.sample.missingAfter).toEqual(['fresh|easy|naive|s-3']);
    expect(report.results.overall.n).toEqual({ before: 2, after: 2, delta: 0 });
  });

  it('相対差分の基準値が0ならnullにする', async () => {
    const before = await measurement(
      payload({ runs: beforeRuns, currentRuleset: ruleset(1) }),
      'before',
    );
    const after = await measurement(
      payload({
        runs: afterRuns,
        currentRuleset: {
          ...ruleset(2),
          registry: { values: [{ id: 'balance.test', value: 1 }], sequences: {} },
          parameters: [{ id: 'balance.test', value: 1, unit: 'ratio', tags: ['test'] }],
        },
      }),
      'after',
    );
    const report = compareMeasurements(before, after);
    expect(report.configuration.valueChanges).toHaveLength(0);

    const zeroBefore = await measurement(
      payload({
        runs: beforeRuns,
        currentRuleset: {
          ...ruleset(1),
          registry: { values: [{ id: 'balance.test', value: 0 }], sequences: {} },
          parameters: [{ id: 'balance.test', value: 0, unit: 'ratio', tags: ['test'] }],
        },
      }),
      'zero-before',
    );
    const zeroAfter = await measurement(
      payload({
        runs: afterRuns,
        currentRuleset: {
          ...ruleset(2),
          registry: { values: [{ id: 'balance.test', value: 1 }], sequences: {} },
          parameters: [{ id: 'balance.test', value: 1, unit: 'ratio', tags: ['test'] }],
        },
      }),
      'zero-after',
    );
    expect(compareMeasurements(zeroBefore, zeroAfter).configuration.valueChanges[0]).toMatchObject({
      before: 0,
      after: 1,
      relativeDelta: null,
    });
  });

  it('カタログだけの変更も設定差分として記録する', async () => {
    const before = await measurement(payload({ runs: beforeRuns }), 'catalog-before');
    const after = await measurement(
      payload({
        runs: afterRuns,
        currentRuleset: {
          ...ruleset(1),
          catalog: { cards: [{ id: 'card.test', order: 0, execution: { value: 'changed' } }] },
          catalogFingerprint: 'd'.repeat(64),
        },
      }),
      'catalog-after',
    );
    const report = compareMeasurements(before, after);

    expect(report.configuration.catalogChanged).toBe(true);
    expect(report.configuration.catalogChanges[0]).toMatchObject({
      kind: 'catalog',
      id: 'contentCatalog',
      before: 'c'.repeat(64),
      after: 'd'.repeat(64),
    });
    expect(report.configuration.changes).toHaveLength(1);
  });

  it('コホート不一致を拒否する', async () => {
    const before = await measurement(payload({ runs: beforeRuns }), 'before');
    const after = await measurement(
      payload({
        runs: afterRuns.slice(0, 2),
        currentCohort: { ...cohort, seeds: ['s-1', 's-2'] },
      }),
      'after',
    );
    after.cohort.seeds = ['s-1', 's-2', 's-4'];
    expect(() => compareMeasurements(before, after)).toThrow(BalanceReportError);
  });

  it('重複・partial・旧配列形式を拒否する', async () => {
    await expect(
      measurement(payload({ runs: [...beforeRuns, beforeRuns[0]] }), 'duplicate'),
    ).rejects.toThrow(/重複ラン/);
    await expect(
      measurement(payload({ runs: beforeRuns, partial: true }), 'partial'),
    ).rejects.toThrow(/partial/);
    await expect(measurement(beforeRuns, 'legacy')).rejects.toThrow(/旧配列形式/);
  });

  it('旧エンベロープのルールセットをref rootから補完する', async () => {
    const legacyPayload = payload({ runs: beforeRuns }) as Record<string, unknown>;
    delete legacyPayload.ruleset;

    const loaded = await loadMeasurement(
      writePayload(legacyPayload, 'legacy-envelope.json'),
      'legacy-envelope',
      resolve('.'),
    );

    expect(loaded.ruleset.version).toBeGreaterThan(0);
    expect(loaded.ruleset.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.ruleset.parameters.length).toBeGreaterThan(0);
    expect(loaded.ruleset.catalogFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Markdownに設定値・結果分布・欠損を含める', async () => {
    const before = await measurement(payload({ runs: beforeRuns }), 'before');
    const after = await measurement(payload({ runs: afterRuns.slice(0, 2) }), 'after');
    const markdown = renderMarkdown(compareMeasurements(before, after));
    expect(markdown).toContain('## 設定値の差分');
    expect(markdown).toContain('## 結果分布の差分');
    expect(markdown).toContain('## 感度（観測値）');
    expect(markdown).toContain('fresh|easy|naive|s-3');
  });

  it('totalsが無い古いランでもDeliveryの旧フィールドを読む', () => {
    expect(
      summarizeRuns([
        {
          status: 'won',
          totalDelivered: 7,
          totals: { incidents: 1, rework: 2 },
          seed: 's-1',
          policy: 'naive',
          difficulty: 'easy',
        },
      ]),
    ).toMatchObject({ n: 1, wins: 1, metrics: { delivery: { mean: 7 } } });
  });
});
