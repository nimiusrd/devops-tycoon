import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_BOT_LOGIN,
  CODEX_REVIEW_LABELS,
  SUMMARY_MARKER,
  chooseCodexReviewLabel,
  commitCoversHead,
  countUnresolvedCodexThreads,
  evaluateCodexReviewLabel,
  extractCompletedRows,
  extractNoFindings,
  isValidBaseRef,
  extractReviews,
  formatDecisionLine,
  latestBaseChange,
  latestCodexSummary,
  parseConcatenatedJson,
  reviewStateFingerprint,
  summaryIsInProgress,
  summaryStatusToken,
} from '../../../scripts/codex-review-label.mjs';

const cleanBody = (sha: string) =>
  `Codex Review: Didn't find any major issues. Nice work!\n\n**Reviewed commit:** \`${sha}\`\n`;

const summaryBody = (status: string) =>
  `${SUMMARY_MARKER}\n| 📝 **Code Review** | ${status} | \`abcdef1\` | PR opened |\n`;

function comment(body: string, createdAt: string, updatedAt = createdAt) {
  return {
    user: { login: CODEX_BOT_LOGIN },
    body,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function review(sha: string, at: string, state = 'COMMENTED') {
  return { at, sha, state };
}

function covers(...shas: string[]) {
  const allowed = new Set(shas);
  return (sha: string) => (allowed.has(sha) ? sha : '');
}

const baseInput = {
  fork: false,
  inProgress: false,
  unresolved: 0,
  baseChangedAt: '',
  noFindings: [] as { at: string; sha: string }[],
  reviews: [] as { at: string; sha: string; state: string }[],
  covers: covers(),
};

describe('chooseCodexReviewLabel', () => {
  it('指摘なしは、適用できる判定のあとレビューも未解決スレッドもないときだけ', () => {
    expect(
      chooseCodexReviewLabel({
        fork: false,
        inProgress: false,
        cleanAt: '2026-10-11T04:00:00Z',
        latestReviewAt: '2026-10-11T03:00:00Z',
        findingsCoverAt: '2026-10-11T03:00:00Z',
        unresolved: 0,
      }),
    ).toBe('clear');
  });

  it('フォークは進行中でもラベルを付けない', () => {
    expect(
      chooseCodexReviewLabel({
        fork: true,
        inProgress: true,
        cleanAt: '2026-10-11T04:00:00Z',
        latestReviewAt: '',
        findingsCoverAt: '',
        unresolved: 2,
      }),
    ).toBe('none');
  });

  it('レビュー進行中は、以前の指摘なしより優先する', () => {
    expect(
      chooseCodexReviewLabel({
        fork: false,
        inProgress: true,
        cleanAt: '2026-10-11T04:00:00Z',
        latestReviewAt: '',
        findingsCoverAt: '',
        unresolved: 0,
      }),
    ).toBe('pending');
  });

  it('未解決スレッドだけでは指摘ありにしない', () => {
    expect(
      chooseCodexReviewLabel({
        fork: false,
        inProgress: false,
        cleanAt: '2026-10-11T04:00:00Z',
        latestReviewAt: '2026-10-11T03:00:00Z',
        findingsCoverAt: '',
        unresolved: 1,
      }),
    ).toBe('pending');
  });

  it('headを覆う指摘レビューが残っていれば、未解決のあいだは指摘あり', () => {
    expect(
      chooseCodexReviewLabel({
        fork: false,
        inProgress: false,
        cleanAt: '2026-10-11T04:00:00Z',
        latestReviewAt: '2026-10-11T03:00:00Z',
        findingsCoverAt: '2026-10-11T03:00:00Z',
        unresolved: 1,
      }),
    ).toBe('findings');
  });
});

describe('evaluateCodexReviewLabel', () => {
  it('mainの取り込みだけでheadへ届く指摘なしを採用する', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      noFindings: [
        { at: '2026-10-11T02:00:00Z', sha: 'old' },
        { at: '2026-10-11T04:00:00Z', sha: 'current' },
      ],
      reviews: [review('old', '2026-10-11T01:00:00Z')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('clear');
    expect(decision.clean).toEqual({ at: '2026-10-11T04:00:00Z', sha: 'current' });
  });

  it('ベース変更前の指摘なしと指摘レビューは、現在のheadを見ていないものとして捨てる', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      baseChangedAt: '2026-10-11T03:00:00Z',
      noFindings: [{ at: '2026-10-11T02:00:00Z', sha: 'old' }],
      reviews: [review('old', '2026-10-11T01:00:00Z')],
      covers: covers('old'),
    });

    expect(decision.label).toBe('pending');
  });

  it('ベース変更で判定が無効なら、未解決スレッドが残っていても未レビュー', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      unresolved: 2,
      baseChangedAt: '2026-10-11T03:00:00Z',
      noFindings: [{ at: '2026-10-11T02:00:00Z', sha: 'old' }],
      reviews: [review('old', '2026-10-11T01:00:00Z')],
      covers: covers('old'),
    });

    expect(decision.label).toBe('pending');
  });

  it('headを覆わない未解決だけでは指摘ありにしない', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      unresolved: 3,
      reviews: [review('stale', '2026-10-11T02:00:00Z')],
      covers: covers(),
    });

    expect(decision.label).toBe('pending');
  });

  it('headに適用できる指摘レビューは指摘あり', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      reviews: [review('stale', '2026-10-11T02:00:00Z'), review('current', '2026-10-11T04:00:00Z')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('findings');
    expect(decision.findings?.sha).toBe('current');
  });

  it('承認レビューは指摘ありに数えない', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      reviews: [review('current', '2026-10-11T04:00:00Z', 'APPROVED')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('pending');
  });

  it('指摘なしより新しいレビューがheadを覆っていなければ未レビュー', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      noFindings: [{ at: '2026-10-11T03:00:00Z', sha: 'clean' }],
      reviews: [review('side', '2026-10-11T04:00:00Z')],
      covers: covers('clean'),
    });

    expect(decision.label).toBe('pending');
  });

  it('指摘なしより新しい指摘レビューがheadを覆うときは指摘あり', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      noFindings: [{ at: '2026-10-11T03:00:00Z', sha: 'clean' }],
      reviews: [review('current', '2026-10-11T04:00:00Z')],
      covers: covers('clean', 'current'),
    });

    expect(decision.label).toBe('findings');
  });

  it('何もなければ未レビュー', () => {
    expect(evaluateCodexReviewLabel(baseInput).label).toBe('pending');
  });

  it('指摘コメントがない完了サマリーは、headに適用できる指摘なしとして扱う', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      summaryCompleted: [{ at: '2026-10-11T04:51:43.477530Z', sha: 'ed3dd30' }],
      covers: covers('ed3dd30'),
    });

    expect(decision.label).toBe('clear');
    expect(decision.clean?.sha).toBe('ed3dd30');
  });

  it('完了サマリーより新しい指摘レビューがheadを覆うときは指摘あり', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      summaryCompleted: [{ at: '2026-10-11T04:00:00Z', sha: 'old' }],
      reviews: [review('current', '2026-10-11T04:51:43Z')],
      covers: covers('old', 'current'),
    });

    expect(decision.label).toBe('findings');
  });

  it('dismiss 済みの指摘と同じコミットの完了サマリーは指摘なしにしない', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      summaryCompleted: [{ at: '2026-10-11T04:51:43.477530Z', sha: 'current' }],
      reviews: [review('current', '2026-10-11T04:51:43.100000Z', 'DISMISSED')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('pending');
  });

  it('同じコミットの完了サマリーは指摘レビューを打ち消さない', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      summaryCompleted: [{ at: '2026-10-11T04:51:43.477530Z', sha: 'current' }],
      reviews: [review('current', '2026-10-11T04:51:43.100000Z')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('findings');
  });

  it('同じコミットでも指摘なしコメントは指摘レビューより新しい完了になる', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      noFindings: [{ at: '2026-10-11T05:00:00Z', sha: 'current' }],
      reviews: [review('current', '2026-10-11T04:00:00Z')],
      covers: covers('current'),
    });

    expect(decision.label).toBe('clear');
  });

  it('新しい完了サマリーを、同じheadを覆う古い指摘なしコメントより優先する', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      noFindings: [{ at: '2026-10-11T02:00:00Z', sha: 'old-clean' }],
      summaryCompleted: [{ at: '2026-10-11T05:00:00Z', sha: 'new-clean' }],
      reviews: [review('findings', '2026-10-11T03:00:00Z')],
      covers: covers('old-clean', 'findings', 'new-clean'),
    });

    expect(decision.label).toBe('clear');
    expect(decision.clean?.sha).toBe('new-clean');
  });

  it('古い指摘のあとに完了サマリーだけがheadへ届いたら指摘なし', () => {
    const decision = evaluateCodexReviewLabel({
      ...baseInput,
      summaryCompleted: [{ at: '2026-10-11T05:00:00.100Z', sha: 'current' }],
      reviews: [review('old', '2026-10-11T04:00:00Z')],
      covers: covers('old', 'current'),
    });

    expect(decision.label).toBe('clear');
  });
});

