import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// オープンな同一リポジトリのPRに、Codexの状態を表すラベルを一つだけ付ける。
// 現在のheadへの指摘なし判定か指摘あり判定があればそのラベルを付け、
// どちらの判定でもなければ未レビュー・レビュー中にする。
// フォークはラベルを外し、閉じたPRは変えない。

export const CODEX_LOGIN = 'chatgpt-codex-connector';
export const CODEX_BOT_LOGIN = `${CODEX_LOGIN}[bot]`;
export const NO_FINDINGS_PREFIX = "Codex Review: Didn't find any major issues";
export const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
const REVIEWED_COMMIT = /Reviewed commit:\*\* `([0-9a-f]{7,40})`/i;
const FINDINGS_REVIEW_STATES = new Set(['COMMENTED', 'CHANGES_REQUESTED']);
const MAX_ATTEMPTS = 3;

export const CODEX_REVIEW_LABELS = {
  clear: {
    name: 'codex/指摘なし',
    color: '0E8A16',
    description:
      'Codexが大きな指摘なしと判定し、その後はmainの取り込みだけで、Codexの未解決スレッドもない。詳細はActionsのCodex review label。',
  },
  findings: {
    name: 'codex/指摘あり',
    color: 'D93F0B',
    description:
      'ベース変更後の指摘レビューが現在のheadに適用できる。詳細はActionsのCodex review label。',
  },
  pending: {
    name: 'codex/未レビュー・レビュー中',
    color: 'FBCA04',
    description:
      '指摘なしにも指摘ありにも判定されていない。レビュー進行中も含む。詳細はActionsのCodex review label。',
  },
};

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved comments(first: 1) { nodes { author { login } } } }
      }
    }
  }
}`;

export function parseConcatenatedJson(raw) {
  const values = [];
  const text = String(raw);
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    const start = index;
    const opening = text[index];
    if (opening !== '{' && opening !== '[') {
      throw new Error(`JSONの開始位置が不正です: ${index}`);
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          values.push(JSON.parse(text.slice(start, index)));
          break;
        }
      }
    }
    if (depth !== 0) throw new Error('JSONが閉じていません');
  }
  return values;
}

export function latestBaseChange(events) {
  let latest = '';
  for (const event of events) {
    if (event?.event === 'base_ref_changed' && event.created_at > latest) latest = event.created_at;
  }
  return latest;
}

export function countUnresolvedCodexThreads(pages) {
  let count = 0;
  for (const page of pages) {
    const nodes = page?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    for (const node of nodes) {
      const author = node?.comments?.nodes?.[0]?.author?.login;
      if (node?.isResolved === false && author === CODEX_LOGIN) count += 1;
    }
  }
  return count;
}

export function extractNoFindings(comments) {
  return comments.flatMap((comment) => {
    if (comment?.user?.login !== CODEX_BOT_LOGIN || typeof comment.body !== 'string') return [];
    if (!comment.body.startsWith(NO_FINDINGS_PREFIX) || !comment.created_at) return [];
    const match = comment.body.match(REVIEWED_COMMIT);
    if (!match?.[1]) return [];
    return [{ at: comment.created_at, sha: match[1].toLowerCase() }];
  });
}

export function extractReviews(reviews) {
  return reviews.flatMap((review) => {
    if (review?.user?.login !== CODEX_BOT_LOGIN || !review.submitted_at) return [];
    return [
      {
        at: review.submitted_at,
        sha: typeof review.commit_id === 'string' ? review.commit_id.toLowerCase() : '',
        state: review.state ?? '',
      },
    ];
  });
}

export function latestCodexSummary(comments) {
  const summaries = comments.filter(
    (comment) =>
      comment?.user?.login === CODEX_BOT_LOGIN &&
      typeof comment.body === 'string' &&
      comment.body.includes(SUMMARY_MARKER),
  );
  summaries.sort((left, right) =>
    compareTimeDescending(left.updated_at ?? '', right.updated_at ?? ''),
  );
  return summaries[0] ?? null;
}

export function summaryIsInProgress(body) {
  return /\*\*(?:Running|Queued)\*\*/.test(body);
}

export function summaryStatusToken(body) {
  return (body.match(/\*\*(?:Running|Queued|Completed|Failed)\*\*/g) ?? []).join(',');
}

export function extractSummaryRows(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const name = cells[0].match(/\*\*([^*]+)\*\*/)?.[1] ?? '';
    const status = cells[1].match(/\*\*(Running|Queued|Completed|Failed)\*\*/i)?.[1] ?? '';
    const sha = cells[2].match(/`([0-9a-f]{7,40})`/i)?.[1]?.toLowerCase() ?? '';
    const dated =
      cells[1].match(/datetime="([^"]+)"/) ??
      cells[1].match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
    if (!name || !status || !sha) continue;
    rows.push({ name, status: status.toLowerCase(), at: dated?.[1] ?? '', sha });
  }
  return rows;
}

export function extractCompletedRows(body) {
  const rows = extractSummaryRows(body);
  const codeReviews = rows.filter((row) => row.name === 'Code Review');
  if (codeReviews.some((row) => row.status === 'failed')) return [];
  return codeReviews
    .filter((row) => row.status === 'completed' && row.at)
    .map((row) => ({ at: row.at, sha: row.sha }));
}

export function isAfter(left, right) {
  if (!right) return Boolean(left);
  if (!left) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return leftMs > rightMs;
  return left > right;
}

function compareTimeDescending(left, right) {
  if (isAfter(left, right)) return -1;
  if (isAfter(right, left)) return 1;
  return 0;
}

function newestCovering(candidates, covers) {
  const sorted = [...candidates].sort((left, right) => compareTimeDescending(left.at, right.at));
  for (const candidate of sorted) {
    const fullSha = covers(candidate.sha);
    if (fullSha) return { at: candidate.at, sha: fullSha };
  }
  return null;
}

export function chooseCodexReviewLabel({
  fork,
  inProgress,
  cleanAt,
  latestReviewAt,
  findingsCoverAt,
  unresolved,
}) {
  if (fork) return 'none';
  if (inProgress) return 'pending';
  const reviewAfterClean = cleanAt !== '' && isAfter(latestReviewAt, cleanAt);
  if (cleanAt !== '' && !reviewAfterClean && unresolved === 0) return 'clear';
  // 未解決スレッドだけでは指摘ありにしない。headへ適用できる指摘レビューがあるときだけ指摘あり。
  if (
    findingsCoverAt !== '' &&
    (cleanAt === '' || isAfter(findingsCoverAt, cleanAt) || unresolved > 0)
  ) {
    return 'findings';
  }
  return 'pending';
}

export function evaluateCodexReviewLabel({
  fork,
  inProgress,
  unresolved,
  baseChangedAt,
  noFindings,
  summaryCompleted = [],
  reviews,
  covers,
}) {
  const since = baseChangedAt || '';
  const afterBaseChange = (item) => isAfter(item.at, since);
  const commentClean = newestCovering(noFindings.filter(afterBaseChange), covers);
  const findings = newestCovering(
    reviews.filter(
      (item) => item.sha && afterBaseChange(item) && FINDINGS_REVIEW_STATES.has(item.state),
    ),
    covers,
  );
  // 指摘コメントがない完了は、サマリーの Completed 行で表される。
  // 同じコミットの指摘レビューは、サマリー更新が数秒遅れても指摘ありのままにする。
  const summaryClean = newestCovering(summaryCompleted.filter(afterBaseChange), covers);
  const summaryMatchesDismissedReview =
    summaryClean &&
    reviews.some(
      (item) =>
        item.state === 'DISMISSED' &&
        item.sha &&
        afterBaseChange(item) &&
        covers(item.sha) === summaryClean.sha,
    );
  // dismiss 済みの指摘と同じコミットの完了サマリーは、指摘なしの代わりにしない。
  const summaryIsClean =
    summaryClean &&
    !summaryMatchesDismissedReview &&
    (!findings || (summaryClean.sha !== findings.sha && isAfter(summaryClean.at, findings.at)));
  const clean =
    summaryIsClean && (!commentClean || isAfter(summaryClean.at, commentClean.at))
      ? summaryClean
      : commentClean;
  const latestReviewAt = reviews.reduce((max, item) => (isAfter(item.at, max) ? item.at : max), '');
  const label = chooseCodexReviewLabel({
    fork,
    inProgress,
    cleanAt: clean?.at ?? '',
    latestReviewAt,
    findingsCoverAt: findings?.at ?? '',
    unresolved,
  });
  return { label, clean, findings, latestReviewAt };
}

export function formatDecisionLine({ prNumber, decision, headSha, unresolved, inProgress }) {
  const head = headSha.slice(0, 10);
  if (decision.label === 'none') return `PR #${prNumber}: フォークのPRは対象外`;
  if (decision.label === 'clear') {
    return `PR #${prNumber}: 指摘なし (head ${head}, 判定 ${decision.clean.sha.slice(0, 10)})`;
  }
  if (decision.label === 'findings') {
    const reviewed = decision.findings ? `, 判定 ${decision.findings.sha.slice(0, 10)}` : '';
    return `PR #${prNumber}: 指摘あり (head ${head}, 未解決 ${unresolved}件${reviewed})`;
  }
  const progress = inProgress ? 'レビュー進行中' : '現在のheadに適用できる完了判定がない';
  return `PR #${prNumber}: 未レビュー・レビュー中 (head ${head}, ${progress})`;
}

