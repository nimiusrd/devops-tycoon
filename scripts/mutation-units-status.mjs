#!/usr/bin/env node
/**
 * plan/mutation-units/RI-*.md から状態一覧を表示する（読み取り専用。共有 md は書き換えない）。
 *
 * Usage:
 *   node scripts/mutation-units-status.mjs
 *   node scripts/mutation-units-status.mjs --json
 *   node scripts/mutation-units-status.mjs --fail-if-incomplete
 *   node scripts/mutation-units-status.mjs --epic RI-72
 *   node scripts/mutation-units-status.mjs --all
 *
 * 既定は plan/mutation-remediation.md の現行エピックに属する単位のみ。
 * JSON を機械処理するときは npm バナーを避けるため node 直呼び、または
 * `npm run --silent mutation:units:status -- --json` を使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitsDir = path.join(root, 'plan', 'mutation-units');
const planPath = path.join(root, 'plan', 'mutation-remediation.md');
const argv = process.argv.slice(2);
const args = new Set(argv);
const asJson = args.has('--json');
const failIfIncomplete = args.has('--fail-if-incomplete');
const allEpics = args.has('--all');

function flagValue(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`missing value for ${name}`);
    process.exit(1);
  }
  return v;
}

function readCurrentEpic() {
  if (!fs.existsSync(planPath)) return null;
  const text = fs.readFileSync(planPath, 'utf8');
  const m = text.match(/ベースライン（エピック）:\s*\*\*(RI-\d+)\*\*/);
  return m?.[1] ?? null;
}

function epicOfUnitId(id) {
  const m = id.match(/^(RI-\d+)-[A-Z]\d+$/);
  return m?.[1] ?? null;
}

function parseTargets(targetCell) {
  const spans = [...targetCell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (spans.length > 0) return spans;
  const plain = targetCell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  if (!plain) return [];
  return plain
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseUnit(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const id =
    (text.match(/<!--\s*mutation-unit:\s*(RI-\d+-[A-Z]\d+)\s*-->/) || [])[1] ||
    path.basename(filePath, '.md');
  const title = (text.match(/^#\s+(RI-\d+-[A-Z]\d+)\s+[—-]\s+(.+)$/m) || [])[2]?.trim() || '';
  const status = (text.match(/\|\s*状態\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '不明';
  const targetCell = (text.match(/\|\s*対象\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '';
  const targets = parseTargets(targetCell);
  const after = (text.match(/^After:\s*(.+)$/m) || [])[1]?.trim() || '';
  return {
    id,
    epic: epicOfUnitId(id),
    title,
    status,
    targets,
    /** @deprecated 互換用。複数対象は targets を使う */
    target: targets.join(', '),
    after,
    file: path.relative(root, filePath),
  };
}

const epicFlag = flagValue('--epic');
if (epicFlag && !/^RI-\d+$/.test(epicFlag)) {
  console.error(`invalid --epic ${epicFlag} (expected RI-N)`);
  process.exit(1);
}
if (allEpics && epicFlag) {
  console.error('use either --all or --epic, not both');
  process.exit(1);
}

if (!fs.existsSync(unitsDir)) {
  console.error(`missing ${path.relative(root, unitsDir)}`);
  process.exit(1);
}

const currentEpic = allEpics ? null : (epicFlag ?? readCurrentEpic());
if (!allEpics && !currentEpic) {
  console.error(
    'could not determine current epic from plan/mutation-remediation.md; pass --epic RI-N or --all',
  );
  process.exit(1);
}

const units = fs
  .readdirSync(unitsDir)
  .filter((name) => /^RI-\d+-[A-Z]\d+\.md$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en'))
  .map((name) => parseUnit(path.join(unitsDir, name)))
  .filter((u) => allEpics || u.epic === currentEpic);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        unitsDir: path.relative(root, unitsDir),
        epic: allEpics ? null : currentEpic,
        scope: allEpics ? 'all' : 'epic',
        units,
      },
      null,
      2,
    ),
  );
} else {
  const counts = new Map();
  for (const u of units) counts.set(u.status, (counts.get(u.status) || 0) + 1);
  const scopeLabel = allEpics ? 'all epics' : currentEpic;
  console.log(`# mutation units (${units.length}) — ${scopeLabel}`);
  console.log('');
  for (const [status, n] of [...counts.entries()].sort()) {
    console.log(`- ${status}: ${n}`);
  }
  console.log('');
  console.log('| ID | 状態 | 対象 | After |');
  console.log('| --- | --- | --- | --- |');
  for (const u of units) {
    const after = u.after.replace(/\|/g, '\\|');
    const target = u.targets.map((t) => `\`${t}\``).join(', ') || '—';
    console.log(`| ${u.id} | ${u.status} | ${target} | ${after} |`);
  }
}

if (failIfIncomplete) {
  const incomplete = units.filter((u) => u.status !== '完了');
  if (incomplete.length > 0) {
    console.error(`\nincomplete: ${incomplete.map((u) => `${u.id}(${u.status})`).join(', ')}`);
    process.exit(1);
  }
}
