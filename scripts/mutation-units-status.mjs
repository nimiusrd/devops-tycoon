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
/**
 * 索引・見出しから「RI らしい」ラベルを先に拾う（大文字小文字を問わない）。
 * ゼロ埋め・複数文字グループ・SEQ 欠落（RI-72-A / RI-72-AA1 / ri-72-A1 等）も含めてから妥当性検査する。
 */
const LOOSE_UNIT_ID_RE = /\b(RI-\d+-[A-Za-z][A-Za-z0-9]*)\b/i;

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
 * Markdown 表行をセルに分割する。
 * コードスパン内の `|` とエスケープ `\|` は列区切りにしない。
 */
function splitMarkdownTableCells(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  let i = line.startsWith('|') ? 1 : 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      i++;
      continue;
    }
    if (!inCode && ch === '\\' && line[i + 1] === '|') {
      cur += '\\|';
      i += 2;
      continue;
    }
    if (!inCode && ch === '|') {
      cells.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim() !== '' || !line.endsWith('|')) {
    cells.push(cur.trim());
  }
  return cells;
}

/** 索引タイトルと見出しタイトルの比較用（`\|` を `|` に戻し空白を正規化） */
function normalizeTitle(text) {
  return text.trim().replace(/\\\|/g, '|').replace(/\s+/g, ' ');
}

/**
 * 静的索引表の行から単位 ID・タイトル・対象列を集める。
 * 第1セルに RI らしいラベルがあればリンク構文の成否に関係なく検出し、
 * 不正形式・壊れた構文は badLinks へ（妥当な ID のみ indexedIds）。
 */
function readIndexedUnits(planText = readPlanText()) {
  const section = extractIndexSection(planText);
  const ids = new Set();
  const badLinks = [];
  /** @type {Map<string, string[]>} */
  const indexTargets = new Map();
  /** @type {Map<string, string>} */
  const indexTitles = new Map();

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

  function rememberMeta(label, title, targets) {
    indexTitles.set(label, title);
    indexTargets.set(label, targets);
  }

  for (const line of section.split('\n')) {
    if (!/^\|/.test(line)) continue;
    if (/^\|\s*[-:| ]+\s*\|/.test(line)) continue;
    if (/^\|\s*ID\s*\|/i.test(line)) continue;
    const cells = splitMarkdownTableCells(line);
    if (cells.length === 0) continue;
    const first = cells[0];
    if (!first) continue;
    const linkMatchEarly = first.match(/^\[([^\]]+)\]\(([^)]*)\)$/);
    const firstLabel = (linkMatchEarly ? linkMatchEarly[1] : first).trim();
    // 第1セルを候補として先に取り、RI らしい誤記（小文字化含む）を見落とさない
    const looksLikeUnitRow =
      LOOSE_UNIT_ID_RE.test(first) ||
      /mutation-units\//i.test(first) ||
      /^\[/.test(first) ||
      /^RI-/i.test(firstLabel);
    if (!looksLikeUnitRow) continue;
    const idMatch = firstLabel.match(LOOSE_UNIT_ID_RE) || first.match(LOOSE_UNIT_ID_RE);
    const label = idMatch ? idMatch[1] : firstLabel;
    const title = (cells[1] || '').trim();
    const targetCell = (cells[2] || '').trim();
    const targets = parseTargets(targetCell);

    if (!isValidUnitId(label)) {
      const href = linkMatchEarly ? linkMatchEarly[2].trim() : first;
      rememberId(label, href, 'invalid-unit-id', { index: false });
      continue;
    }

    const linkMatch = linkMatchEarly;
    if (!linkMatch) {
      if (rememberId(label, first, 'broken-link-syntax')) {
        rememberMeta(label, title, targets);
      }
      continue;
    }
    const linkLabel = linkMatch[1].trim();
    const href = linkMatch[2].trim();
    if (linkLabel !== label) {
      if (rememberId(label, href, 'invalid-unit-id')) {
        rememberMeta(label, title, targets);
      }
      continue;
    }
    if (ids.has(label)) {
      badLinks.push({ label, href, reason: 'duplicate-index-id' });
      continue;
    }
    ids.add(label);
    rememberMeta(label, title, targets);
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
    indexTitles,
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

/** 行頭の正規メタデータ行だけから値を取る（インライン例 `| 状態 | … |` は無視） */
function metaRowValues(text, label) {
  const re = new RegExp(`^\\|\\s*${label}\\s*\\|\\s*([^|\\n]*)\\|`, 'gm');
  return [...text.matchAll(re)].map((m) => m[1].trim());
}

/**
 * HTML コメントと fenced code block（``` / ~~~）を除いた本文。
 * コメントアウト／例示用コード内の進捗表・After を有効な記録として拾わない。
 */
function visibleUnitBody(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '');
}

function exactlyOneNonEmpty(values) {
  return values.length === 1 && values[0].length > 0;
}

