/**
 * Issue #906 Phase 1 比較ハーネス。本番 sim は書き換えない。
 *
 *   node scripts/compare-906.mjs --seeds a,b --conds base,c1,c3
 *
 * seed × 条件ごとに status / loseReason / quarter / sprintsPlayed /
 * 各スプリント後のシニア体力 / survive を表と JSON で出す。
 * 方針は naive、難易度 Easy、fresh meta 固定。
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

function printHelp() {
  console.log(`Usage:
  node scripts/compare-906.mjs --seeds seed1,seed2 [--conds base,c1,c3] [--json-out path] [--repeat n]

固定: Easy / fresh meta / POLICY_DEFS.naive
条件: base（現行） / c1（Easy seniorHpCostMul 0.68） / c3（初期編成に recruit-doc）
C2 は Kill 済みなので選べない。
`);
}

function parseArgs(argv) {
  const out = { seeds: [], conds: ['base', 'c1', 'c3'], jsonOut: null, repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--seeds') {
      out.seeds = String(argv[++i] ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      continue;
    }
    if (arg === '--conds') {
      out.condsRaw = String(argv[++i] ?? '');
      continue;
    }
    if (arg === '--json-out') {
      out.jsonOut = String(argv[++i] ?? '');
      continue;
    }
    if (arg === '--repeat') {
      out.repeat = Number(argv[++i]);
      continue;
    }
    throw new Error(`未知の引数: ${arg}`);
  }
  if (out.seeds.length === 0) {
    printHelp();
    throw new Error('--seeds が必要です');
  }
  if (!Number.isInteger(out.repeat) || out.repeat < 1) {
    throw new Error('--repeat は 1 以上の整数');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const { runCompare, formatTable, sameDraw, inspectC3Usage } = await server.ssrLoadModule(
    '/src/rd/issue906/compare.ts',
  );
  const { parseConditions } = await server.ssrLoadModule('/src/rd/issue906/variants.ts');
  const conds = parseConditions(args.condsRaw ?? args.conds.join(','));

  if (args.repeat === 1) {
    const result = runCompare(args.seeds, conds);
    const table = formatTable(result);
    console.log(table);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (args.jsonOut) writeFileSync(args.jsonOut, json);
    else console.log(json);
    const c3Rows = result.rows.filter((row) => row.cond === 'c3');
    if (c3Rows.length > 0) {
      console.log('c3-usage');
      const usages = c3Rows.map((row) => ({ seed: row.seed, ...inspectC3Usage(row) }));
      for (const usage of usages) {
        console.log(
          [
            usage.seed,
            `recruitDoc=${usage.startHasRecruitDoc}`,
            `startReview=${usage.startFourthOnReview}`,
            `reviewSprints=${usage.sprintsWithFourthOnReview}`,
            `doneSprints=${usage.sprintsWithReviewDone}`,
            `used=${usage.used}`,
          ].join('\t'),
        );
      }
      if (!usages.some((usage) => usage.used)) {
        console.error(
          'C3: recruit-doc が naive 方針でレビューレーンに使われていない。方針側は直さない。',
        );
        process.exitCode = 3;
      }
    }
  } else {
    const rounds = [];
    for (let i = 0; i < args.repeat; i += 1) {
      rounds.push(runCompare(args.seeds, conds));
    }
    const matches = [];
    for (let i = 1; i < rounds.length; i += 1) {
      for (let r = 0; r < rounds[0].rows.length; r += 1) {
        const a = rounds[0].rows[r];
        const b = rounds[i].rows[r];
        matches.push({
          seed: a.seed,
          cond: a.cond,
          pass: sameDraw(a, b),
        });
      }
    }
    const payload = {
      repeat: args.repeat,
      allMatch: matches.every((m) => m.pass),
      matches,
      first: rounds[0],
    };
    console.log(formatTable(rounds[0]));
    console.log(`same-draw\tallMatch=${payload.allMatch}\tcomparisons=${matches.length}`);
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    if (args.jsonOut) writeFileSync(args.jsonOut, json);
    else console.log(json);
    if (!payload.allMatch) process.exitCode = 2;
  }
} finally {
  await server.close();
}
