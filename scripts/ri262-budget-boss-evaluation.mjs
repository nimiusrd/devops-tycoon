import { deepStrictEqual } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const path = 'docs/prototypes/budget-boss-comparison.jsonl';
const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const { advanceBudgetBoss, createBudgetBoss, previewBudgetBoss, viewBudgetBoss } =
    await server.ssrLoadModule('/src/prototypes/budgetBoss.ts');
  const preview = previewBudgetBoss(createBudgetBoss('RI-262'));
  const strategies = {
    concentrate: [null, 'auto-test', null],
    distribute: ['copilot', 'copilot', 'copilot'],
    conserve: [null, null, null],
    sameCostRoutine: ['auto-test', null, null],
  };
  const results = [];
  const seeds = Array.from({ length: 9 }, (_, index) =>
    index === 0 ? 'RI-262' : `RI-262:${index}`,
  );
  for (const seed of seeds) {
    for (const [strategy, cardIds] of Object.entries(strategies)) {
      let state = createBudgetBoss(seed);
      for (const [index, { id }] of preview.batches.entries()) {
        const next = advanceBudgetBoss(state, { batchId: id, cardId: cardIds[index] });
        if (next === state) throw new Error(`方針 ${strategy} の入力を受理できません: ${id}`);
        state = next;
      }
      results.push({ strategy, ...state, result: viewBudgetBoss(state) });
    }
  }
  const contents =
    [{ preview }, ...results].map((record) => JSON.stringify(record)).join('\n') + '\n';
  if (process.argv.includes('--check')) {
    deepStrictEqual(contents, await readFile(path, 'utf8'));
  } else {
    await writeFile(path, contents);
  }
  console.table(results.map(({ seed, strategy, result }) => ({ seed, strategy, ...result })));
} finally {
  await server.close();
}
