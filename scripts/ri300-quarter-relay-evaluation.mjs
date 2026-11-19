import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { format, resolveConfig } from 'prettier';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { evaluateQuarterRelay } = await server.ssrLoadModule(
    '/src/prototypes/quarterRelayEvaluation.ts',
  );
  const runs = evaluateQuarterRelay();
  const path = 'docs/prototypes/quarter-relay-comparison.json';
  const report = {
    note: '実Q1未達→実目標修正→Q2。3seed、修正案2種類と受領側固定方針2種類の一要因比較。人間評価未実施。UUIDは受領ごとに変わり、simと資源は決定論。',
    runs,
  };
  await writeFile(
    path,
    await format(JSON.stringify(report), { ...(await resolveConfig(path)), parser: 'json' }),
  );
  console.log(
    JSON.stringify(
      runs.map(({ seed, source, transfers }) => ({
        seed,
        q1: source.final.quarterReview?.outcome ?? source.final.status,
        transfers: transfers.map(({ adjustment, runs }) => ({
          adjustment,
          results: runs.map(({ strategy, result, budget, totals, sprints }) => ({
            strategy,
            result,
            budget,
            delivered: totals.delivered,
            sprints,
          })),
        })),
      })),
    ),
  );
} finally {
  await server.close();
}
