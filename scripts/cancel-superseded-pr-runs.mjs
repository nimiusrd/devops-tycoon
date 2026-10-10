import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// concurrency の待機開始順は workflow の dispatch 順ではない。
// 古い run が後からグループへ入って最新の E2E を取り消さないよう、
// より小さい run ID だけを取り消す。
export const ACTIVE_WORKFLOW_RUN_STATUSES = Object.freeze([
  'queued',
  'in_progress',
  'waiting',
  'requested',
  'pending',
]);

const ACTIVE_STATUS_SET = new Set(ACTIVE_WORKFLOW_RUN_STATUSES);

function normalizeRun(run) {
  const pullRequestNumbers = run.pullRequestNumbers ?? run.pull_requests ?? [];
  return {
    id: Number(run.id),
    status: String(run.status ?? ''),
    event: String(run.event ?? ''),
    headBranch: String(run.headBranch ?? run.head_branch ?? ''),
    pullRequestNumbers: pullRequestNumbers.map(Number),
  };
}

function belongsToPullRequest(run, prNumber, headBranch) {
  const normalized = normalizeRun(run);
  if (normalized.pullRequestNumbers.length > 0) {
    return normalized.pullRequestNumbers.includes(prNumber);
  }
  return normalized.headBranch === headBranch;
}

function activePullRequestRuns(runs, prNumber, headBranch) {
  return runs
    .map(normalizeRun)
    .filter((run) => Number.isInteger(run.id))
    .filter((run) => ACTIVE_STATUS_SET.has(run.status))
    .filter((run) => run.event === 'pull_request')
    .filter((run) => belongsToPullRequest(run, prNumber, headBranch));
}

export function planPullRequestRunCancellation({
  currentRunId,
  currentHeadSha,
  prHeadSha,
  prNumber,
  headBranch,
  runs,
}) {
  const activeRuns = activePullRequestRuns(runs, prNumber, headBranch);
  // 再実行は run ID が変わらない。より大きい実行中の run があるなら、こちらが古い。
  const superseded =
    prHeadSha !== currentHeadSha || activeRuns.some((run) => run.id > currentRunId);
  if (superseded) {
    return { superseded: true, cancelRunIds: [currentRunId] };
  }

  const cancelRunIds = [
    ...new Set(activeRuns.filter((run) => run.id < currentRunId).map((run) => run.id)),
  ].sort((left, right) => left - right);

  return { superseded: false, cancelRunIds };
}

export function workflowRunsPath(repository, headBranch) {
  const params = new URLSearchParams({
    event: 'pull_request',
    branch: headBranch,
    per_page: '100',
  });
  return `repos/${repository}/actions/workflows/ci.yml/runs?${params}`;
}

export function cancelFailureKind(detail) {
  if (detail.includes('409')) return 'already-finished';
  if (detail.includes('403') || detail.includes('Resource not accessible')) return 'forbidden';
  return 'fatal';
}

function assertPattern(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`${label} が不正です: ${value}`);
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function readPullRequestHeadSha(repository, prNumber) {
  return gh(['api', `repos/${repository}/pulls/${prNumber}`, '--jq', '.head.sha']).trim();
}

export function parseWorkflowRunLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function listPullRequestRuns(repository, headBranch) {
  const text = gh([
    'api',
    '--paginate',
    workflowRunsPath(repository, headBranch),
    '--jq',
    '.workflow_runs[] | {id,status,event,head_branch,pull_requests:[.pull_requests[].number]}',
  ]);
  return parseWorkflowRunLines(text);
}

function cancelRun(repository, runId) {
  try {
    // always() のジョブは通常の cancel では止まらないため、条件を迂回して止める。
    gh([
      'api',
      '--method',
      'POST',
      '--silent',
      `repos/${repository}/actions/runs/${runId}/force-cancel`,
    ]);
    return true;
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.message ?? ''}`;
    const kind = cancelFailureKind(detail);
    if (kind === 'already-finished') {
      console.log(`run ${runId} は既に終了しているため取り消しをスキップします`);
      return false;
    }
    if (kind === 'forbidden') {
      console.log(`run ${runId} はトークン権限がなく取り消せませんでした`);
      return false;
    }
    throw error;
  }
}

function writeSuperseded(superseded) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `superseded=${superseded}\n`);
}

function runCli() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const prNumber = process.env.PR_NUMBER ?? '';
  const currentHeadSha = process.env.HEAD_SHA ?? '';
  const headBranch = process.env.HEAD_BRANCH ?? '';
  const currentRunId = Number(process.env.RUN_ID);

  assertPattern(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'GITHUB_REPOSITORY');
  assertPattern(prNumber, /^\d+$/, 'PR_NUMBER');
  assertPattern(currentHeadSha, /^[0-9a-f]{40}$/, 'HEAD_SHA');
  if (headBranch.length === 0 || /[\0\r\n]/.test(headBranch)) {
    throw new Error('HEAD_BRANCH が不正です');
  }
  if (!Number.isInteger(currentRunId) || currentRunId <= 0) {
    throw new Error(`RUN_ID が不正です: ${process.env.RUN_ID ?? ''}`);
  }

  const prHeadSha = readPullRequestHeadSha(repository, prNumber);
  const prNumberValue = Number(prNumber);
  if (prHeadSha !== currentHeadSha) {
    const plan = planPullRequestRunCancellation({
      currentRunId,
      currentHeadSha,
      prHeadSha,
      prNumber: prNumberValue,
      headBranch,
      runs: [],
    });
    writeSuperseded(plan.superseded);
    console.log(
      `この run は PR の最新コミットではないため取り消します: ${plan.cancelRunIds.join(', ')}`,
    );
    for (const runId of plan.cancelRunIds) {
      cancelRun(repository, runId);
    }
    return;
  }

  const runs = listPullRequestRuns(repository, headBranch);
  const plan = planPullRequestRunCancellation({
    currentRunId,
    currentHeadSha,
    prHeadSha,
    prNumber: prNumberValue,
    headBranch,
    runs,
  });

  writeSuperseded(plan.superseded);
  if (plan.cancelRunIds.length === 0) {
    console.log('取り消す workflow run はありません');
    return;
  }

  console.log(
    plan.superseded
      ? `より新しい run があるため、この run を取り消します: ${plan.cancelRunIds.join(', ')}`
      : `同一PRの古い run を取り消します: ${plan.cancelRunIds.join(', ')}`,
  );
  for (const runId of plan.cancelRunIds) {
    cancelRun(repository, runId);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
