import { describe, expect, it } from 'vitest';
import {
  planPullRequestRunCancellation,
  parseWorkflowRunLines,
} from '../../../scripts/cancel-superseded-pr-runs.mjs';

const current = {
  currentRunId: 200,
  currentHeadSha: 'b'.repeat(40),
  prHeadSha: 'b'.repeat(40),
  prNumber: 802,
  headBranch: 'cursor/e2e-pr-concurrency-0fbf',
};

describe('planPullRequestRunCancellation', () => {
  it('最新コミットの run は、より小さい run ID の実行中・待ちだけを取り消す', () => {
    const plan = planPullRequestRunCancellation({
      ...current,
      runs: [
        { id: 100, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [802] },
        { id: 150, status: 'queued', event: 'pull_request', pullRequestNumbers: [802] },
        { id: 180, status: 'completed', event: 'pull_request', pullRequestNumbers: [802] },
        { id: 190, status: 'in_progress', event: 'push', pullRequestNumbers: [802] },
        { id: 195, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [803] },
        { id: 200, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [802] },
        { id: 250, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [802] },
      ],
    });

    expect(plan).toEqual({ superseded: false, cancelRunIds: [100, 150] });
  });

  it('Actions API の pull_requests フィールドを同じPRとして扱う', () => {
    const plan = planPullRequestRunCancellation({
      ...current,
      runs: [
        {
          id: 100,
          status: 'in_progress',
          event: 'pull_request',
          head_branch: current.headBranch,
          pull_requests: [802],
        },
      ],
    });

    expect(plan.cancelRunIds).toEqual([100]);
  });

  it('PR番号が空の run は同じ head branch のときだけ取り消す', () => {
    const plan = planPullRequestRunCancellation({
      ...current,
      runs: [
        {
          id: 100,
          status: 'waiting',
          event: 'pull_request',
          headBranch: current.headBranch,
          pullRequestNumbers: [],
        },
        {
          id: 110,
          status: 'pending',
          event: 'pull_request',
          headBranch: 'other',
          pullRequestNumbers: [],
        },
      ],
    });

    expect(plan.cancelRunIds).toEqual([100]);
  });

  it('自分が最新コミットでなくなった run は、自分だけを取り消して新しい run を残す', () => {
    const plan = planPullRequestRunCancellation({
      ...current,
      prHeadSha: 'c'.repeat(40),
      runs: [
        { id: 100, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [802] },
        { id: 300, status: 'in_progress', event: 'pull_request', pullRequestNumbers: [802] },
      ],
    });

    expect(plan).toEqual({ superseded: true, cancelRunIds: [200] });
  });
});

describe('parseWorkflowRunLines', () => {
  it('gh が複数行で返す JSON を run の配列にする', () => {
    const runs = parseWorkflowRunLines(
      [
        '{"id":1,"status":"queued","event":"pull_request","head_branch":"topic","pull_requests":[7]}',
        '',
        '{"id":2,"status":"in_progress","event":"pull_request","head_branch":"topic","pull_requests":[7]}',
      ].join('\n'),
    );

    expect(runs.map((run) => run.id)).toEqual([1, 2]);
  });
});
