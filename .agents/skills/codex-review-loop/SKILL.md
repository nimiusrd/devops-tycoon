---
name: codex-review-loop
license: MIT
description: 実装完了後の PR で Codex 再レビューを依頼し、指摘をクローズする。コメントはユーザー本人名義で投稿する。「Codex レビューを回して」「Codex 指摘を対応して」など、Codex（chatgpt-codex-connector）への再依頼や指摘クローズを依頼されたときに使用する。
---

# Codex 再レビュー依頼

`@codex review` の投稿とスレッドへの返信は、いずれもコメント者がユーザー本人になるようにする。ボットやエージェント名義（例: `cursor`）では投稿しない。

## `@codex review`

PR 作成時の初回 Codex レビューは自動で走る。改めて依頼するのは、初回以降に HEAD が変わったあと（指摘対応・CI 修正など理由を問わない）だけ。PR コメントは次の一文のみとし、同じ HEAD への連投や Draft の Ready 化はしない。

```text
@codex review
```

## 指摘クローズ

対応済みの指摘には返信し、スレッドを解決済みにする。

## 停止

`@codex review` を投稿したあとは、Codex の応答を待つ。指摘があればコメントし、なければそのコメントに 👍 する。指摘が出たら対応して再度 `@codex review` する。

次をすべて満たしたら merge-ready として報告して止める。明示がない限りマージしない。

- PR がマージ可能（競合なし）
- 未解決スレッドがない
- 必須 CI が完了している（成功、または許容された skip。pending / queued は残さない）
- 最新 HEAD に対する Codex 完了がある。`@codex review` を投稿済みならそのコメントへの 👍。未投稿なら初回自動レビューの完了でよい
