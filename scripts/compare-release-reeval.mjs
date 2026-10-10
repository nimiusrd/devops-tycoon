import { createServer } from 'vite';

const STRATEGY_LABEL = {
  early: '早期凍結',
  late: '遅延凍結',
  continue: '変更継続',
};

const COLUMNS = [
  'scenario',
  'strategy',
  'delivered',
  'unverified',
  'consumption',
  'implementationSpent',
  'validationSpent',
  'automaticFreeze',
  'frozenAt',
  'deadlineMet',
  'unfinished',
  'deferred',
];

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { compareReleaseReeval, evaluateReleaseReevalCriteria } = await server.ssrLoadModule(
    '/src/prototypes/release.ts',
  );
  const rows = compareReleaseReeval();
  const criteria = evaluateReleaseReevalCriteria(rows);
  console.log(COLUMNS.join('\t'));
  for (const scenario of rows) {
    for (const result of scenario.results) {
      console.log(COLUMNS.map((column) => result[column] ?? scenario[column]).join('\t'));
    }
  }
  console.log('');
  console.log(
    '| 条件 | 戦略 | 公開可能出荷 | 未検証 | 消費(実装+検証) | 実装消費 | 検証消費 | 凍結忘れ自動凍結 | 凍結tick | 期限到達 |',
  );
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |');
  for (const scenario of rows) {
    for (const result of scenario.results) {
      const label = STRATEGY_LABEL[result.strategy] ?? result.strategy;
      console.log(
        `| ${scenario.scenario} | ${label} | ${result.delivered} | ${result.unverified} | ${result.consumption} | ${result.implementationSpent} | ${result.validationSpent} | ${result.automaticFreeze} | ${result.frozenAt} | ${result.deadlineMet} |`,
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
