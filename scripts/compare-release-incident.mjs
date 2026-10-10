import { createServer } from 'vite';

const STRATEGY_LABEL = {
  early: '早期凍結',
  late: '遅延凍結',
  continue: '変更継続',
};

const COLUMNS = [
  'scenario',
  'strategy',
  'shippedValue',
  'unverified',
  'unverifiedCost',
  'netOutcome',
  'netOutcomeUnit',
  'unverifiedFeatures',
];

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { compareReleaseIncidentReeval, evaluateReleaseIncidentCriteria } =
    await server.ssrLoadModule('/src/prototypes/release.ts');
  const rows = compareReleaseIncidentReeval();
  const criteria = evaluateReleaseIncidentCriteria(rows);
  console.log(COLUMNS.join('\t'));
  for (const scenario of rows) {
    for (const result of scenario.results) {
      const features = result.unverifiedFeatures
        .map((feature) => `${feature.id}:${feature.value}`)
        .join(',');
      console.log(
        [
          scenario.scenario,
          result.strategy,
          result.shippedValue,
          result.unverified,
          result.unverifiedCost,
          result.netOutcome,
          result.netOutcomeUnit,
          features || '-',
        ].join('\t'),
      );
    }
  }
  console.log('');
  console.log(
    '| 条件 | 戦略 | 出荷価値 | 未検証件数 | 未検証コスト | 差引成果 | 単位 | 未検証案件 (id:value) |',
  );
  console.log('| --- | --- | ---: | ---: | ---: | ---: | --- | --- |');
  for (const scenario of rows) {
    for (const result of scenario.results) {
      const label = STRATEGY_LABEL[result.strategy] ?? result.strategy;
      const features =
        result.unverifiedFeatures.map((feature) => `${feature.id}:${feature.value}`).join(', ') ||
        '-';
      console.log(
        `| ${scenario.scenario} | ${label} | ${result.shippedValue} | ${result.unverified} | ${result.unverifiedCost} | ${result.netOutcome} | ${result.netOutcomeUnit} | ${features} |`,
      );
    }
  }
  console.log('');
  console.log(`locked-criteria\t${criteria.met}`);
  console.log(`pass\t${criteria.pass}\t${criteria.passConditions.join(',')}`);
  console.log(`fail\t${criteria.fail}`);
  console.log('');
  console.log(JSON.stringify({ criteria, scenarios: rows }, null, 2));
} finally {
  await server.close();
}
