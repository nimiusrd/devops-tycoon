# PR Merge Readiness

PR の準備状況は [独立 Action v0.3.0](https://github.com/nimiusrd/pr-merge-readiness-action/releases/tag/v0.3.0) により観測します。固定 SHA は `b3a6259c4b6dae30ebf5fd60c0aeac5ead0819f7` です。参考 Check の名前は `Autonomous Merge Shadow / PR #番号`、conclusion は常に `neutral` です。

- 設定: [`.github/pr-merge-readiness.toml`](../.github/pr-merge-readiness.toml)
- 通常の workflow: [`.github/workflows/pr-merge-readiness.yml`](../.github/workflows/pr-merge-readiness.yml)
- 詳細・設定例・replay: [Action の最新 README](https://github.com/nimiusrd/pr-merge-readiness-action#readme)

Python 3.14 を uv 0.12.13 で管理し、Python 実装と開発環境は独立 Action 側で管理します。各 job はこのリポジトリの通常の workflow から Composite Action を直接呼びます。Action の開発検証は pytest・Ruff・mypy strict を使用します。

`CI` の `Lint & Unit (Vitest)` と `E2E (Playwright)` を GitHub Actions App ID 15368 の Check として要求します。承認数 0、スレッド解決必須、変更間隔のレビュー閾値 30 日、Check 有効、ラベル手動です。既存ファイルの base 側の最終変更から 30 日を超える場合は、現在 head に対する所属確認済みの人間レビューを要求します。

CI 開始・PR 状態変更では未観測表示、CI 完了では全 open PR、PR 終了では当該 PR を観測します。タイトル・本文だけの編集、承認、日次実行では起動しません。

Actions の **PR Merge Readiness → Run workflow** で手動観測できます。番号を空にすると全 open PR、指定するとその PR が対象です。ラベル更新は番号を空にして `update-labels` を有効にします。観測 → Check → ラベルの順に実行し、Check 公開失敗時はラベルを更新しません。

artifact は `pr-merge-readiness-RUN_ID-ATTEMPT` に `pr-番号.json`、`manifest.json`、`summary.md` を保存し、保持期間を 30 日に設定します。収集失敗時も今回の JSON と Summary が残ります。同じ run の全 job 再実行では、GitHub 側で前 attempt の artifact が取得できなくなる挙動を実測しました。再観測には新しい **Run workflow** を使い、再実行する場合は必要な artifact を先に Git 外へ保存してください。人間の判断や GitHub 本来のマージ条件を代替しません。

設定と workflow は直接編集します。Action 更新時は TOML の `action_ref` と全 step の `uses:`・`action-ref` を同じ SHA に変更し、CI workflow 名の変更時は TOML と `on.workflow_run.workflows` を合わせて変更してください。`validate-config` job は提案中の commit の TOML を read-only で検証します。`prepare` が default branch の設定 SHA と処理を確定し、後続 job は同じ設定で実行します。生成 CLI と再利用可能 workflow は使いません。

[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501) で新入口追加と旧 3 writer workflow の停止を一括で行い、[実測検証](./pr-merge-readiness-validation-499.md) 後に旧 Python・policy・テストを削除しました。ロールバックでは、この整理変更と移行変更の両方を revert した **1 本の PR** で旧実装の復元と入口の切替をまとめます。旧 artifact と新 artifact の変換は行いません。実測 JSON は Git に入れず、文書に run URL・attempt・各 SHA・期待値と実測値を記録します。

直接呼出しへの切替を戻す場合は、今回の設定・workflow の変更をまとめて revert します。別 run / attempt の artifact や再利用 workflow の記録への変換は行いません。
