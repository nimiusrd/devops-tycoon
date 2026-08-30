import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEDULED_MUTATION_FILE_LIMIT = 5;

// ファイル全体を指定すると 60 分枠を超えることが実測済み、またはその可能性が高い対象。
// 自動実行せず Actions Summary へ出し、軽量な不変条件テストか手動の行レンジ指定で扱う。
export const SCHEDULED_MUTATION_HEAVY_FILES = Object.freeze([
  'src/sim/orgscale/teamState.ts',
  'src/sim/run/counterfactual.ts',
  'src/sim/run/engine.ts',
  'src/sim/run/quarterReview.ts',
  'src/sim/run/sprintBaseline.ts',
  'src/sim/sprint.ts',
]);

const CORE_FILE_RE = /^src\/(?:sim|state)\/.+\.ts$/;
const NON_PRODUCTION_RE = /(?:^|\/)(?:index|types)\.ts$|\.(?:test|spec)\.ts$/;

function normalizeFile(file) {
  return file.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export function planScheduledMutation(files, limit = SCHEDULED_MUTATION_FILE_LIMIT) {
  const changed = [...new Set(files.map(normalizeFile))]
    .filter((file) => CORE_FILE_RE.test(file) && !NON_PRODUCTION_RE.test(file))
    .sort();
  const heavy = changed.filter((file) => SCHEDULED_MUTATION_HEAVY_FILES.includes(file));
  const candidates = changed.filter((file) => !SCHEDULED_MUTATION_HEAVY_FILES.includes(file));
  const tooLarge = candidates.length > limit;
  const targets = tooLarge ? [] : candidates;
  const mutate = targets.join(',');

  return {
    changed,
    heavy,
    targets,
    tooLarge,
    needsAttention: heavy.length > 0 || tooLarge,
    mutate,
    cache: mutate ? createHash('sha256').update(mutate).digest('hex').slice(0, 12) : '',
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

function listOrNone(files) {
  return files.length === 0 ? ['- なし'] : files.map((file) => `- \`${file}\``);
}

function buildSummary(plan, base, head) {
  const lines = [
    '## Scheduled targeted Mutation',
    '',
    `- 比較元: \`${base}\``,
    `- 比較先: \`${head}\``,
    `- 自動実行上限: ${SCHEDULED_MUTATION_FILE_LIMIT}ファイル / 60分`,
    '',
    '### 自動実行対象',
    '',
    ...listOrNone(plan.targets),
  ];

  if (plan.heavy.length > 0) {
    lines.push(
      '',
      '### 自動実行から除外した重い対象',
      '',
      ...listOrNone(plan.heavy),
      '',
      '不変条件・境界値テスト、または手動の行レンジ指定で確認してください。',
    );
  }

  if (plan.tooLarge) {
    lines.push(
      '',
      '### 要確認',
      '',
      `対象が${SCHEDULED_MUTATION_FILE_LIMIT}ファイルを超えたため自動実行しません。`,
      '大規模変更として、必要な範囲を手動 targeted または full で確認してください。',
      '',
      ...listOrNone(plan.changed),
    );
  }

  if (plan.changed.length === 0) {
    lines.push('', '対象となるコアロジックの変更はありません。');
  }

  return `${lines.join('\n')}\n`;
}

function runCli() {
  const files = readFileSync(0, 'utf8').split(/\r?\n/);
  const plan = planScheduledMutation(files);
  const outputPath = argument('--github-output');
  const summaryPath = argument('--summary');
  const base = argument('--base') || 'unknown';
  const head = argument('--head') || 'unknown';

  if (outputPath) {
    appendFileSync(
      outputPath,
      [
        `mutate=${plan.mutate}`,
        `cache=${plan.cache}`,
        `target_count=${plan.targets.length}`,
        `needs_attention=${plan.needsAttention}`,
      ].join('\n') + '\n',
    );
  } else {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  }

  if (summaryPath) {
    appendFileSync(summaryPath, buildSummary(plan, base, head));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