function parseUnit(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const basenameId = path.basename(filePath, '.md');
  const unitComments = [...text.matchAll(/<!--\s*mutation-unit:\s*([^>]*?)\s*-->/g)].map((m) =>
    m[1].trim(),
  );
  const commentCount = unitComments.length;
  const commentId = commentCount === 1 && isValidUnitId(unitComments[0]) ? unitComments[0] : null;
  const commentAtStart = /^\s*<!--\s*mutation-unit:\s*[^>]*?-->/.test(text);
  // 進捗メタは HTML コメント／コードフェンス外の本文だけから読む
  const body = visibleUnitBody(text);
  // 存在・欠落の正本はファイル名。コメント・見出しは整合チェック用。
  const id = basenameId;
  const headingMatch = body.match(/^#\s+(RI-[1-9]\d*-[A-Z][1-9]\d*)\s+[—-]\s+(.+)$/m);
  const headingId = headingMatch?.[1] || null;
  const title = headingMatch?.[2]?.trim() || '';
  const statusValues = metaRowValues(body, '状態');
  const targetValues = metaRowValues(body, '対象');
  const baselineValues = metaRowValues(body, 'Baseline');
  const existingTestValues = metaRowValues(body, '既存テスト');
  const remeasureValues = metaRowValues(body, '再計測');
  const acceptanceValues = metaRowValues(body, '受入');
  const afterValues = [...body.matchAll(/^After:\s*(.+)$/gm)].map((m) => m[1].trim());
  const statusCount = statusValues.length;
  const targetCount = targetValues.length;
  const baselineCount = baselineValues.length;
  const existingTestCount = existingTestValues.length;
  const remeasureCount = remeasureValues.length;
  const acceptanceCount = acceptanceValues.length;
  const afterCount = afterValues.length;
  // 必須メタはちょうど1行かつ非空。After は0または1（完了時は別途必須）
  const metaDuplicate =
    statusCount !== 1 ||
    targetCount !== 1 ||
    baselineCount !== 1 ||
    afterCount > 1 ||
    !exactlyOneNonEmpty(existingTestValues) ||
    !exactlyOneNonEmpty(remeasureValues) ||
    !exactlyOneNonEmpty(acceptanceValues);
  const status = statusValues[0] || '不明';
  const targetCell = targetValues[0] || '';
  const targets = parseTargets(targetCell);
  const baseline = baselineValues[0] || '';
  const after = afterValues[0] || '';
  return {
    id,
    basenameId,
    commentId,
    commentCount,
    headingId,
    // コメントは先頭にちょうど1件。見出し・ファイル名とも一致必須。
    idMismatch:
      commentCount !== 1 ||
      !commentAtStart ||
      !commentId ||
      commentId !== basenameId ||
      !headingId ||
      headingId !== basenameId,
    metaDuplicate,
    metaCounts: {
      status: statusCount,
      target: targetCount,
      baseline: baselineCount,
      existingTest: existingTestCount,
      remeasure: remeasureCount,
      acceptance: acceptanceCount,
      after: afterCount,
      comment: commentCount,
    },
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
  // S/NC は件数。小数・指数・接尾辞（`7.5` / `7e3` / `7foo`）へ部分一致しない。
  const ncM = t.match(/\bNC\s*=\s*(\d+)(?![\w.])/i);
  const sM = t.match(/\bS\s*=\s*(\d+)(?![\w.])/i);
  if (!sM || !ncM) return false;
  const total = Number(totalM[1]);
  const nc = Number(ncM[1]);
  const s = Number(sM[1]);
  // covered n/a は NoCoverage のみ（total=0 / S=0 / NC>0）の Baseline に限定
  if (coveredNa) {
    return total === 0 && s === 0 && nc > 0;
  }
  // total 分母にだけ NC が載るため covered >= total。NC=0 なら両者は一致。
  const covered = Number(coveredPct[1]);
  if (covered < total) return false;
  if (nc === 0 && covered !== total) return false;
  return true;
}

/**
 * After 行の実測本体を抽出する。
 * 括弧注記や Before 併記に埋もれた参考値は使わず、未計測表記は拒否する。
 */
function afterPrimaryText(after) {
  if (!after) return '';
  if (/未計測|未測定/.test(after)) return '';
  // 全角／半角の注記括弧を除いた表層だけを実測本体とする
  const primary = after
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bBefore\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!primary || /未計測|未測定|参考値/.test(primary)) return '';
  // 実測は total が表層に残っていること（注記括弧内だけの数値は不可）
  if (!/\btotal\s+\d/i.test(primary)) return '';
  return primary;
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
  indexTitles: allIndexTitles,
} = readIndexedUnits(planText);
const indexedIds = allIndexedIds.filter((id) => allEpics || epicOfUnitId(id) === currentEpic);
const badLinks = skipIndexIntegrity ? [] : allBadLinks;
// 現行索引に別エピック ID が混入していたら拒否（フィルタで黙って落とさない）
const foreignIndexIds = skipIndexIntegrity
  ? []
  : allIndexedIds.filter((id) => epicOfUnitId(id) !== currentEpic).sort(compareUnitId);

// README 以外の .md を列挙し、妥当な単位 ID 以外は不正ファイルとして扱う
const candidateNames = fs
  .readdirSync(unitsDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md');
// 不正 ID はエピック・スコープ判定より先にすべて拾う（RI-072-A1 のようなゼロ埋めを黙殺しない）
const invalidIdFiles = candidateNames
  .map((name) => name.slice(0, -'.md'.length))
  .filter((id) => !isValidUnitId(id))
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
const metaDuplicates = units.filter((u) => u.metaDuplicate);
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
const titleMismatches = skipIndexIntegrity
  ? []
  : units
      .filter((u) => indexedIdSet.has(u.basenameId))
      .filter(
        (u) =>
          normalizeTitle(allIndexTitles.get(u.basenameId) || '') !== normalizeTitle(u.title || ''),
      )
      .map((u) => ({
        id: u.basenameId,
        index: allIndexTitles.get(u.basenameId) || '',
        unit: u.title || '',
      }));
const emptyTargets = units.filter((u) => u.targets.length === 0).map((u) => u.basenameId);
const emptyIndexTargets = skipIndexIntegrity
  ? []
  : indexedIds.filter((id) => (allIndexTargets.get(id) || []).length === 0);

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
          commentCount: u.commentCount,
          headingId: u.headingId,
        })),
        foreignIndexIds,
        metaDuplicates: metaDuplicates.map((u) => ({
          id: u.basenameId,
          counts: u.metaCounts,
        })),
        targetMismatches,
        titleMismatches,
        emptyTargets,
        emptyIndexTargets,
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
  if (metaDuplicates.length > 0) {
    console.log(`- メタデータ行の重複／欠落: ${metaDuplicates.length}`);
  }
  if (foreignIndexIds.length > 0) {
    console.log(`- 索引の別エピック混入: ${foreignIndexIds.length}`);
  }
  if (targetMismatches.length > 0) {
    console.log(`- 対象不一致（索引≠単位ファイル）: ${targetMismatches.length}`);
  }
  if (emptyTargets.length > 0 || emptyIndexTargets.length > 0) {
    console.log(
      `- 対象が空: 単位=${emptyTargets.length}` +
        (skipIndexIntegrity ? '' : ` / 索引=${emptyIndexTargets.length}`),
    );
  }
  if (titleMismatches.length > 0) {
    console.log(`- タイトル不一致（索引≠見出し）: ${titleMismatches.length}`);
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
      if (u.commentCount !== 1) bits.push(`コメント数=${u.commentCount}`);
      else if (!u.commentId) bits.push('コメント不正');
      else if (u.commentId !== u.basenameId) bits.push(`コメント=${u.commentId}`);
      if (!u.headingId) bits.push('見出し欠落');
      else if (u.headingId !== u.basenameId) bits.push(`見出し=${u.headingId}`);
      status = `${u.status}（ID不一致:${bits.join(', ')}）`;
    } else if (orphanIds.includes(u.basenameId)) {
      status = `${u.status}（索引なし）`;
    } else if (emptyTargets.includes(u.basenameId)) {
      status = `${u.status}（対象空）`;
    } else if (targetMismatches.some((m) => m.id === u.basenameId)) {
      status = `${u.status}（対象不一致）`;
    } else if (u.metaDuplicate) {
      status = `${u.status}（メタ重複）`;
    } else if (titleMismatches.some((m) => m.id === u.basenameId)) {
      status = `${u.status}（タイトル不一致）`;
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
  if (foreignIndexIds.length > 0) {
    problems.push(
      `foreign epic ids in current index: ${foreignIndexIds.join(', ')} (expected ${currentEpic} only)`,
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
          bits.push(`comments=${u.commentCount}`);
          bits.push(u.commentId ? `comment=${u.commentId}` : 'comment=missing');
          bits.push(u.headingId ? `heading=${u.headingId}` : 'heading=missing');
          return `${u.basenameId}.md (${bits.join(', ')})`;
        })
        .join(', ')}`,
    );
  }
  if (metaDuplicates.length > 0) {
    problems.push(
      `duplicate/missing metadata rows: ${metaDuplicates
        .map((u) => {
          const c = u.metaCounts;
          return `${u.basenameId}.md (状態=${c.status}, 対象=${c.target}, Baseline=${c.baseline}, 既存テスト=${c.existingTest}, 再計測=${c.remeasure}, 受入=${c.acceptance}, After=${c.after})`;
        })
        .join(', ')}`,
    );
  }
  if (emptyTargets.length > 0) {
    problems.push(`empty targets: ${emptyTargets.map((id) => `${id}.md`).join(', ')}`);
  }
  if (emptyIndexTargets.length > 0) {
    problems.push(`empty index targets: ${emptyIndexTargets.join(', ')}`);
  }
  if (targetMismatches.length > 0) {
    problems.push(
      `target mismatch: ${targetMismatches
        .map((m) => `${m.id} index=[${m.index.join(', ')}] unit=[${m.unit.join(', ')}]`)
        .join('; ')}`,
    );
  }
  if (titleMismatches.length > 0) {
    problems.push(
      `title mismatch: ${titleMismatches
        .map((m) => `${m.id} index=${JSON.stringify(m.index)} unit=${JSON.stringify(m.unit)}`)
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
