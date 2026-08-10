# 手動操作のコマンド雛形

`<owner>` / `<repo>` / `<PR>` は対象に置き換える。

## `@codex review` を投稿する

```bash
gh pr comment <PR> --body '@codex review'
```

## スレッドへ返信する

先頭コメントの `databaseId` を使う。

```bash
gh api -X POST \
  "repos/<owner>/<repo>/pulls/<PR>/comments/<DATABASE_ID>/replies" \
  -f body='対応済み。<何をしたか。事実と数値。>'
```

## スレッドを resolve する

`reviewThreads.nodes[].id`（例: `PRRT_...`）を使う。`databaseId` ではない。

```bash
gh api graphql -f query='
mutation($id:ID!) {
  resolveReviewThread(input:{threadId:$id}) {
    thread { isResolved }
  }
}' -f id='<THREAD_ID>'
```
