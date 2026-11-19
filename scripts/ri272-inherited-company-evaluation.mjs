import { deepStrictEqual } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const path = 'docs/prototypes/inherited-company-comparison.json';
const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const { InheritedCompanyRun, previewInheritedCompany } = await server.ssrLoadModule(
    '/src/prototypes/inheritedCompany.ts',
  );
  const preview = previewInheritedCompany();
  const trials = [];
  for (const seed of [preview.defaultSeed, 'RI-272:2', 'RI-272:3']) {
    for (const decision of ['maintain', 'remove']) {
      const run = InheritedCompanyRun.start(decision, seed);
      run.advanceSprint();
      const checkpoint = run.checkpoint();
      run.advanceSprint();
      const resumed = InheritedCompanyRun.resume(checkpoint);
      resumed.advanceSprint();
      const result = run.snapshot();
      deepStrictEqual(resumed.snapshot(), result);
      trials.push({ checkpoint, result });
    }
  }
  const records = trials.map(({ checkpoint, result }) => ({
    checkpoint: JSON.parse(checkpoint),
    migrationCost: result.migrationCost,
    budgetRemaining: result.budget,
    sprints: result.outcomes.map((sprint) => ({
      number: sprint.number,
      seed: sprint.seed,
      ticks: sprint.ticks,
      timedOut: sprint.timedOut,
      codingSlots: sprint.config.codingSlots,
      delivered: sprint.delivered,
      done: sprint.done,
      rework: sprint.rework,
      incidents: sprint.incidents,
      spread: sprint.spread,
      reviewQueuePeak: sprint.reviewQueuePeak,
      endSeniorHp: sprint.endOrg.seniorHp,
      endTechDebt: sprint.endOrg.techDebt,
      rngState: sprint.rngState,
    })),
  }));
  const contents = await format(JSON.stringify({ preview, trials: records }), {
    ...(await resolveConfig(path)),
    filepath: path,
  });
  if (process.argv.includes('--check')) {
    deepStrictEqual(contents, await readFile(path, 'utf8'));
  } else {
    await writeFile(path, contents);
  }
  console.table(
    trials.map(({ result }) => ({
      seed: result.seed,
      decision: result.decision,
      budget: result.budget,
      delivered: result.outcomes.map((sprint) => sprint.delivered).join(' / '),
      rework: result.outcomes.map((sprint) => sprint.rework).join(' / '),
      debt: result.outcomes.map((sprint) => sprint.endOrg.techDebt).join(' / '),
      hp: result.outcomes.map((sprint) => sprint.endOrg.seniorHp.toFixed(2)).join(' / '),
    })),
  );
} finally {
  await server.close();
}
