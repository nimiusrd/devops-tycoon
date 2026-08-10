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

`@codex review` を投稿したあとは、Codex の応答を待つ。応答は次のいずれかで完了とみなす。

- 指摘スレッドが付く
- `@codex review` に 👍 が付く
- 最新 HEAD 向けに指摘なしコメントが付く（例: `Didn't find any major issues`）

👀 だけが付いている間は未完了。👍 を待ち続けず、指摘なしコメントが来たら完了として先へ進む。指摘が出たら対応して再度 `@codex review` する。コード変更なしで dismiss して resolve しただけの場合は、同じ HEAD でも再依頼してよい。Codex / CI の待機は API 制限を避けるため短間隔で回さず、数分おきでよい。

次をすべて満たしたら merge-ready として報告して止める。明示がない限りマージしない。

- Draft ではない
- PR がマージ可能（競合なし）
- 未解決スレッドがない
- 現在の PR HEAD に対する必須 CI が完了している（成功、または許容された skip / パス除外による未実行。pending / queued、および適用されるチェックの未作成は待機）
- 最新 HEAD に対する Codex 完了がある。`@codex review` 投稿済みなら 👍・指摘なしコメント・その依頼で出た指摘のすべて対応・resolve 済みのいずれか。未投稿なら初回自動レビューの完了でよい
