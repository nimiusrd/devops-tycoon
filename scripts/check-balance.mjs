import { execFileSync } from 'node:child_process';

const GENERATED_FILE = 'plan/generated/balance-parameters.md';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

try {
  run(process.execPath, ['scripts/generate-balance-docs.mjs']);
  run('git', ['ls-files', '--error-unmatch', '--', GENERATED_FILE]);
  run('git', ['diff', '--exit-code', '--', GENERATED_FILE]);
} catch {
  console.error(
    `バランスパラメータ表が最新ではありません。\`npm run balance:docs\` を実行してください。`,
  );
  process.exitCode = 1;
}
