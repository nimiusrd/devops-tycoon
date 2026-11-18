import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { format, resolveConfig } from 'prettier';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { evaluateChallengeCodes } = await server.ssrLoadModule(
    '/src/prototypes/challengeCodeEvaluation.ts',
  );
  const rows = evaluateChallengeCodes();
  const report = {
    note: '5 seed × 課題閾値1/5/10 × 固定方針2種類。カードのみ/可能時pairReview。人間プレイ未実施。通常勝敗と追加課題は別結果。',
    // 閾値だけ変えた行は最終値を残し、同一入力列の重複掲載を避ける。
    runs: rows.filter(({ minimum }) => minimum === 5),
    sensitivity: rows.map(({ seed, minimum, strategy, final }) => ({
      seed,
      minimum,
      strategy,
      final,
    })),
  };
  const path = 'docs/prototypes/challenge-code-comparison.json';
  await writeFile(
    path,
    await format(JSON.stringify(report), { ...(await resolveConfig(path)), parser: 'json' }),
  );
  console.log(
    JSON.stringify(
      rows.map(({ seed, minimum, strategy, final }) => ({
        seed,
        minimum,
        strategy,
        measured: final.objective.measured,
        achieved: final.objective.achieved,
        status: final.result.status,
        delivered: final.totals.delivered,
        budget: final.budget,
      })),
    ),
  );
} finally {
  await server.close();
}