export function reviewStateFingerprint(snapshot) {
  return JSON.stringify({
    prState: snapshot.prState,
    headSha: snapshot.headSha,
    baseRef: snapshot.baseRef,
    headRepo: snapshot.headRepo,
    baseChangedAt: snapshot.baseChangedAt,
    unresolved: snapshot.unresolved,
    inProgress: snapshot.inProgress,
    summaryStatus: snapshot.summaryStatus,
    noFindings: snapshot.noFindings,
    summaryCompleted: snapshot.summaryCompleted,
    reviews: snapshot.reviews,
  });
}

function gitOutput(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitSucceeds(cwd, args) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function resolveCommit(cwd, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return '';
  try {
    return gitOutput(cwd, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  } catch {
    return '';
  }
}

// 判定コミットの内容が、base の取り込みだけで現在の head になっているか。
// マージコミットの列に加え、main の上へ載せ直しただけのコミットも対象にする。
export function commitCoversHead(cwd, reviewed, headSha, baseRef) {
  if (coversByBaseMerges(cwd, reviewed, headSha, baseRef)) return true;
  if (sameTreeAsCleanMerge(cwd, reviewed, headSha, baseRef)) return true;
  // main が先へ進んでも、載せ直した時点の base 祖先との一致なら判定を維持する。
  let fork;
  try {
    fork = gitOutput(cwd, ['merge-base', headSha, baseRef]);
  } catch {
    return false;
  }
  return fork !== '' && sameTreeAsCleanMerge(cwd, reviewed, headSha, fork);
}

function sameTreeAsCleanMerge(cwd, reviewed, headSha, baseCommit) {
  const merged = cleanMergeTree(cwd, reviewed, baseCommit);
  const tree = commitTree(cwd, headSha);
  return merged !== '' && merged === tree;
}

function coversByBaseMerges(cwd, reviewed, headSha, baseRef) {
  if (!gitSucceeds(cwd, ['merge-base', '--is-ancestor', reviewed, headSha])) return false;
  let listed;
  try {
    listed = gitOutput(cwd, ['rev-list', '--reverse', '--first-parent', `${reviewed}..${headSha}`]);
  } catch {
    return false;
  }
  const commits = listed ? listed.split('\n').filter(Boolean) : [];
  let expected = reviewed;
  for (const commit of commits) {
    let parents;
    try {
      parents = gitOutput(cwd, ['rev-list', '--parents', '-n', '1', commit]).split(' ').slice(1);
    } catch {
      return false;
    }
    const [firstParent, secondParent, ...extraParents] = parents;
    if (firstParent !== expected || !secondParent || extraParents.length > 0) return false;
    if (!gitSucceeds(cwd, ['merge-base', '--is-ancestor', secondParent, baseRef])) return false;
    let merged;
    try {
      merged = gitOutput(cwd, ['merge-tree', '--write-tree', firstParent, secondParent]);
    } catch {
      return false;
    }
    let tree;
    try {
      tree = gitOutput(cwd, ['rev-parse', `${commit}^{tree}`]);
    } catch {
      return false;
    }
    if (merged !== tree) return false;
    expected = commit;
  }
  return true;
}

function cleanMergeTree(cwd, left, right) {
  try {
    return gitOutput(cwd, ['merge-tree', '--write-tree', left, right]);
  } catch {
    return '';
  }
}

function commitTree(cwd, sha) {
  try {
    return gitOutput(cwd, ['rev-parse', `${sha}^{tree}`]);
  } catch {
    return '';
  }
}

export function coveringCommit(cwd, sha, headSha, baseRef) {
  const fullSha = resolveCommit(cwd, sha);
  if (!fullSha) return '';
  return commitCoversHead(cwd, fullSha, headSha, baseRef) ? fullSha : '';
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function ghPages(path) {
  return parseConcatenatedJson(gh(['api', '--paginate', path])).flatMap((page) => {
    if (!Array.isArray(page)) throw new Error(`${path} の応答が配列ではありません`);
    return page;
  });
}

function assertPattern(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`${label} が不正です: ${value}`);
}

export function isValidBaseRef(baseRef) {
  if (typeof baseRef !== 'string' || baseRef.length === 0 || /[\0\r\n]/.test(baseRef)) return false;
  try {
    execFileSync('git', ['check-ref-format', `refs/heads/${baseRef}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function report(line) {
  console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, `${line}\n`);
}

function loadSnapshot(repo, prNumber) {
  const pullRequest = JSON.parse(gh(['api', `repos/${repo}/pulls/${prNumber}`]));
  const headSha = String(pullRequest.head?.sha ?? '').toLowerCase();
  const baseRef = String(pullRequest.base?.ref ?? '');
  assertPattern(headSha, /^[0-9a-f]{40}$/, 'head sha');
  if (!isValidBaseRef(baseRef)) throw new Error(`base ref が不正です: ${baseRef}`);

  const timeline = ghPages(`repos/${repo}/issues/${prNumber}/timeline?per_page=100`);
  const comments = ghPages(`repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const reviews = ghPages(`repos/${repo}/pulls/${prNumber}/reviews?per_page=100`);
  const [owner, name] = repo.split('/');
  const threadPages = parseConcatenatedJson(
    gh([
      'api',
      'graphql',
      '--paginate',
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '-F',
      `number=${prNumber}`,
      '-f',
      `query=${REVIEW_THREADS_QUERY}`,
    ]),
  );
  const summary = latestCodexSummary(comments);
  return {
    prState: pullRequest.state,
    headSha,
    baseRef,
    headRepo: pullRequest.head?.repo?.full_name ?? '',
    baseChangedAt: latestBaseChange(timeline),
    unresolved: countUnresolvedCodexThreads(threadPages),
    inProgress: summary ? summaryIsInProgress(summary.body) : false,
    summaryStatus: summary ? summaryStatusToken(summary.body) : '',
    noFindings: extractNoFindings(comments),
    summaryCompleted: summary ? extractCompletedRows(summary.body) : [],
    reviews: extractReviews(reviews),
  };
}

function fetchPullRequestRefs(cwd, { baseRef, prNumber }) {
  execFileSync(
    'git',
    [
      'fetch',
      '--no-tags',
      '--quiet',
      'origin',
      `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`,
      `+refs/pull/${prNumber}/head:refs/remotes/pr/${prNumber}`,
    ],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function ensureReviewedCommit(cwd, repo, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha) || resolveCommit(cwd, sha)) return;
  let full = /^[0-9a-f]{40}$/.test(sha) ? sha : '';
  if (!full) {
    try {
      full = gh(['api', `repos/${repo}/commits/${sha}`, '--jq', '.sha'])
        .trim()
        .toLowerCase();
    } catch {
      return;
    }
  }
  if (!/^[0-9a-f]{40}$/.test(full)) return;
  try {
    execFileSync('git', ['fetch', '--no-tags', '--quiet', 'origin', full], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // 取得できないコミットは判定に使わない。
  }
}

function decide(snapshot, cwd, repo, prNumber) {
  fetchPullRequestRefs(cwd, { baseRef: snapshot.baseRef, prNumber });
  const base = `refs/remotes/origin/${snapshot.baseRef}`;
  return evaluateCodexReviewLabel({
    fork: snapshot.headRepo !== repo,
    inProgress: snapshot.inProgress,
    unresolved: snapshot.unresolved,
    baseChangedAt: snapshot.baseChangedAt,
    noFindings: snapshot.noFindings,
    summaryCompleted: snapshot.summaryCompleted,
    reviews: snapshot.reviews,
    covers: (sha) => {
      ensureReviewedCommit(cwd, repo, sha);
      return coveringCommit(cwd, sha, snapshot.headSha, base);
    },
  });
}

function listLabelNames(repo, prNumber) {
  return gh([
    'api',
    '--paginate',
    `repos/${repo}/issues/${prNumber}/labels?per_page=100`,
    '--jq',
    '.[].name',
  ])
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function deleteLabel(repo, prNumber, name) {
  try {
    gh([
      'api',
      '--method',
      'DELETE',
      '--silent',
      `repos/${repo}/issues/${prNumber}/labels/${encodeURIComponent(name)}`,
    ]);
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.message ?? ''}`;
    if (detail.includes('404')) return;
    throw error;
  }
}

function syncLabels(repo, prNumber, label, currentNames) {
  const desired = label === 'none' ? null : CODEX_REVIEW_LABELS[label];
  if (desired) {
    gh([
      'label',
      'create',
      desired.name,
      '--repo',
      repo,
      '--description',
      desired.description,
      '--color',
      desired.color,
      '--force',
    ]);
  }
  for (const spec of Object.values(CODEX_REVIEW_LABELS)) {
    if (spec.name !== desired?.name && currentNames.includes(spec.name)) {
      deleteLabel(repo, prNumber, spec.name);
    }
  }
  if (desired && !currentNames.includes(desired.name)) {
    gh([
      'api',
      '--silent',
      `repos/${repo}/issues/${prNumber}/labels`,
      '-f',
      `labels[]=${desired.name}`,
    ]);
  }
}

function runCli() {
  const repo = process.env.REPO ?? '';
  const prNumber = String(process.env.PR_NUMBER ?? '');
  assertPattern(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'REPO');
  assertPattern(prNumber, /^\d+$/, 'PR_NUMBER');
  const cwd = process.cwd();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const snapshot = loadSnapshot(repo, prNumber);
    if (snapshot.prState !== 'open') {
      console.log(`PR #${prNumber} is not open`);
      return;
    }
    const decision = decide(snapshot, cwd, repo, prNumber);
    const currentNames = listLabelNames(repo, prNumber);
    const again = loadSnapshot(repo, prNumber);
    if (reviewStateFingerprint(snapshot) !== reviewStateFingerprint(again)) {
      console.log(`判定中にPRの状態が変わったため再判定する (${attempt}回目)`);
      continue;
    }
    const line = formatDecisionLine({
      prNumber,
      decision,
      headSha: snapshot.headSha,
      unresolved: snapshot.unresolved,
      inProgress: snapshot.inProgress,
    });
    report(line);
    if (process.env.DRY_RUN === '1') return;
    syncLabels(repo, prNumber, decision.label, currentNames);
    return;
  }

  console.error('::error::PRの状態が判定中に変わり続けたため、ラベルを更新しなかった');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