describe('Codexのコメントとレビューの読み取り', () => {
  it('指摘なしコメントからレビュー対象のコミットを読む', () => {
    const sha = 'ab140d37a9';
    expect(
      extractNoFindings([
        comment('Codexのメモ', '2026-10-11T00:00:00Z'),
        comment(`前置き ${cleanBody(sha)}`, '2026-10-11T01:00:00Z'),
        comment(cleanBody(sha), '2026-10-11T02:00:00Z'),
      ]),
    ).toEqual([{ at: '2026-10-11T02:00:00Z', sha }]);
  });

  it('Codexのレビューだけを判定材料にする', () => {
    expect(
      extractReviews([
        {
          user: { login: 'someone' },
          submitted_at: '2026-10-11T01:00:00Z',
          commit_id: 'a'.repeat(40),
          state: 'COMMENTED',
        },
        {
          user: { login: CODEX_BOT_LOGIN },
          submitted_at: '2026-10-11T02:00:00Z',
          commit_id: 'B'.repeat(40),
          state: 'COMMENTED',
        },
      ]),
    ).toEqual([{ at: '2026-10-11T02:00:00Z', sha: 'b'.repeat(40), state: 'COMMENTED' }]);
  });

  it('完了サマリーの時刻とコミットを読む', () => {
    const html = [
      SUMMARY_MARKER,
      '| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-11T04:51:43.477530Z">2026-10-11T04:51:43.477530Z</relative-time> | `ed3dd30` | Draft marked ready |',
      '| 📝 **Security Review** | 🔄 **Running** since <relative-time datetime="2026-10-11T04:52:00.000000Z">2026-10-11T04:52:00.000000Z</relative-time> | `ed3dd30` | Manual request |',
    ].join('\n');
    const plain =
      '| 📝 **Code Review** | ✅ **Completed** 2026-10-01T12:58:17.179862Z | `30e6ca3` | Manual request |';

    expect(extractCompletedRows(html)).toEqual([
      { at: '2026-10-11T04:51:43.477530Z', sha: 'ed3dd30' },
    ]);
    expect(extractCompletedRows(plain)).toEqual([
      { at: '2026-10-01T12:58:17.179862Z', sha: '30e6ca3' },
    ]);
    expect(summaryIsInProgress(html)).toBe(true);
  });

  it('Code Review が失敗しているサマリーは、別行の Completed を指摘なしにしない', () => {
    const body = [
      '| 📝 **Code Review** | ❌ **Failed** <relative-time datetime="2026-10-11T04:00:00Z">2026-10-11T04:00:00Z</relative-time> | `aaaaaaa` | PR opened |',
      '| 📝 **Security Review** | ✅ **Completed** <relative-time datetime="2026-10-11T04:01:00Z">2026-10-11T04:01:00Z</relative-time> | `bbbbbbb` | PR opened |',
    ].join('\n');

    expect(extractCompletedRows(body)).toEqual([]);
    expect(
      extractCompletedRows(
        '| 📝 **Security Review** | ✅ **Completed** 2026-10-11T04:00:00Z | `bbbbbbb` | Manual request |',
      ),
    ).toEqual([]);
  });

  it('いちばん新しいサマリーが Running または Queued のときだけ進行中', () => {
    const comments = [
      comment(summaryBody('✅ **Completed**'), '2026-10-11T01:00:00Z', '2026-10-11T01:00:00Z'),
      comment(summaryBody('🔄 **Running** since'), '2026-10-11T02:00:00Z', '2026-10-11T03:00:00Z'),
    ];

    expect(summaryIsInProgress(latestCodexSummary(comments)?.body ?? '')).toBe(true);
    expect(summaryIsInProgress(summaryBody('⏳ **Queued**'))).toBe(true);
    expect(summaryIsInProgress(summaryBody('✅ **Completed**'))).toBe(false);
    expect(summaryStatusToken(summaryBody('🔄 **Running** since'))).toBe('**Running**');
  });

  it('ベース変更のいちばん新しい時刻と、Codexの未解決スレッド数を数える', () => {
    expect(
      latestBaseChange([
        { event: 'committed', created_at: '2026-10-11T05:00:00Z' },
        { event: 'base_ref_changed', created_at: '2026-10-11T02:00:00Z' },
        { event: 'base_ref_changed', created_at: '2026-10-11T04:00:00Z' },
      ]),
    ).toBe('2026-10-11T04:00:00Z');

    expect(
      countUnresolvedCodexThreads([
        {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' } }] },
                    },
                    {
                      isResolved: true,
                      comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' } }] },
                    },
                    {
                      isResolved: false,
                      comments: { nodes: [{ author: { login: 'someone' } }] },
                    },
                  ],
                },
              },
            },
          },
        },
      ]),
    ).toBe(1);
  });

  it('gh がページごとに返すJSONを連結して読む', () => {
    const pages = parseConcatenatedJson('[{"body":"a}b"}]\n[{"body":"c"}]');

    expect(pages).toEqual([[{ body: 'a}b' }], [{ body: 'c' }]]);
  });
});

