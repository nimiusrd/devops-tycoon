import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FULLY_GENERATED_FILES = [
  'docs/generated/balance-parameters.md',
  'docs/generated/content-catalog.md',
  'docs/generated/balance-curves.svg',
];

export const PARTIALLY_GENERATED_FILES = [
  {
    path: 'docs/probability-model.md',
    begin: '<!-- balance-curve-endpoints:begin -->',
    end: '<!-- balance-curve-endpoints:end -->',
  },
];

export const GENERATED_FILES = [
  ...FULLY_GENERATED_FILES,
  ...PARTIALLY_GENERATED_FILES.map(({ path }) => path),
];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function countOccurrences(content, value) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(value, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + value.length;
  }
}

export function extractManagedRegion(content, { path, begin, end }) {
  const beginCount = countOccurrences(content, begin);
  const endCount = countOccurrences(content, end);
  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(
      `${path}の生成管理マーカーが不正です（begin=${beginCount}, end=${endCount}）。`,
    );
  }

  const beginIndex = content.indexOf(begin);
  const endIndex = content.indexOf(end);
  if (endIndex < beginIndex) {
    throw new Error(`${path}の生成管理マーカーの順序が不正です。`);
  }

  return content.slice(beginIndex, endIndex + end.length);
}

export function generatedContentMatches(path, baseline, current) {
  const partialFile = PARTIALLY_GENERATED_FILES.find((file) => file.path === path);
  if (!partialFile) return baseline === current;

  return extractManagedRegion(baseline, partialFile) === extractManagedRegion(current, partialFile);
}

function readIndexFile(path) {
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' });
}

function verifyGeneratedFiles() {
  for (const generatedFile of GENERATED_FILES) {
    run('git', ['ls-files', '--error-unmatch', '--', generatedFile]);
  }

  run('git', ['diff', '--exit-code', '--', ...FULLY_GENERATED_FILES]);

  for (const partialFile of PARTIALLY_GENERATED_FILES) {
    const baseline = readIndexFile(partialFile.path);
    const current = readFileSync(partialFile.path, 'utf8');
    if (!generatedContentMatches(partialFile.path, baseline, current)) {
      throw new Error(`${partialFile.path}の生成管理範囲が最新ではありません。`);
    }
  }
}

export function checkBalance() {
  run(process.execPath, ['scripts/generate-balance-docs.mjs']);
  verifyGeneratedFiles();
}

function main() {
  try {
    checkBalance();
  } catch {
    console.error(
      `バランス生成物が最新ではありません。\`npm run balance:docs\` を実行してください。`,
    );
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  main();
}
