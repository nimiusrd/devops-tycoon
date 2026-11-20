import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const seeds = Array.from({ length: 12 }, (_, index) => `RI-204:${index + 1}`);
const mixes = [0, 2, 4];
const server = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

try {
  const { createComplementaryRoster, createComplementarySprint, runComplementarySprint } =
    await server.ssrLoadModule('/src/prototypes/complementaryTraits.ts');
  const paired = createComplementaryRoster('paired');
  const swapped = createComplementaryRoster('swapped');
  const { sprint, org } = createComplementarySprint(paired, seeds[0], 0, false);
  const cases = seeds.map((seed) => ({
    seed,
    highValueTaskIds: createComplementarySprint(paired, seed, 0, false)
      .sprint.tasks.filter((task) => task.highValue)
      .map((task) => task.id),
    runs: mixes.map((complexPerFour) => ({
      complexPerFour,
      paired: runComplementarySprint(paired, seed, complexPerFour, true),
      pairedWithoutBonus: runComplementarySprint(paired, seed, complexPerFour, false),
      swapped: runComplementarySprint(swapped, seed, complexPerFour, true),
    })),
  }));
  const metrics = ['delivered', 'done', 'rework', 'incidents', 'ticks', 'reviewQueueMax'];
  const meanByMix = mixes.map((complexPerFour, index) => ({
    complexPerFour,
    ...Object.fromEntries(
      ['paired', 'pairedWithoutBonus', 'swapped'].map((layout) => [
        layout,
        Object.fromEntries(
          metrics.map((metric) => {
            const total = cases.reduce((sum, item) => sum + item.runs[index][layout][metric], 0);
            return [metric, Number((total / cases.length).toFixed(2))];
          }),
        ),
      ]),
    ),
  }));
  const artifact = {
    roster: paired,
    swappedAssignments: swapped.members.map(({ id, assignment }) => ({ id, assignment })),
    org,
    config: sprint.config,
    taskMix: 'task.id % 4 < complexPerFour のとき complex。その他は normal。',
    input: '開始前に配置と補正有無を決め、終了まで介入なし。',
    staminaOrder: paired.members.map(({ id }) => id),
    meanByMix,
    cases,
  };
  const filepath = 'docs/prototypes/complementary-traits-comparison.json';
  await writeFile(
    filepath,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(filepath)), filepath }),
  );
  console.log(JSON.stringify(meanByMix, null, 2));
} finally {
  await server.close();
}
