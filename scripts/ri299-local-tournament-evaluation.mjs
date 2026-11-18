import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { recordTournamentReplay } = await server.ssrLoadModule(
    '/tests/unit/helpers/localTournamentFixture.ts',
  );
  const { compareLocalTournament } = await server.ssrLoadModule(
    '/src/prototypes/localTournament.ts',
  );
  const { serializeReplay, parseReplayShare } = await server.ssrLoadModule(
    '/src/state/replayShare.ts',
  );
  const records = ['g1', 'g2'].flatMap((seed) =>
    [false, true].map((skilled) => ({
      policy: skilled ? 'skilled' : 'plain',
      replay: recordTournamentReplay(seed, skilled),
    })),
  );
  const inputs = records.map(({ policy, replay }) => ({
    json: serializeReplay(replay),
    participantNote: `${replay.seed}-${policy}`,
  }));
  if (!inputs.every(({ json }) => parseReplayShare(json).ok))
    throw new Error('parser rejected recording');
  const result = compareLocalTournament(inputs);
  if (!result.ok || result.groups.length !== 2 || result.groups.some((group) => group.length !== 2))
    throw new Error('unexpected groups');
  for (const [filepath, value] of [
    [
      'docs/prototypes/local-tournament-replays.json',
      {
        generatedBy:
          'devcontainer exec --workspace-folder . node scripts/ri299-local-tournament-evaluation.mjs',
        policySource: 'tests/unit/helpers/runFlow.ts:advance',
        seeds: ['g1', 'g2'],
        difficulty: 'normal',
        trials: [],
        retainedFrames: 'initial setup and terminal only',
        records,
      },
    ],
    ['docs/prototypes/local-tournament-comparison.json', result],
  ]) {
    await writeFile(
      filepath,
      await format(JSON.stringify(value), { ...(await resolveConfig(filepath)), filepath }),
    );
  }
  console.log(JSON.stringify({ entries: result.entries, groups: result.groups }, null, 2));
} finally {
  await server.close();
}
