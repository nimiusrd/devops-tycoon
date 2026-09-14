# PR Merge Readiness

PR の準備状況は [独立 Action v0.4.0 の実装コミット](https://github.com/nimiusrd/pr-merge-readiness-action/commit/21fa2df95fc615847ba7e1a24e9c77bd5d1323fb) により観測します。固定 SHA は `21fa2df95fc615847ba7e1a24e9c77bd5d1323fb` です。参考 Check の名前は `Autonomous Merge Shadow / PR #番号`、conclusion は常に `neutral` です。

- 設定: [`.github/pr-merge-readiness.toml`](../.github/pr-merge-readiness.toml)
- 通常の workflow: [`.github/workflows/pr-merge-readiness.yml`](../.github/workflows/pr-merge-readiness.yml)
- 詳細・設定例・replay: [Action の最新 README](https://github.com/nimiusrd/pr-merge-readiness-action#readme)

Python 3.14 を uv 0.12.13 で管理し、Python 実装と開発環境は独立 Action 側で管理します。このリポジトリの通常の workflow は **1 job・1 step** で Composite Action を呼びます。既定の `run` が設定検証・観測・公開・artifact 保存を選び、順序を管理します。Action の開発検証は pytest・Ruff・mypy strict を使用します。

`CI` の `Lint & Unit (Vitest)` と `E2E (Playwright)` を GitHub Actions App ID 15368 の Check として要求します。承認数 0、スレッド解決必須、変更間隔のレビュー閾値 30 日、Check 有効、ラベル手動です。既存ファイルの base 側の最終変更から 30 日を超える場合は、現在 head に対する所属確認済みの人間レビューを要求します。

CI 開始・PR 状態変更では未観測表示、CI 完了では全 open PR、PR 終了では当該 PR を観測します。タイトル・本文だけの編集、承認、日次実行では起動しません。

Actions の **PR Merge Readiness → Run workflow** で手動観測できます。番号を空にすると全 open PR、指定するとその PR が対象です。ラベル更新は番号を空にして `update-labels` を有効にします。Action が実イベントから入力を読み、観測 → artifact 保存 → Check → ラベルの順に実行します。保存失敗時は公開を止め、Check 公開失敗時はラベルを更新しません。

job は観測と公開に必要な権限をまとめて持ちます。設定検証時も共通の権限設定ですが、Action は検証経路で読み取りだけを行い、観測・公開へ進みません。PR のソースコードを checkout・実行しません。

workflow を編集できる書き込み権限者は信頼対象です。GitHub ではこの権限者が `permissions` 自体も編集できるため、Action の検証経路や同じ workflow 内の job 分離は workflow 定義の改変を防ぐ境界ではありません。外部 fork の `pull_request` は GitHub の読み取り専用 token 制限に従います。[GitHub の権限設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)を参照してください。

`autonomous-merge-check-writer` で設定検証から公開まで job 全体を直列化します。`cancel-in-progress: false` と `queue: max` により、実行中の job を止めず、手動ラベル要求を含む最大100件を待機させます。後続の通常イベントは既存の待機要求を置き換えません。待機枠が満杯の場合は追加の要求がキャンセルされるため、その手動要求は空きができてから再実行してください。[GitHub のキュー仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)に従います。

artifact は `pr-merge-readiness-RUN_ID-ATTEMPT` に `pr-番号.json`、`manifest.json`、`summary.md` を保存し、保持期間を 30 日に設定します。収集失敗時も今回の JSON と Summary が残ります。同じ run の全 job 再実行では、GitHub 側で前 attempt の artifact が取得できなくなる挙動を実測しました。再観測には新しい **Run workflow** を使い、再実行する場合は必要な artifact を先に Git 外へ保存してください。人間の判断や GitHub 本来のマージ条件を代替しません。

設定と workflow は直接編集します。Action 更新時は TOML の `action_ref` と1か所の `uses:` を同じ公開済み SHA に変更し、CI workflow 名の変更時は TOML と `on.workflow_run.workflows` を合わせて変更してください。Action 自身の SHA は実際の参照から取得するため、`action-ref` 入力は不要です。`pull_request` は PR head、`push` は push 対象 SHA の TOML を検証して終了します。運用イベントでは default branch の設定 SHA を一度確定し、最後まで同じ設定を使用します。生成 CLI と再利用可能 workflow は使いません。

[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501) で新入口追加と旧 3 writer workflow の停止を一括で行い、[実測検証](./pr-merge-readiness-validation-499.md) 後に旧 Python・policy・テストを削除しました。ロールバックでは、この整理変更と移行変更の両方を revert した **1 本の PR** で旧実装の復元と入口の切替をまとめます。旧 artifact と新 artifact の変換は行いません。実測 JSON は Git に入れず、文書に run URL・attempt・各 SHA・期待値と実測値を記録します。

1回の呼出しへの切替を戻す場合は、今回の設定・workflow の変更をまとめて revert し、従来の個別 operation を呼ぶ構成に戻します。判定・レポート形式は維持しており、artifact の変換は行いません。
