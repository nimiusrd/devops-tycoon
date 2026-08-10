---
name: codex-review-loop
license: MIT
description: 実装完了後の PR で Codex 再レビューを依頼し、指摘をクローズする。コメントはユーザー本人名義で投稿する。「/autopilot」「Codex レビューを回して」「Codex 指摘を対応して」など、Codex（chatgpt-codex-connector）への再依頼や指摘クローズを依頼されたときに使用する。
---

# Codex 再レビュー依頼

`@codex review` の投稿とスレッドへの返信は、いずれもコメント者がユーザー本人になるようにする。ボットやエージェント名義（例: `cursor`）では投稿しない。

## `@codex review`

PR 作成時の初回 Codex レビューは自動で走る。改めて依頼するのは、初回以降に指摘へ対応して push したあとだけ。PR コメントは次の一文のみとし、同じ HEAD への連投や Draft の Ready 化はしない。

```text
@codex review
```

## 指摘クローズ

対応済みの指摘には返信し、スレッドを解決済みにする。

## 停止

未解決の Codex 指摘がなく CI も問題なければ merge-ready として報告して止める。明示がない限りマージしない。
