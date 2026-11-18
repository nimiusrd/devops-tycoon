import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
const unwrap = (r) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
};
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

try {
  const { authorScenarioExample, ScenarioAuthoring, SCENARIO_AUTHORING_LIMITS } =
    await server.ssrLoadModule('/src/prototypes/scenarioAuthoring.ts');
  const rows = [];
  for (const seed of ['RI-273:1', 'RI-273:2', 'RI-273:3']) {
    for (const factor of ['control', 'testCoverage=10', 'documentation=10', 'all-complex']) {
      const input = authorScenarioExample(seed);
      if (factor === 'testCoverage=10') input.initialOrg.testCoverage = 10;
      if (factor === 'documentation=10') input.initialOrg.documentation = 10;
      if (factor === 'all-complex') input.taskKinds.fill('complex');
      const raw = JSON.stringify(input);
      const run = unwrap(ScenarioAuthoring.fromJSON(raw));
      unwrap(run.start());
      const initial = run.snapshot().board;
      unwrap(run.advance(13));
      const checkpoint = unwrap(run.checkpoint());
      const resumed = unwrap(ScenarioAuthoring.resume(checkpoint));
      deepStrictEqual(resumed.snapshot(), run.snapshot());
      unwrap(run.advance(SCENARIO_AUTHORING_LIMITS.ticks));
      unwrap(resumed.advance(SCENARIO_AUTHORING_LIMITS.ticks));
      deepStrictEqual(resumed.snapshot(), run.snapshot());
      const fresh = unwrap(ScenarioAuthoring.fromJSON(raw));
      unwrap(fresh.start());
      deepStrictEqual(fresh.snapshot().board, initial);
      unwrap(fresh.advance(SCENARIO_AUTHORING_LIMITS.ticks));
      deepStrictEqual(fresh.snapshot(), run.snapshot());
      const final = run.snapshot().board;
      const result = run.result();
      delete result.timeline;
      delete result.events;
      delete result.fireEvents;
      rows.push({
        factor,
        input,
        commands: [{ start: true }, { advance: 13 }, { advance: SCENARIO_AUTHORING_LIMITS.ticks }],
        initial: {
          boardSha256: hash(initial),
          org: initial.org,
          budget: initial.initialBudget,
          config: initial.sprint.config,
          effects: initial.sprint.cardEffects,
          aiAdoption: initial.sprint.aiAdoption,
          aiMasteryNorm: initial.sprint.aiMasteryNorm,
          rngState: initial.rngState,
          highValueTaskIds: initial.sprint.tasks
            .filter((task) => task.highValue)
            .map((task) => task.id),
        },
        checkpoint: JSON.parse(checkpoint),
        final: { tick: final.tick, rngState: final.rngState, org: final.org, result },
        consumption: {
          focusSpent: final.sprint.metrics.focusSpent,
          budgetSpent: 0,
          metaRewards: 0,
        },
        identicalFreshRunAndResume: true,
      });
    }
  }
  for (const [path, value] of [
    ['docs/prototypes/scenario-authoring-example.json', authorScenarioExample()],
    [
      'docs/prototypes/scenario-authoring-comparison.json',
      { mode: 'unattended-first-sprint-only', limits: SCENARIO_AUTHORING_LIMITS, rows },
    ],
  ]) {
    await writeFile(
      path,
      await format(JSON.stringify(value), { ...(await resolveConfig(path)), filepath: path }),
    );
  }
  console.table(
    rows.map(({ input, factor, final }) => ({
      seed: input.base.seed,
      factor,
      ticks: final.tick,
      delivered: final.result.delivered,
      rework: final.result.rework,
      incidents: final.result.incidents,
    })),
  );
} finally {
  await server.close();
}
