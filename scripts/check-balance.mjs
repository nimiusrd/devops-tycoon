import { execFileSync } from 'node:child_process';

const GENERATED_FILES = [
  'plan/generated/balance-parameters.md',
  'plan/generated/content-catalog.md',
];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

try {
  run(process.execPath, ['scripts/generate-balance-docs.mjs']);
  for (const generatedFile of GENERATED_FILES) {
    run('git', ['ls-files', '--error-unmatch', '--', generatedFile]);
  }
  run('git', ['diff', '--exit-code', '--', ...GENERATED_FILES]);
} catch {
  console.error(
    `バランス生成物が最新ではありません。\`npm run balance:docs\` を実行してください。`,
  );
  process.exitCode = 1;
}
