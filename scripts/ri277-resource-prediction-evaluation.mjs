import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { ResourcePredictionPractice, resourcePredictionDefinition } = await server.ssrLoadModule(
    '/src/prototypes/resourcePrediction.ts',
  );
  const cases = [];
  for (const seed of ['g1', 'g2', 'g3']) {
    for (const variant of ['prediction', 'skip', 'changed', 'pair-review']) {
      let practice = new ResourcePredictionPractice(seed);
      const initial = practice.view().initial;
      const attempts = [];
      const send = (command) => {
        const input = { revision: practice.view().revision, command };
        const accepted = practice.apply(input);
        attempts.push({ input, accepted });
        return accepted;
      };
      send(
        variant === 'skip'
          ? { type: 'skip' }
          : { type: 'predict', choice: 'reviewQueue', source: 'self' },
      );
      send({ type: 'begin' });
      let resumed = false;
      while (practice.view().phase === 'running') {
        const tick = practice.view().state.sprintTick;
        if (variant === 'changed' && tick === 12)
          send({ type: 'change', choice: 'seniorHp', source: 'system-what-if' });
        if (tick === 15 && !resumed) {
          const restored = ResourcePredictionPractice.restore(practice.save());
          if (!restored || restored.save() !== practice.save())
            throw new Error('mid-sprint resume mismatch');
          practice = restored;
          resumed = true;
        }
        if (variant === 'pair-review' && tick % 10 === 0)
          send({ type: 'intervene', id: 'pairReview' });
        if (!send({ type: 'step' })) throw new Error('cannot progress');
      }
      const saved = JSON.parse(practice.save());
      if (ResourcePredictionPractice.restore(practice.save())?.save() !== practice.save())
        throw new Error('terminal replay mismatch');
      cases.push({
        seed,
        variant,
        initial,
        attempts,
        inputs: saved.inputs,
        checkpoint: saved.checkpoint,
        resumed,
      });
    }
  }
  for (const seed of ['g1', 'g2', 'g3']) {
    const rows = cases.filter((row) => row.seed === seed);
    for (const row of rows.slice(1, 3)) {
      if (JSON.stringify(row.checkpoint.state) !== JSON.stringify(rows[0].checkpoint.state))
        throw new Error('prediction changed sim');
      const samples = (r) =>
        r.checkpoint.observations.map((sample) => ({ ...sample, revision: 0 }));
      if (JSON.stringify(samples(row)) !== JSON.stringify(samples(rows[0])))
        throw new Error('prediction changed observations');
    }
  }
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri277-resource-prediction-evaluation.mjs',
    definition: resourcePredictionDefinition(),
    policy:
      'First normal/default sprint only. No cards, roster edits, levers or extra unlocks. Every step is exactly one real tick. pair-review alone tries pairReview every 10 ticks; all rejected attempts are retained. changed alone adds a system-what-if-labelled revision at tick 12. All cases restore at tick 15 and after completion.',
    limitation:
      'API technical prototype only; no human evaluation or same-screen UI. Sources are self-reported. No learning-effect, causal attribution or production-balance claim. End of the first sprint is practice completion, not a run win. Fixed danger thresholds are unrelated to normal loss rules.',
    initialConditions: ['g1', 'g2', 'g3'].map((seed) => ({
      seed,
      state: cases.find((row) => row.seed === seed).initial,
    })),
    cases: cases.map((row) => ({
      seed: row.seed,
      variant: row.variant,
      attempts: row.attempts,
      inputs: row.inputs,
      resumed: row.resumed,
      checkpoint: {
        phase: row.checkpoint.phase,
        original: row.checkpoint.original,
        changes: row.checkpoint.changes,
        observations: row.checkpoint.observations,
        frame: row.checkpoint.frame,
        sprintRngState: row.checkpoint.sprintRngState,
        comparison: row.checkpoint.comparison,
      },
    })),
  };
  const destination = 'docs/prototypes/resource-prediction-comparison.json';
  await writeFile(
    destination,
    await format(JSON.stringify(artifact), {
      ...(await resolveConfig(destination)),
      filepath: destination,
    }),
  );
  console.log(
    JSON.stringify(
      cases.map((row) => ({
        seed: row.seed,
        variant: row.variant,
        initialBudget: row.initial.budget,
        ticks: row.checkpoint.state.sprintTick,
        delivered: row.checkpoint.state.lastResult?.delivered,
        hp: row.checkpoint.state.org.seniorHp,
        focus: row.checkpoint.state.sprint.focus,
        comparison: row.checkpoint.comparison,
      })),
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
