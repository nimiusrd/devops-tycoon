import { deepStrictEqual, ok } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
const unwrap = (r) => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
try {
  const { recordSpectatorReplay } = await server.ssrLoadModule(
    '/tests/unit/helpers/spectatorQuizFixture.ts',
  );
  const { SpectatorQuiz, SPECTATOR_QUIZ_LIMITS } = await server.ssrLoadModule(
    '/src/prototypes/spectatorQuiz.ts',
  );
  const { parseReplayShare } = await server.ssrLoadModule('/src/state/replayShare.ts');
  const records = ['g1', 'g2'].map(recordSpectatorReplay);
  const rows = [];
  for (const record of records) {
    deepStrictEqual(recordSpectatorReplay(record.replay.seed), record);
    for (const format of ['v2', 'legacy-v1']) {
      const source = structuredClone(record.replay);
      if (format === 'legacy-v1') {
        source.schemaVersion = 1;
        delete source.ruleset;
        delete source.contentSnapshot;
      }
      const raw = JSON.stringify(source);
      ok(parseReplayShare(raw).ok);
      for (const currentIndex of [0, 1]) {
        for (const response of ['increased', 'unchanged', 'skip']) {
          const quiz = unwrap(await SpectatorQuiz.open(raw, currentIndex, currentIndex + 1));
          const question = quiz.view();
          const before = raw;
          const checkpoints = [quiz.checkpoint()];
          unwrap(response === 'skip' ? quiz.skip() : quiz.answer(response));
          checkpoints.push(quiz.checkpoint());
          const resumed = unwrap(await SpectatorQuiz.resume(raw, quiz.checkpoint()));
          deepStrictEqual(resumed.view(), quiz.view());
          unwrap(quiz.reveal());
          unwrap(resumed.reveal());
          deepStrictEqual(resumed.view(), quiz.view());
          checkpoints.push(quiz.checkpoint());
          const completed = unwrap(await SpectatorQuiz.resume(raw, quiz.checkpoint()));
          deepStrictEqual(completed.view(), quiz.view());
          deepStrictEqual(raw, before);
          rows.push({
            seed: source.seed,
            format,
            currentIndex,
            response,
            question,
            checkpoints,
            result: quiz.view(),
            identicalResume: true,
            sourceUnchanged: true,
            consumption: { runInputs: 0, ticks: 0, rngDraws: 0, budget: 0, rewards: 0 },
          });
        }
      }
    }
  }
  for (const [filepath, data] of [
    ['docs/prototypes/spectator-quiz-replays.json', { records }],
    ['docs/prototypes/spectator-quiz-comparison.json', { limits: SPECTATOR_QUIZ_LIMITS, rows }],
  ])
    await writeFile(
      filepath,
      await format(JSON.stringify(data), { ...(await resolveConfig(filepath)), filepath }),
    );
  console.table(
    records.map(({ replay, advances }) => ({
      seed: replay.seed,
      advances,
      frames: replay.keyframes.length,
      status: replay.outcome.status,
      delivered: replay.outcome.score,
      firstResult: replay.keyframes[1].frame.totals.delivered,
    })),
  );
  console.log(`${rows.length} comparisons: parser / resume / source unchanged`);
} finally {
  await server.close();
}
