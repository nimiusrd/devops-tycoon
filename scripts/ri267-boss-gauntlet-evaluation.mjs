import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const {
    GAUNTLET_RULES,
    GAUNTLET_RULESET,
    gauntletPreset,
    createBossGauntlet,
    runGauntletPolicy,
    summarizeGauntlet,
  } = await server.ssrLoadModule('/src/prototypes/bossGauntlet.ts');
  const policies = [
    { reserve: 'first', recovery: 'skip' },
    { reserve: 'second', recovery: 'skip' },
    { reserve: 'first', recovery: 'recover' },
    { reserve: 'second', recovery: 'recover' },
  ];
  const conditions = [
    { name: 'baseline', rules: GAUNTLET_RULES },
    { name: 'more-work', rules: { ...GAUNTLET_RULES, taskCount: 48 } },
    { name: 'less-recovery', rules: { ...GAUNTLET_RULES, recoveryHp: 10 } },
    { name: 'expensive-recovery', rules: { ...GAUNTLET_RULES, recoveryCostCents: 1600 } },
    { name: 'expensive-time', rules: { ...GAUNTLET_RULES, tickCostCents: 20 } },
  ];
  const seeds = Array.from({ length: 8 }, (_, i) => `RI-267:${i + 1}`);
  const results = [];
  for (const condition of conditions)
    for (const seed of seeds)
      for (const build of ['speed', 'resilient'])
        for (const policy of policies) {
          const state = runGauntletPolicy(
            createBossGauntlet(gauntletPreset(build), seed, condition.rules),
            policy,
          );
          const summary = summarizeGauntlet(state);
          results.push({
            condition: condition.name,
            seed,
            build,
            policy,
            inputs: state.inputs,
            ...summary,
          });
        }
  const summary = conditions.flatMap((condition) =>
    ['speed', 'resilient'].flatMap((build) =>
      policies.map((policy) => {
        const rows = results.filter(
          (row) =>
            row.condition === condition.name &&
            row.build === build &&
            JSON.stringify(row.policy) === JSON.stringify(policy),
        );
        const mean = (values) =>
          Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
        return {
          condition: condition.name,
          build,
          policy,
          won: rows.filter((row) => row.phase === 'won').length,
          totalCostCents: mean(rows.map((row) => row.totalCostCents)),
          battles: [0, 1].map((index) => {
            const battles = rows.flatMap((row) => (row.battles[index] ? [row.battles[index]] : []));
            return {
              reached: battles.length,
              cleared: battles.filter((battle) => battle.cleared).length,
              ...(battles.length
                ? Object.fromEntries(
                    ['delivered', 'ticks', 'focusSpent', 'costCents'].map((key) => [
                      key,
                      mean(battles.map((battle) => battle[key])),
                    ]),
                  )
                : {}),
              ...(battles.length
                ? {
                    seniorHp: mean(battles.map((battle) => battle.after.seniorHp)),
                    techDebt: mean(battles.map((battle) => battle.after.techDebt)),
                    quality: mean(battles.map((battle) => battle.after.quality)),
                  }
                : {}),
            };
          }),
        };
      }),
    ),
  );
  const artifact = {
    ruleset: GAUNTLET_RULESET,
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri267-boss-gauntlet-evaluation.mjs',
    note: 'Fixed policy simulation only. Human play and adaptive behavior are not evaluated.',
    presets: ['speed', 'resilient'].map(gauntletPreset),
    seeds,
    conditions,
    policies,
    policy:
      'At tick 0 use reserve in designated battle; urgent firefight, else interrupt review at queue >= 4; tick. Choose paid recovery or skip once between victories.',
    summary,
    resultColumns: [
      'condition',
      'seed',
      'build',
      'policyIndex',
      'phase',
      'totalCostCents',
      'recoveryCostCents',
      'budgetCents',
      'reserveUsed',
      'recoveryUsed',
      'inputs',
      'battles',
    ],
    battleColumns: [
      'boss',
      'cleared',
      'reason',
      'ticks',
      'delivered',
      'done',
      'rework',
      'incidents',
      'spread',
      'focusSpent',
      'focusRemaining',
      'costCents',
      'before',
      'after',
    ],
    orgColumns: Object.keys(gauntletPreset('speed').org),
    results: results.map((row) => [
      row.condition,
      row.seed,
      row.build,
      policies.findIndex((p) => JSON.stringify(p) === JSON.stringify(row.policy)),
      row.phase,
      row.totalCostCents,
      row.recoveryCostCents,
      row.budgetCents,
      row.reserveUsed,
      row.recoveryUsed,
      row.inputs.join(' '),
      row.battles.map((battle) => [
        battle.boss,
        battle.cleared,
        battle.reason,
        battle.ticks,
        battle.delivered,
        battle.done,
        battle.rework,
        battle.incidents,
        battle.spread,
        battle.focusSpent,
        battle.focusRemaining,
        battle.costCents,
        Object.values(battle.before),
        Object.values(battle.after),
      ]),
    ]),
  };
  const destination = 'docs/prototypes/boss-gauntlet-comparison.json';
  await writeFile(
    destination,
    await format(JSON.stringify(artifact), {
      ...(await resolveConfig(destination)),
      filepath: destination,
    }),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await server.close();
}
