import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { ENDURANCE_RULES, ENDURANCE_SEEDS, evaluateEndurance } = await server.ssrLoadModule(
    '/src/prototypes/enduranceEconomy.ts',
  );
  const { BALANCE_RULESET_VERSION, BALANCE_RULESET_FINGERPRINT } = await server.ssrLoadModule(
    '/src/data/balance/index.ts',
  );
  const ruleset = {
    prototype: 'ri268-six-quarters-v1',
    balanceVersion: BALANCE_RULESET_VERSION,
    balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
    rules: ENDURANCE_RULES,
  };
  console.log(JSON.stringify({ ruleset }));
  for (const seed of ENDURANCE_SEEDS) {
    const { preVictory, comparisons, ...normal } = evaluateEndurance(seed);
    console.log(JSON.stringify({ type: 'normal', ...normal }));
    for (const quarter of preVictory) {
      console.log(JSON.stringify({ type: 'normal-quarter', seed, ...quarter }));
    }
    for (const { quarters, ...result } of comparisons) {
      console.log(JSON.stringify({ type: 'endurance', seed, ...result }));
      for (const quarter of quarters) {
        console.log(
          JSON.stringify({
            type: 'endurance-quarter',
            seed,
            policy: result.policy,
            quarterlyGrant: result.quarterlyGrant,
            ...quarter,
          }),
        );
      }
    }
  }
} finally {
  await server.close();
}
