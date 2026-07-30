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

const KNOWN_FLAGS = new Set(['--json', '--fail-if-incomplete', '--all', '--epic']);

function parseArgs(raw) {
  const flags = new Set();
  let epic = null;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--epic') {
      const v = raw[i + 1];
      if (!v || v.startsWith('--')) {
        console.error('missing value for --epic');
        process.exit(1);
      }
      epic = v;
      i++;
      continue;
    }
    if (!a.startsWith('--')) {
      console.error(`unexpected argument: ${a}`);
      process.exit(1);
    }
    if (!KNOWN_FLAGS.has(a)) {
      console.error(`unknown option: ${a}`);
      console.error(`known options: ${[...KNOWN_FLAGS].sort().join(', ')}`);
      process.exit(1);
    }
    flags.add(a);
  }
  return { flags, epic };
}

const { flags, epic: epicFlag } = parseArgs(argv);
const asJson = flags.has('--json');
const failIfIncomplete = flags.has('--fail-if-incomplete');
const allEpics = flags.has('--all');

function readPlanText() {
  if (!fs.existsSync(planPath)) return '';
  return fs.readFileSync(planPath, 'utf8');
}

function readCurrentEpic(planText = readPlanText()) {
  const m = planText.match(/ベースライン（エピック）:\s*\*\*(RI-\d+)\*\*/);
  return m?.[1] ?? null;
}

/** RI-{N}-{GROUP}{SEQ} を数値順に並べる（A10 が A2 より後） */
function compareUnitId(a, b) {
  const pa = a.match(/^RI-(\d+)-([A-Z])(\d+)$/);
  const pb = b.match(/^RI-(\d+)-([A-Z])(\d+)$/);
  if (!pa || !pb) return a.localeCompare(b, 'en');
  const n = Number(pa[1]) - Number(pb[1]);
  if (n !== 0) return n;
  const g = pa[2].localeCompare(pb[2], 'en');
  if (g !== 0) return g;
  return Number(pa[3]) - Number(pb[3]);
}

/**
 * 静的索引の単位リンクを検証しつつ ID を集める。
 * 単位 ID ラベルのリンクを起点に、リンク先が ./mutation-units/<ID>.md であることを検査する。
 */
