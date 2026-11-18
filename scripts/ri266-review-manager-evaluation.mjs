import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { compareReviewManager, createReviewManager, viewReviewManager } =
    await server.ssrLoadModule('/src/prototypes/reviewManager.ts');
  const seeds = ['RI-266', 'RI-266:1', 'RI-266:2'];
  const results = [12, 24, 48, 60].flatMap((maxTicks) =>
    seeds.flatMap((seed) => compareReviewManager(seed, maxTicks)),
  );
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri266-review-manager-evaluation.mjs',
    rules: {
      fixture:
        'レビュー待ち12件。id%3=2の4件は高価値complex、他8件はroutine。全件AI支援。過去の仕事履歴は持たない。',
      sim: 'stepSprint/reviewOneの実処理。レビュー位置だけ並べ替え、工程処理後はID順へ戻す。延焼先にも選択順が作用する。',
      policies:
        'noneはorder未指定、他は毎tickに高価値/通常を優先し群内ID昇順。費用・効果は全方針同一。',
      wait: 'tick開始時のreview件数を積算。処理を受けたtickも含む。手戻り・炎上中は含まない。',
      consumption:
        '群別reviewHpDemandは実レビュー回数×既存費用。HPのclamp・自然回復前の要求量。実残HPは全体seniorHp。',
      sensitivity: '同seed/資源/仕事でmaxTicksだけ12/24/48/60へ変更。',
    },
    contract: viewReviewManager(createReviewManager(seeds[0])),
    limitation:
      '隔離APIと固定方針の比較。完成UI、人間評価、適応行動、楽しさ、本番係数の証拠ではない。通常の報酬/メタ/デイリー/storageには非接続。',
    results,
  };
  const filepath = 'docs/prototypes/review-manager-comparison.json';
  await writeFile(
    filepath,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(filepath)), filepath }),
  );
  console.table(
    results.map(({ seed, maxTicks, policy, result }) => ({
      seed,
      maxTicks,
      policy,
      delivered: result.delivered,
      important: result.groups.important.done,
      ordinary: result.groups.ordinary.done,
      waitImportant: result.groups.important.reviewOccupancyTicks,
      waitOrdinary: result.groups.ordinary.reviewOccupancyTicks,
      hp: result.seniorHp,
      timedOut: result.timedOut,
    })),
  );
} finally {
  await server.close();
}
