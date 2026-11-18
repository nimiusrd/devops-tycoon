import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { comparePublicDraft, createPublicDraft, viewPublicDraft, PUBLIC_DRAFT_CONDITIONS } =
    await server.ssrLoadModule('/src/prototypes/publicDraft.ts');
  const seeds = ['RI-269', 'RI-269:1', 'RI-269:2'];
  const results = Object.keys(PUBLIC_DRAFT_CONDITIONS).flatMap((condition) =>
    seeds.flatMap((seed) => comparePublicDraft(seed, condition)),
  );
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri269-public-draft-evaluation.mjs',
    contract: viewPublicDraft(createPublicDraft(seeds[0])),
    conditions: PUBLIC_DRAFT_CONDITIONS,
    policy:
      '選択した札を列挙順にtick0で全て発動。毎tick、緊急炎上ならfirefight、他はReview4件以上でinterruptReview、他はnone。失敗した介入も同じtickで工程を進める。',
    limitation: '固定方針の実sim比較。人間の適応行動・楽しさ・最適戦略の証明ではない。',
    results,
  };
  const filepath = 'docs/prototypes/public-draft-comparison.json';
  await writeFile(
    filepath,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(filepath)), filepath }),
  );
  console.table(
    results.map(({ seed, condition, build, result }) => ({
      seed,
      condition,
      build,
      delivered: result.delivered,
      quality: result.quality,
      clear: result.bossCleared,
      timedOut: result.timedOut,
      spent: result.focusSpent,
      ticks: result.ticks,
    })),
  );
} finally {
  await server.close();
}