function readIndexedUnits(planText = readPlanText()) {
  const ids = new Set();
  const badLinks = [];
  for (const m of planText.matchAll(/\[(RI-\d+-[A-Z]\d+)\]\(([^)]*)\)/g)) {
    const labelId = m[1];
    const href = m[2].trim();
    ids.add(labelId);
    const expected = `./mutation-units/${labelId}.md`;
    if (href === expected) {
      continue;
    }
    const unitHref = href.match(/^\.\/mutation-units\/(RI-\d+-[A-Z]\d+)\.md$/);
    if (unitHref) {
      badLinks.push({
        label: labelId,
        href,
        reason: 'label-href-mismatch',
      });
      ids.add(unitHref[1]);
      continue;
    }
    badLinks.push({
      label: labelId,
      href,
      reason: 'invalid-id-or-href',
    });
  }
  return {
    indexedIds: [...ids].sort(compareUnitId),
    badLinks,
  };
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
  const basenameId = path.basename(filePath, '.md');
  const commentId =
    (text.match(/<!--\s*mutation-unit:\s*(RI-\d+-[A-Z]\d+)\s*-->/) || [])[1] || null;
  // 存在・欠落の正本はファイル名。コメントは整合チェック用。
  const id = basenameId;
  const title = (text.match(/^#\s+(RI-\d+-[A-Z]\d+)\s+[—-]\s+(.+)$/m) || [])[2]?.trim() || '';
  const status = (text.match(/\|\s*状態\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '不明';
  const targetCell = (text.match(/\|\s*対象\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '';
  const targets = parseTargets(targetCell);
  const after = (text.match(/^After:\s*(.+)$/m) || [])[1]?.trim() || '';
  return {
    id,
    basenameId,
    commentId,
    // 必須コメント欠落・不正・ファイル名不一致はすべて ID 不整合
    idMismatch: !commentId || commentId !== basenameId,
    epic: epicOfUnitId(basenameId),
    title,
    status,
    targets,
    /** @deprecated 互換用。複数対象は targets を使う */
    target: targets.join(', '),
    after,
    file: path.relative(root, filePath),
  };
}

/** 完了記録として受理できる After か（total/covered/S/NC が数値付きで揃っていること） */
function isRecordedAfter(after) {
  if (!after || !after.trim()) return false;
  const t = after.trim();
  // テンプレートの省略記号（… / ...）を含む行は未記録扱い
  if (/[…⋯]/.test(t) || /(^|[^\d])\.\.\.([^\d]|$)/.test(t)) return false;
  const hasTotal = /\btotal\s+\d+(\.\d+)?%/i.test(t);
  const hasCovered = /\bcovered\s+\d+(\.\d+)?%/i.test(t);
  const hasS = /\bS\s*=\s*\d+/i.test(t);
  const hasNc = /\bNC\s*=\s*\d+/i.test(t);
  return hasTotal && hasCovered && hasS && hasNc;
}

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

const planText = readPlanText();
const currentEpic = allEpics ? null : (epicFlag ?? readCurrentEpic(planText));
if (!allEpics && !currentEpic) {
  console.error(
    'could not determine current epic from plan/mutation-remediation.md; pass --epic RI-N or --all',
  );
  process.exit(1);
}

const { indexedIds: allIndexedIds, badLinks } = readIndexedUnits(planText);
const indexedIds = allIndexedIds.filter((id) => allEpics || epicOfUnitId(id) === currentEpic);

const units = fs
  .readdirSync(unitsDir)
  .filter((name) => /^RI-\d+-[A-Z]\d+\.md$/.test(name))
  .map((name) => parseUnit(path.join(unitsDir, name)))
  .filter((u) => allEpics || u.epic === currentEpic)
  .sort((a, b) => compareUnitId(a.basenameId, b.basenameId));

const presentIds = new Set(units.map((u) => u.basenameId));
const indexedIdSet = new Set(indexedIds);
const missingIds = indexedIds.filter((id) => !presentIds.has(id));
const orphanIds = units.map((u) => u.basenameId).filter((id) => !indexedIdSet.has(id));
const idMismatches = units.filter((u) => u.idMismatch);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        unitsDir: path.relative(root, unitsDir),
        epic: allEpics ? null : currentEpic,
        scope: allEpics ? 'all' : 'epic',
        indexedIds,
        missingIds,
        orphanIds,
        badLinks,
        idMismatches: idMismatches.map((u) => ({
          file: u.file,
          basenameId: u.basenameId,
          commentId: u.commentId,
        })),
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
  if (missingIds.length > 0) {
    console.log(`- 欠落（索引にあるがファイル名の .md なし）: ${missingIds.length}`);
  }
  if (orphanIds.length > 0) {
    console.log(`- orphan（ファイルはあるが索引にない）: ${orphanIds.length}`);
  }
  if (idMismatches.length > 0) {
    console.log(`- ID不一致（ファイル名≠コメント、またはコメント欠落）: ${idMismatches.length}`);
  }
  if (badLinks.length > 0) {
    console.log(`- 索引リンク不正: ${badLinks.length}`);
  }
  console.log('');
  console.log('| ID | 状態 | 対象 | After |');
  console.log('| --- | --- | --- | --- |');
  for (const u of units) {
    const after = u.after.replace(/\|/g, '\\|');
    const target = u.targets.map((t) => `\`${t}\``).join(', ') || '—';
    let status = u.status;
    if (u.idMismatch) {
      status = u.commentId
        ? `${u.status}（ID不一致:${u.commentId}）`
        : `${u.status}（mutation-unitコメント欠落）`;
    } else if (orphanIds.includes(u.basenameId)) {
      status = `${u.status}（索引なし）`;
    }
    console.log(`| ${u.basenameId} | ${status} | ${target} | ${after} |`);
  }
  for (const id of missingIds) {
    console.log(`| ${id} | 欠落 | — | — |`);
  }
}

if (failIfIncomplete) {
  const incomplete = units.filter((u) => u.status !== '完了');
  const missingAfter = units.filter((u) => u.status === '完了' && !isRecordedAfter(u.after));
  const problems = [];
  if (indexedIds.length === 0) {
    problems.push('indexed units: 0 (static index has no unit links for this scope)');
  }
  if (badLinks.length > 0) {
    problems.push(
      `bad index links: ${badLinks.map((b) => `[${b.label}](${b.href}) (${b.reason})`).join(', ')}`,
    );
  }
  if (missingIds.length > 0) {
    problems.push(`missing files: ${missingIds.map((id) => `${id}.md`).join(', ')}`);
  }
  if (orphanIds.length > 0) {
    problems.push(`orphan files (not in index): ${orphanIds.map((id) => `${id}.md`).join(', ')}`);
  }
  if (idMismatches.length > 0) {
    problems.push(
      `id mismatch: ${idMismatches
        .map((u) =>
          u.commentId
            ? `${u.basenameId}.md comment=${u.commentId}`
            : `${u.basenameId}.md comment=missing`,
        )
        .join(', ')}`,
    );
  }
  if (incomplete.length > 0) {
    problems.push(`incomplete: ${incomplete.map((u) => `${u.id}(${u.status})`).join(', ')}`);
  }
  if (missingAfter.length > 0) {
    problems.push(`missing/placeholder After: ${missingAfter.map((u) => u.id).join(', ')}`);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.join('\n')}`);
    process.exit(1);
  }
}
