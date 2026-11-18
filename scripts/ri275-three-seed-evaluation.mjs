import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { ThreeSeedSet, threeSeedSetDefinition, runSetPolicy } = await server.ssrLoadModule(
    '/src/prototypes/threeSeedSet.ts',
  );
  const definition = threeSeedSetDefinition();
  const comparisons = [];
  for (const build of ['delivery', 'resilient', 'balanced']) {
    for (const active of [false, true]) {
      const session = runSetPolicy(
        new ThreeSeedSet(build, definition.unlock.requiredAccess),
        active,
      );
      const saved = JSON.parse(session.save());
      if (ThreeSeedSet.restore(session.save())?.save() !== session.save())
        throw new Error('comparison replay mismatch');
      comparisons.push({
        build,
        active,
        phase: saved.phase,
        inputCount: saved.inputs.length,
        // ms/choice/id/indexを含む全成功入力。revisionは配列位置と等しい。
        commands: saved.inputs.map((entry) => entry.command),
        results: saved.results.map((r) => ({
          index: r.index,
          seed: r.seed,
          scenario: r.scenario,
          initialOrg: r.initialOrg,
          initialBudget: r.initialBudget,
          consumption: r.consumption,
          status: r.terminal.status,
          winType: r.terminal.winType ?? null,
          loseReason: r.terminal.loseReason ?? null,
          totals: r.terminal.totals,
          budget: r.terminal.budget,
          org: r.terminal.org,
          sprintsPlayed: r.terminal.sprintsPlayed,
          usedHeavyActions: r.terminal.usedHeavyActions,
        })),
      });
    }
  }
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri275-three-seed-evaluation.mjs',
    definition,
    policy:
      'Same policy in all conditions. Draft prefers the common build then first candidate; review-1 evolution; event choice 0; no shopping; rest heal; recruit skip; first goal adjustment. Active: try every hand card, pairReview, firefight, interruptReview then step(1000). Idle: only step(1000). Rejected commands are no-ops and are omitted from the saved command log.',
    limitation:
      'Fixed policy comparison only. No human play, adaptive behavior or production balance claim. Budget decreases/increases are net per input; simultaneous internal income and costs are not gross cash flow.',
    comparisons,
  };
  const destination = 'docs/prototypes/three-seed-set-comparison.json';
  await writeFile(
    destination,
    await format(JSON.stringify(artifact), {
      ...(await resolveConfig(destination)),
      filepath: destination,
    }),
  );
  console.log(
    JSON.stringify(
      comparisons.map((row) => ({
        build: row.build,
        active: row.active,
        phase: row.phase,
        inputCount: row.inputCount,
        results: row.results.map((r) => ({
          seed: r.seed,
          status: r.status,
          winType: r.winType,
          loseReason: r.loseReason,
          delivered: r.totals.delivered,
          rework: r.totals.rework,
          ...r.consumption,
          hp: r.org.seniorHp,
          debt: r.org.techDebt,
        })),
      })),
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
