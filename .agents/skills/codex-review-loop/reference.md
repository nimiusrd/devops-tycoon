# Codex レビュー対応コマンド雛形

`<owner>` / `<repo>` / `<PR>` は対象リポジトリと PR 番号に置き換える。

## PR 状態

```bash
gh pr view <PR> --json number,url,title,state,isDraft,mergeable,mergeStateStatus,headRefName,baseRefName,commits,statusCheckRollup,reviews
gh pr checks <PR>
```

## Codex レビュー依頼

```bash
gh pr comment <PR> --body '@codex review'
```

## 未解決レビュースレッド一覧

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:20) {
            nodes {
              databaseId
              url
              body
              path
              line
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}' -F owner='<owner>' -F repo='<repo>' -F number=<PR> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes
    | map(select(.isResolved == false))'
```

Codex 由来だけに絞る場合:

```bash
# 上記 jq の続き例
# | map(select(.comments.nodes[0].author.login == "chatgpt-codex-connector"))
```

## スレッドへ返信

先頭コメントの `databaseId` を使う。

```bash
gh api -X POST \
  "repos/<owner>/<repo>/pulls/<PR>/comments/<DATABASE_ID>/replies" \
  -f body='対応済み。<何をしたか。事実と数値。>'
```

複数行本文:

```bash
gh api -X POST \
  "repos/<owner>/<repo>/pulls/<PR>/comments/<DATABASE_ID>/replies" \
  -f body="$(cat <<'EOF'
対応済み。<要約。>

<必要なら補足・計測結果>
EOF
)"
```

## スレッドを resolve

`reviewThreads.nodes[].id`（例: `PRRT_...`）を使う。`databaseId` ではない。

```bash
gh api graphql -f query='
mutation($id:ID!) {
  resolveReviewThread(input:{threadId:$id}) {
    thread { isResolved }
  }
}' -f id='<THREAD_ID>'
```

## CI 待機

```bash
gh pr checks <PR> --watch
```

## 推奨順序（1 指摘あたり）

1. 修正（または dismiss 判断）
2. 必要なら検証
3. commit / push
4. replies API でユーザー文体の返信
5. `resolveReviewThread`
6. 必要なら `@codex review` 再依頼
7. `gh pr checks`
