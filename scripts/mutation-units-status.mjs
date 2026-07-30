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
/** SEQ は1起算・ゼロ埋めなし。エピック番号も先頭ゼロなし。 */
const UNIT_ID_RE = /^RI-[1-9]\d*-[A-Z][1-9]\d*$/;
/** 索引・見出しから「RI らしい」ラベルを先に拾う（ゼロ埋め等の不正形式も含む） */
const LOOSE_UNIT_ID_RE = /\b(RI-\d+-[A-Z]\d+)\b/;

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

function isValidUnitId(id) {
  return UNIT_ID_RE.test(id);
}

function readPlanText() {
  if (!fs.existsSync(planPath)) return '';
  return fs.readFileSync(planPath, 'utf8');
}

function readCurrentEpic(planText = readPlanText()) {
  const m = planText.match(/ベースライン（エピック）:\s*\*\*(RI-\d+)\*\*/);
  return m?.[1] ?? null;
}

/** §5 静的索引セクションだけを切り出す */
function extractIndexSection(planText) {
  const start = planText.search(/^## 5\.\s+実装単位一覧/m);
  if (start < 0) return '';
  const rest = planText.slice(start);
  const next = rest.search(/\n## (?!5\.)/);
  return next < 0 ? rest : rest.slice(0, next);
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
 * 静的索引表の行から単位 ID と対象列を集める。
 * 第1セルに RI らしいラベルがあればリンク構文の成否に関係なく検出し、
 * 不正形式・壊れた構文は badLinks へ（妥当な ID のみ indexedIds）。
 */
function readIndexedUnits(planText = readPlanText()) {
  const section = extractIndexSection(planText);
  const ids = new Set();
  const badLinks = [];
  /** @type {Map<string, string[]>} */
  const indexTargets = new Map();

  function rememberId(label, href, reason, { index = true } = {}) {
    if (index) {
      if (ids.has(label)) {
        badLinks.push({ label, href, reason: 'duplicate-index-id' });
        return false;
      }
      ids.add(label);
    }
    if (reason) badLinks.push({ label, href, reason });
    return true;
  }

  for (const line of section.split('\n')) {
    if (!/^\|/.test(line)) continue;
    if (/^\|\s*[-:| ]+\s*\|/.test(line)) continue;
    if (/^\|\s*ID\s*\|/i.test(line)) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length === 0) continue;
    const first = cells[0].trim();
    const idMatch = first.match(LOOSE_UNIT_ID_RE);
    if (!idMatch) continue;
    const label = idMatch[1];
    const targetCell = (cells[2] || '').trim();
    const targets = parseTargets(targetCell);

    if (!isValidUnitId(label)) {
      const looseLink = first.match(/^\[([^\]]+)\]\(([^)]*)\)$/);
      rememberId(label, looseLink ? looseLink[2].trim() : first, 'invalid-unit-id', {
        index: false,
      });
      continue;
    }

    const linkMatch = first.match(/^\[([^\]]+)\]\(([^)]*)\)$/);
    if (!linkMatch) {
      if (rememberId(label, first, 'broken-link-syntax')) {
        indexTargets.set(label, targets);
      }
      continue;
    }
    const linkLabel = linkMatch[1].trim();
    const href = linkMatch[2].trim();
    if (linkLabel !== label) {
      if (rememberId(label, href, 'invalid-unit-id')) {
        indexTargets.set(label, targets);
      }
      continue;
    }
    if (ids.has(label)) {
      badLinks.push({ label, href, reason: 'duplicate-index-id' });
      continue;
    }
    ids.add(label);
    indexTargets.set(label, targets);
    const expected = `./mutation-units/${label}.md`;
    if (href === expected) {
      continue;
    }
    const unitHref = href.match(/^\.\/mutation-units\/(RI-[1-9]\d*-[A-Z][1-9]\d*)\.md$/);
    if (unitHref) {
      badLinks.push({ label, href, reason: 'label-href-mismatch' });
      if (!ids.has(unitHref[1])) ids.add(unitHref[1]);
      continue;
    }
    badLinks.push({ label, href, reason: 'invalid-id-or-href' });
  }
  return {
    indexedIds: [...ids].sort(compareUnitId),
    badLinks,
    indexTargets,
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

function sameTargets(a, b) {
  const norm = (xs) =>
    [...xs]
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join('\0');
  return norm(a) === norm(b);
}

function parseUnit(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const basenameId = path.basename(filePath, '.md');
  const commentId =
    (text.match(/<!--\s*mutation-unit:\s*(RI-[1-9]\d*-[A-Z][1-9]\d*)\s*-->/) || [])[1] || null;
  // 存在・欠落の正本はファイル名。コメント・見出しは整合チェック用。
  const id = basenameId;
  const headingMatch = text.match(/^#\s+(RI-[1-9]\d*-[A-Z][1-9]\d*)\s+[—-]\s+(.+)$/m);
  const headingId = headingMatch?.[1] || null;
  const title = headingMatch?.[2]?.trim() || '';
  const status = (text.match(/\|\s*状態\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '不明';
  const targetCell = (text.match(/\|\s*対象\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '';
  const targets = parseTargets(targetCell);
  const baseline = (text.match(/\|\s*Baseline\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim() || '';
  const after = (text.match(/^After:\s*(.+)$/m) || [])[1]?.trim() || '';
  return {
    id,
    basenameId,
    commentId,
    headingId,
    // コメント／見出しの欠落・不正・ファイル名不一致はすべて ID 不整合
    idMismatch: !commentId || commentId !== basenameId || !headingId || headingId !== basenameId,
    epic: epicOfUnitId(basenameId),
    title,
    status,
    targets,
    /** @deprecated 互換用。複数対象は targets を使う */
    target: targets.join(', '),
    baseline,
    after,
    file: path.relative(root, filePath),
  };
}

/** Baseline / After の score 指標が揃っているか */
/** total / covered の % が 0–100 の範囲内か */
function isPercentInRange(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function hasRequiredMetrics(text, { allowCoveredNa = false } = {}) {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  if (/[…⋯]/.test(t) || /(^|[^\d])\.\.\.([^\d]|$)/.test(t)) return false;
  const totalM = t.match(/\btotal\s+(\d+(?:\.\d+)?)%/i);
  if (!totalM || !isPercentInRange(totalM[1])) return false;
  const coveredPct = t.match(/\bcovered\s+(\d+(?:\.\d+)?)%/i);
  const coveredNa = allowCoveredNa && /\bcovered\s+n\/a\b/i.test(t);
  if (!coveredNa && (!coveredPct || !isPercentInRange(coveredPct[1]))) return false;
  const ncM = t.match(/\bNC\s*=\s*(\d+)/i);
  const hasS = /\bS\s*=\s*\d+/i.test(t);
  if (!hasS || !ncM) return false;
  // total 分母にだけ NC が載るため covered >= total。NC=0 なら両者は一致。
  if (!coveredNa) {
    const total = Number(totalM[1]);
    const covered = Number(coveredPct[1]);
    const nc = Number(ncM[1]);
    if (covered < total) return false;
    if (nc === 0 && covered !== total) return false;
  }
  return true;
}

/**
 * After 行のうち実測本体だけを取る。
 * 「Before …」以降の併記（比較用 Before 値）は拾わない。
 */
function afterPrimaryText(after) {
  if (!after) return '';
  const cut = after.search(/\bBefore\b/);
  return (cut < 0 ? after : after.slice(0, cut)).trim();
}

/** 完了記録として受理できる After か（本体に total/covered/S/NC が数値付きで揃っていること） */
function isRecordedAfter(after) {
  return hasRequiredMetrics(afterPrimaryText(after), { allowCoveredNa: false });
}

/** Baseline として受理できるか（covered は n/a も可: NoCoverage のみの初回など） */
function isRecordedBaseline(baseline) {
  return hasRequiredMetrics(baseline, { allowCoveredNa: true });
}

if (epicFlag && !/^RI-[1-9]\d*$/.test(epicFlag)) {
  console.error(`invalid --epic ${epicFlag} (expected RI-N without leading zeros)`);
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
const planCurrentEpic = readCurrentEpic(planText);
const currentEpic = allEpics ? null : (epicFlag ?? planCurrentEpic);
if (!allEpics && !currentEpic) {
  console.error(
    'could not determine current epic from plan/mutation-remediation.md; pass --epic RI-N or --all',
  );
  process.exit(1);
}
// 静的索引は現行エピックのみ保持する運用のため、--all または現行以外の --epic では
// 索引依存検査（欠落・orphan・索引0件・リンク不正）を抑止する。
const skipIndexIntegrity =
  allEpics || Boolean(epicFlag && planCurrentEpic && epicFlag !== planCurrentEpic);

const {
  indexedIds: allIndexedIds,
  badLinks: allBadLinks,
  indexTargets: allIndexTargets,
} = readIndexedUnits(planText);
const indexedIds = allIndexedIds.filter((id) => allEpics || epicOfUnitId(id) === currentEpic);
const badLinks = skipIndexIntegrity ? [] : allBadLinks;

const candidateNames = fs
  .readdirSync(unitsDir)
  .filter((name) => /^RI-.+\.md$/.test(name) && name !== 'README.md');
const invalidIdFiles = candidateNames
  .map((name) => name.slice(0, -'.md'.length))
  .filter((id) => !isValidUnitId(id))
  .filter((id) => allEpics || epicOfUnitId(id) === currentEpic || !epicOfUnitId(id))
  .sort(compareUnitId);

const units = candidateNames
  .filter((name) => isValidUnitId(name.slice(0, -'.md'.length)))
  .map((name) => parseUnit(path.join(unitsDir, name)))
  .filter((u) => allEpics || u.epic === currentEpic)
  .sort((a, b) => compareUnitId(a.basenameId, b.basenameId));

const presentIds = new Set(units.map((u) => u.basenameId));
const indexedIdSet = new Set(indexedIds);
const missingIds = skipIndexIntegrity ? [] : indexedIds.filter((id) => !presentIds.has(id));
// orphan は現行エピックの索引整合でのみ判定
const orphanIds = skipIndexIntegrity
  ? []
  : units.map((u) => u.basenameId).filter((id) => !indexedIdSet.has(id));
const idMismatches = units.filter((u) => u.idMismatch);
const targetMismatches = skipIndexIntegrity
  ? []
  : units
      .filter((u) => indexedIdSet.has(u.basenameId))
      .filter((u) => !sameTargets(allIndexTargets.get(u.basenameId) || [], u.targets))
      .map((u) => ({
        id: u.basenameId,
        index: allIndexTargets.get(u.basenameId) || [],
        unit: u.targets,
      }));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        unitsDir: path.relative(root, unitsDir),
        epic: allEpics ? null : currentEpic,
        planCurrentEpic,
        scope: allEpics ? 'all' : 'epic',
        indexIntegrity: !skipIndexIntegrity,
        indexedIds,
        missingIds,
        orphanIds,
        invalidIdFiles,
        badLinks,
        idMismatches: idMismatches.map((u) => ({
          file: u.file,
          basenameId: u.basenameId,
          commentId: u.commentId,
          headingId: u.headingId,
        })),
        targetMismatches,
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
  if (invalidIdFiles.length > 0) {
    console.log(`- 不正な単位IDファイル: ${invalidIdFiles.length}`);
  }
  if (idMismatches.length > 0) {
    console.log(`- ID不一致（ファイル名≠コメント／見出し、または欠落）: ${idMismatches.length}`);
  }
  if (targetMismatches.length > 0) {
    console.log(`- 対象不一致（索引≠単位ファイル）: ${targetMismatches.length}`);
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
      const bits = [];
      if (!u.commentId) bits.push('コメント欠落');
      else if (u.commentId !== u.basenameId) bits.push(`コメント=${u.commentId}`);
      if (!u.headingId) bits.push('見出し欠落');
      else if (u.headingId !== u.basenameId) bits.push(`見出し=${u.headingId}`);
      status = `${u.status}（ID不一致:${bits.join(', ')}）`;
    } else if (orphanIds.includes(u.basenameId)) {
      status = `${u.status}（索引なし）`;
    } else if (targetMismatches.some((m) => m.id === u.basenameId)) {
      status = `${u.status}（対象不一致）`;
    }
    console.log(`| ${u.basenameId} | ${status} | ${target} | ${after} |`);
  }
  for (const id of missingIds) {
    console.log(`| ${id} | 欠落 | — | — |`);
  }
  for (const id of invalidIdFiles) {
    console.log(`| ${id} | 不正ID | — | — |`);
  }
}

if (failIfIncomplete) {
  const incomplete = units.filter((u) => u.status !== '完了');
  const missingAfter = units.filter((u) => u.status === '完了' && !isRecordedAfter(u.after));
  const missingBaseline = units.filter((u) => !isRecordedBaseline(u.baseline));
  const problems = [];
  if (units.length === 0) {
    problems.push(
      `units: 0 (no unit files in scope ${allEpics ? 'all' : currentEpic}; refusing empty success)`,
    );
  }
  if (!skipIndexIntegrity && indexedIds.length === 0) {
    problems.push('indexed units: 0 (static index table has no unit links for this scope)');
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
  if (invalidIdFiles.length > 0) {
    problems.push(`invalid unit id files: ${invalidIdFiles.map((id) => `${id}.md`).join(', ')}`);
  }
  if (idMismatches.length > 0) {
    problems.push(
      `id mismatch: ${idMismatches
        .map((u) => {
          const bits = [`file=${u.basenameId}`];
          bits.push(u.commentId ? `comment=${u.commentId}` : 'comment=missing');
          bits.push(u.headingId ? `heading=${u.headingId}` : 'heading=missing');
          return `${u.basenameId}.md (${bits.join(', ')})`;
        })
        .join(', ')}`,
    );
  }
  if (targetMismatches.length > 0) {
    problems.push(
      `target mismatch: ${targetMismatches
        .map((m) => `${m.id} index=[${m.index.join(', ')}] unit=[${m.unit.join(', ')}]`)
        .join('; ')}`,
    );
  }
  if (incomplete.length > 0) {
    problems.push(`incomplete: ${incomplete.map((u) => `${u.id}(${u.status})`).join(', ')}`);
  }
  if (missingBaseline.length > 0) {
    problems.push(`missing/incomplete Baseline: ${missingBaseline.map((u) => u.id).join(', ')}`);
  }
  if (missingAfter.length > 0) {
    problems.push(`missing/placeholder After: ${missingAfter.map((u) => u.id).join(', ')}`);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.join('\n')}`);
    process.exit(1);
  }
}
