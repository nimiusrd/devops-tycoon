import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const seedCount = 64;
const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const { compareHandExchangeFlowStrategies, createHandExchangeFlowPrototype } =
    await server.ssrLoadModule('/src/prototypes/handExchange.ts');
  const results = Array.from({ length: seedCount }, (_, index) => {
    const seed = `RI-186-flow-${String(index + 1).padStart(2, '0')}`;
    return { seed, strategies: compareHandExchangeFlowStrategies(seed) };
  });
  const scenario = createHandExchangeFlowPrototype(results[0].seed);
  const { config } = scenario.sprint;
  const metricNames = [
    'delivered',
    'completed',
    'timedOut',
    'aiAssistedCompleted',
    'incidents',
    'autoContained',
    'spread',
    'focusSpent',
    'focusRemaining',
    'interventions',
    'firefights',
    'seniorHp',
  ];
  const baselineBySeed = new Map(results.map(({ seed, strategies }) => [seed, strategies[0]]));
  const summary = [0, 1, 2].map((attempts) => {
    const rows = results
      .flatMap(({ strategies }) => strategies)
      .filter((row) => row.attempts === attempts);
    const metrics = Object.fromEntries(
      metricNames.map((metric) => {
        const values = rows.map((row) => Number(row[metric]));
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return [
          metric,
          { mean: Number(mean.toFixed(3)), min: Math.min(...values), max: Math.max(...values) },
        ];
      }),
    );
    const comparison = Object.fromEntries(
      metricNames.map((metric) => {
        const deltas = results.map(
          ({ seed, strategies }) =>
            Number(strategies[attempts][metric]) - Number(baselineBySeed.get(seed)[metric]),
        );
        return [
          metric,
          {
            higher: deltas.filter((delta) => delta > 0).length,
            tied: deltas.filter((delta) => delta === 0).length,
            lower: deltas.filter((delta) => delta < 0).length,
            meanDelta: Number(
              (deltas.reduce((sum, value) => sum + value, 0) / deltas.length).toFixed(3),
            ),
          },
        ];
      }),
    );
    return { attempts, metrics, vsKeepHand: comparison };
  });
  const incidentSeeds = results.filter(({ strategies }) => strategies[0].incidents > 0);
  const incidentSummary = [0, 1, 2].map((attempts) => {
    const rows = incidentSeeds.map(({ strategies }) => strategies[attempts]);
    if (rows.length === 0) return { attempts, metrics: null };
    const averages = Object.fromEntries(
      ['delivered', 'incidents', 'firefights', 'focusRemaining', 'seniorHp'].map((metric) => {
        const mean = rows.reduce((sum, row) => sum + Number(row[metric]), 0) / rows.length;
        return [metric, Number(mean.toFixed(3))];
      }),
    );
    return { attempts, metrics: averages };
  });
  const costSensitivity = [1, 2, 3].map((focusCost) => {
    const rows = results.map(({ seed, strategies }) => ({
      seed,
      strategies: focusCost === 2 ? strategies : compareHandExchangeFlowStrategies(seed, focusCost),
    }));
    const sensitivitySummary = [1, 2].map((attempts) => {
      const strategyRows = rows.map(({ strategies }) => strategies[attempts]);
      const metrics = Object.fromEntries(
        ['delivered', 'incidents', 'focusSpent', 'focusRemaining', 'firefights', 'seniorHp'].map(
          (metric) => {
            const values = strategyRows.map((row) => Number(row[metric]));
            const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
            return [metric, Number(mean.toFixed(3))];
          },
        ),
      );
      const deltas = rows.map(
        ({ seed, strategies }) =>
          Number(strategies[attempts].delivered) - Number(baselineBySeed.get(seed).delivered),
      );
      return {
        attempts,
        metrics,
        deliveredVsKeepHand: {
          higher: deltas.filter((delta) => delta > 0).length,
          tied: deltas.filter((delta) => delta === 0).length,
          lower: deltas.filter((delta) => delta < 0).length,
          meanDelta: Number(
            (deltas.reduce((sum, value) => sum + value, 0) / deltas.length).toFixed(3),
          ),
        },
      };
    });
    return {
      focusCost,
      summary: sensitivitySummary,
    };
  });
  const resultColumns = [
    'attempts',
    'selected',
    'delivered',
    'incidents',
    'focusRemaining',
    'firefights',
    'seniorHp',
  ];
  const compactResults = results.map(({ seed, strategies }) => ({
    seed,
    strategies: strategies.map((row) =>
      resultColumns.map((column) =>
        column === 'seniorHp' ? Number(row[column].toFixed(3)) : row[column],
      ),
    ),
  }));
  const artifact = {
    title: 'RI-186 hand exchange follow-up evaluation',
    generatedBy: 'npm run prototype:ri186',
    seeds: seedCount,
    scenario: {
      taskCount: config.taskCount,
      codingSlots: config.codingSlots,
      minCompleteTick: config.minCompleteTick,
      maxTicks: config.maxTicks,
      focusMax: config.focusMax,
      aiEnabled: scenario.org.aiEnabled,
      taskMix: 'default seeded distribution',
      intake: 'default backlog-to-coding WIP flow',
    },
    policy: {
      exchange: 'replace the first hand slot with the next draw before the first card play',
      cardPlay: 'play the first card in hand once',
      interventions: 'firefight when urgent; otherwise interrupt review at queue length 4 or more',
      note: 'Fixed policy comparison; it does not model an adaptive or optimal player.',
    },
    metricNames,
    resultColumns,
    summary,
    completionSummary: {
      totalRuns: results.length * 3,
      fullyCompleted: results
        .flatMap(({ strategies }) => strategies)
        .filter((row) => row.completed === config.taskCount).length,
      timedOut: results.flatMap(({ strategies }) => strategies).filter((row) => row.timedOut)
        .length,
    },
    incidentScenario: {
      definition: 'Seeds where the no-exchange baseline experienced at least one incident.',
      seedCount: incidentSeeds.length,
      summary: incidentSummary,
    },
    costSensitivity,
    results: compactResults,
  };
  const destination = resolve('docs/prototypes/hand-exchange-flow-comparison.json');
  const formatted = await format(JSON.stringify(artifact), {
    ...(await resolveConfig(destination)),
    filepath: destination,
  });
  await writeFile(destination, formatted);
  const consoleMetrics = [
    'delivered',
    'incidents',
    'autoContained',
    'focusSpent',
    'focusRemaining',
    'interventions',
    'firefights',
    'seniorHp',
  ];
  console.log(
    JSON.stringify(
      {
        seeds: seedCount,
        summary: summary.map(({ attempts, metrics, vsKeepHand }) => ({
          attempts,
          metrics: Object.fromEntries(consoleMetrics.map((metric) => [metric, metrics[metric]])),
          vsKeepHand: Object.fromEntries(
            ['delivered', 'focusRemaining', 'incidents', 'seniorHp'].map((metric) => [
              metric,
              vsKeepHand[metric],
            ]),
          ),
        })),
        incidentScenario: artifact.incidentScenario,
        costSensitivity: costSensitivity.map(({ focusCost, summary: rows }) => ({
          focusCost,
          summary: rows,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${destination}`);
} finally {
  await server.close();
}
