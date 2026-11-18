import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { runRoleHandoffCase } = await server.ssrLoadModule(
    '/tests/unit/helpers/roleHandoffFixture.ts',
  );
  const { resumeRoleHandoff } = await server.ssrLoadModule('/src/prototypes/roleHandoff.ts');
  const rows = [];
  const initialBySeed = {};
  // 全入力とcheckpointは必要時に専用ディレクトリへ再生成。通常save/storageへ書き込まない。
  const journalDirectory = process.env.RI274_JOURNALS;
  if (journalDirectory) await mkdir(journalDirectory, { recursive: true });
  for (const seed of ['g1', 'g2', 'g3']) {
    for (const [investment, cards] of [
      [null, true],
      ['teamAiThrottle', true],
      ['prSizeLimit', true],
      [null, false],
    ]) {
      const run = runRoleHandoffCase(seed, investment, cards);
      const resumed = resumeRoleHandoff(run.save);
      if (!resumed.ok || resumed.session.save() !== run.save)
        throw new Error('terminal resume mismatch');
      const name = `${seed}-${investment ?? 'none'}-${cards ? 'cards' : 'no-cards'}`;
      initialBySeed[seed] = {
        resources: run.initial.resources,
        roster: run.initial.state.roster,
        org: run.initial.state.org,
      };
      const state = run.final.state;
      const firstHandoff = run.receipts.find(({ request }) => request.action.kind === 'handoff');
      const reasonCounts = {};
      for (const attempt of run.attempts)
        if (!attempt.ok) reasonCounts[attempt.reason] = (reasonCounts[attempt.reason] ?? 0) + 1;
      const journal = JSON.stringify(run.attempts);
      const result = {
        name,
        seed,
        investment,
        cards,
        initialResources: run.initial.resources,
        firstHandoff,
        phases: run.phases,
        acceptedOperations: run.receipts.length,
        rejectedOperations: reasonCounts,
        journalSha256: createHash('sha256').update(journal).digest('hex'),
        checkpointSha256: createHash('sha256').update(run.save).digest('hex'),
        checkpointCharacters: run.save.length,
        outcome: {
          phase: state.phase,
          status: state.status,
          winType: state.winType,
          loseReason: state.loseReason,
          sprintsPlayed: state.sprintsPlayed,
          quarterNumber: state.quarterNumber,
          totals: state.totals,
          resources: run.final.resources,
          org: state.org,
          quarterOutcome: state.quarterReview?.outcome ?? null,
        },
        handoffs: run.receipts.filter(({ request }) => request.action.kind === 'handoff').length,
        investmentCost: run.receipts.reduce(
          (sum, receipt) =>
            sum + (receipt.activatedReservation ? receipt.before.resources.reservedBudget : 0),
          0,
        ),
        fieldFocusSpent: run.receipts.reduce(
          (sum, receipt) =>
            sum +
            (['play', 'exchange', 'intervene'].includes(receipt.request.action.kind)
              ? Math.max(
                  0,
                  (receipt.before.resources.focus ?? 0) - (receipt.after.resources.focus ?? 0),
                )
              : 0),
          0,
        ),
      };
      rows.push(result);
      if (journalDirectory) {
        await writeFile(`${journalDirectory}/${name}-inputs.json`, journal);
        await writeFile(`${journalDirectory}/${name}-checkpoint.json`, run.save);
      }
      console.log(
        JSON.stringify({
          name,
          status: state.status,
          sprints: state.sprintsPlayed,
          delivered: state.totals.delivered,
          budget: state.budget,
          hp: state.org.seniorHp,
          operations: run.receipts.length,
        }),
      );
    }
  }
  const filepath = 'docs/prototypes/role-handoff-comparison.json';
  await writeFile(
    filepath,
    await format(
      JSON.stringify({
        generatedBy:
          'devcontainer exec --workspace-folder . node scripts/ri274-role-handoff-evaluation.mjs',
        policy: 'tests/unit/helpers/roleHandoffFixture.ts:runRoleHandoffCase',
        conditions: {
          difficulty: 'normal',
          trials: [],
          scenario: 'default',
          initialDeck: [],
          initialBudget: 45,
          fieldStepMs: 1000,
          reservationTiming: 'first setup handoff only',
          factors:
            'baseline vs teamAiThrottle / prSizeLimit reservation, baseline vs cards disabled; other rules and policies identical',
          journalExport:
            'RI274_JOURNALS=/tmp/ri274-journals node scripts/ri274-role-handoff-evaluation.mjs',
          humanPlay: false,
        },
        initialBySeed,
        rows,
      }),
      { ...(await resolveConfig(filepath)), filepath },
    ),
  );
} finally {
  await server.close();
}
