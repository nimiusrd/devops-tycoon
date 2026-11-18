import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

function compact(result) {
  const metrics = { ...result };
  delete metrics.timeline;
  return metrics;
}

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { compareAuditorCases } = await server.ssrLoadModule('/src/prototypes/auditorMode.ts');
  const rows = compareAuditorCases();
  const summary = [...new Set(rows.map((row) => row.factor))].map((factor) => ({
    factor,
    causes: ['review-capacity', 'uncontained-fire'].map((cause) => {
      const group = rows.filter(
        (row) => row.factor === factor && row.spec.generatedCause === cause,
      );
      return {
        cause,
        baselineMissed: group.filter((row) => row.baseline.outcome === 'deadline-missed').length,
        plans: ['review', 'contain', 'broad'].map((plan) => {
          const trials = group.map((row) => row.trials.find((trial) => trial.plan === plan));
          return {
            plan,
            cleared: trials.filter((trial) => trial.result.outcome === 'cleared').length,
            affordable: trials[0].affordable,
          };
        }),
      };
    }),
  }));
  const artifact = {
    generatedBy: 'devcontainer exec --workspace-folder . node scripts/ri265-auditor-evaluation.mjs',
    note: '架空の原因を明示生成した固定介入比較。人間の適応行動・楽しさは未評価。金額は試作用改善予算単位。',
    summary,
    examples: rows.filter((row) => row.factor === 'control' && row.spec.seed === 'RI-265:1'),
  };
  const path = 'docs/prototypes/auditor-mode-comparison.json';
  await writeFile(
    path,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(path)), filepath: path }),
  );
  const records = rows.map((row) => ({
    factor: row.factor,
    spec: row.spec,
    baseline: compact(row.baseline),
    trials: row.trials.map((trial) => ({ ...trial, result: compact(trial.result) })),
  }));
  await writeFile(
    'docs/prototypes/auditor-mode-runs.jsonl',
    records.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await server.close();
}