describe('ラベル定義', () => {
  it('3状態のラベル名と、100文字以内の説明をワークフローからも参照する', () => {
    const workflow = readFileSync('.github/workflows/codex-review-label.yml', 'utf8');

    expect(workflow).toContain('node scripts/codex-review-label.mjs');
    expect(workflow).toContain('dismissed');
    expect(workflow).toContain('github.sha');
    expect(workflow).toContain('github.event.repository.default_branch');
    for (const spec of Object.values(CODEX_REVIEW_LABELS)) {
      expect(spec.description.length).toBeLessThanOrEqual(100);
      expect(spec.color).toMatch(/^[0-9A-F]{6}$/);
      expect(workflow).toContain(spec.name);
    }
  });

  it('判定ログに状態と根拠を残す', () => {
    expect(
      formatDecisionLine({
        prNumber: '12',
        headSha: 'abcdef1234ff',
        unresolved: 2,
        inProgress: false,
        decision: {
          label: 'findings',
          clean: null,
          findings: { at: '2026-10-11T00:00:00Z', sha: '1234567890ab' },
          latestReviewAt: '2026-10-11T00:00:00Z',
        },
      }),
    ).toBe('PR #12: 指摘あり (head abcdef1234, 未解決 2件, 判定 1234567890)');
  });

  it('判定材料が変わると指紋が変わる', () => {
    const snapshot = {
      prState: 'open',
      headSha: 'a'.repeat(40),
      baseRef: 'main',
      headRepo: 'nimiusrd/devops-tycoon',
      baseChangedAt: '',
      unresolved: 0,
      inProgress: false,
      summaryStatus: '**Completed**',
      noFindings: [],
      reviews: [],
    };

    expect(reviewStateFingerprint(snapshot)).toBe(reviewStateFingerprint({ ...snapshot }));
    expect(reviewStateFingerprint(snapshot)).not.toBe(
      reviewStateFingerprint({ ...snapshot, unresolved: 1 }),
    );
  });
});

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'codex-label-'));
  tempRoots.push(cwd);
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'codex-label@example.com']);
  git(cwd, ['config', 'user.name', 'codex-label']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
  return cwd;
}

