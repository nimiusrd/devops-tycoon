#!/usr/bin/env node
/**
 * plan/mutation-units/RI-*.md から状態一覧を表示する（読み取り専用。共有 md は書き換えない）。
 *
 * Usage:
 *   node scripts/mutation-units-status.mjs
 *   node scripts/mutation-units-status.mjs --json
 *   node scripts/mutation-units-status.mjs --fail-if-incomplete
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitsDir = path.join(root, 'plan', 'mutation-units');
const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const failIfIncomplete = args.has('--fail-if-incomplete');

function parseUnit(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const id =
    (text.match(/<!--\s*mutation-unit:\s*(RI-\d+-[A-Z]\d+)\s*-->/) || [])[1] ||
    path.basename(filePath, '.md');
  const title = (text.match(/^#\s+(RI-\d+-[A-Z]\d+)\s+[—-]\s+(.+)$/m) || [])[2]?.trim() || '';
  const status = (text.match(/\|\s*状態\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '不明';
  const targetCell = (text.match(/\|\s*対象\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '';
  const target =
    (targetCell.match(/`([^`]+)`/) || [])[1] ||
    targetCell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const after = (text.match(/^After:\s*(.+)$/m) || [])[1]?.trim() || '';
  return { id, title, status, target, after, file: path.relative(root, filePath) };
}

if (!fs.existsSync(unitsDir)) {
  console.error(`missing ${path.relative(root, unitsDir)}`);
  process.exit(1);
}

const units = fs
  .readdirSync(unitsDir)
  .filter((name) => /^RI-\d+-[A-Z]\d+\.md$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en'))
  .map((name) => parseUnit(path.join(unitsDir, name)));

if (asJson) {
  console.log(JSON.stringify({ unitsDir: path.relative(root, unitsDir), units }, null, 2));
} else {
  const counts = new Map();
  for (const u of units) counts.set(u.status, (counts.get(u.status) || 0) + 1);
  console.log(`# mutation units (${units.length})`);
  console.log('');
  for (const [status, n] of [...counts.entries()].sort()) {
    console.log(`- ${status}: ${n}`);
  }
  console.log('');
  console.log('| ID | 状態 | 対象 | After |');
  console.log('| --- | --- | --- | --- |');
  for (const u of units) {
    const after = u.after.replace(/\|/g, '\\|');
    console.log(`| ${u.id} | ${u.status} | \`${u.target}\` | ${after} |`);
  }
}

if (failIfIncomplete) {
  const incomplete = units.filter((u) => u.status !== '完了');
  if (incomplete.length > 0) {
    console.error(`\nincomplete: ${incomplete.map((u) => `${u.id}(${u.status})`).join(', ')}`);
    process.exit(1);
  }
}