function commitFile(cwd: string, file: string, contents: string) {
  writeFileSync(join(cwd, file), contents);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-m', file]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

describe('isValidBaseRef', () => {
  it('Gitが認めるブランチ名を通し、不正なrefを拒否する', () => {
    expect(isValidBaseRef('main')).toBe(true);
    expect(isValidBaseRef('release@next')).toBe(true);
    expect(isValidBaseRef('release+hotfix')).toBe(true);
    expect(isValidBaseRef('リリース')).toBe(true);
    expect(isValidBaseRef('feature/topic')).toBe(true);
    expect(isValidBaseRef('')).toBe(false);
    expect(isValidBaseRef('has space')).toBe(false);
    expect(isValidBaseRef('bad..name')).toBe(false);
    expect(isValidBaseRef('lock.lock')).toBe(false);
  });
});

describe('commitCoversHead', () => {
  it('headそのものと、baseの取り込みだけを挟んだ祖先を適用できるとみなす', () => {
    const cwd = initRepo();
    commitFile(cwd, 'base.txt', 'base');
    git(cwd, ['checkout', '-b', 'feature']);
    const feature = commitFile(cwd, 'feature.txt', 'feature');
    git(cwd, ['checkout', 'main']);
    commitFile(cwd, 'main.txt', 'main');
    git(cwd, ['checkout', 'feature']);
    git(cwd, ['merge', 'main', '-m', 'merge main']);
    git(cwd, ['checkout', 'main']);
    commitFile(cwd, 'main-2.txt', 'main-2');
    git(cwd, ['checkout', 'feature']);
    git(cwd, ['merge', 'main', '-m', 'merge main again']);
    const head = git(cwd, ['rev-parse', 'HEAD']);

    expect(commitCoversHead(cwd, feature, head, 'main')).toBe(true);
    expect(commitCoversHead(cwd, head, head, 'main')).toBe(true);
  });

  it('mainの上へ載せ直しただけで内容が同じなら、以前の判定を適用できる', () => {
    const cwd = initRepo();
    commitFile(cwd, 'base.txt', 'base');
    git(cwd, ['checkout', '-b', 'feature']);
    const feature = commitFile(cwd, 'feature.txt', 'feature');
    git(cwd, ['checkout', 'main']);
    commitFile(cwd, 'main.txt', 'main');
    git(cwd, ['checkout', 'feature']);
    git(cwd, ['rebase', 'main']);
    const rebased = git(cwd, ['rev-parse', 'HEAD']);

    expect(commitCoversHead(cwd, feature, rebased, 'main')).toBe(true);

    commitFile(cwd, 'extra.txt', 'extra');
    expect(commitCoversHead(cwd, feature, git(cwd, ['rev-parse', 'HEAD']), 'main')).toBe(false);
  });

  it('レビュー後の通常コミット、別ブランチのマージ、衝突解決は適用できない', () => {
    const cwd = initRepo();
    commitFile(cwd, 'base.txt', 'base');
    git(cwd, ['checkout', '-b', 'feature']);
    const feature = commitFile(cwd, 'feature.txt', 'feature');
    commitFile(cwd, 'follow-up.txt', 'follow-up');
    const head = git(cwd, ['rev-parse', 'HEAD']);

    expect(commitCoversHead(cwd, feature, head, 'main')).toBe(false);

    git(cwd, ['checkout', '-b', 'side', feature]);
    const side = commitFile(cwd, 'side.txt', 'side');
    git(cwd, ['checkout', 'feature']);
    git(cwd, ['merge', 'side', '-m', 'merge side']);
    const sideMerge = git(cwd, ['rev-parse', 'HEAD']);

    expect(commitCoversHead(cwd, feature, sideMerge, 'main')).toBe(false);
    expect(commitCoversHead(cwd, side, sideMerge, 'main')).toBe(false);

    git(cwd, ['checkout', 'main']);
    commitFile(cwd, 'conflict.txt', 'main');
    git(cwd, ['checkout', '-b', 'conflict', 'main~1']);
    commitFile(cwd, 'conflict.txt', 'feature');
    let mergeFailed = false;
    try {
      git(cwd, ['merge', 'main']);
    } catch {
      mergeFailed = true;
    }
    expect(mergeFailed).toBe(true);
    writeFileSync(join(cwd, 'conflict.txt'), 'resolved-by-hand');
    git(cwd, ['add', 'conflict.txt']);
    git(cwd, ['commit', '-m', 'resolve']);
    const resolved = git(cwd, ['rev-parse', 'HEAD']);
    const reviewed = git(cwd, ['rev-parse', 'HEAD^1']);

    expect(commitCoversHead(cwd, reviewed, resolved, 'main')).toBe(false);
  });
});
