# PR Merge Readiness

PR の準備状況は [独立 Action v0.1.0](https://github.com/nimiusrd/pr-merge-readiness-action/releases/tag/v0.1.0) により観測します。固定 SHA は `fb9e82eadd7e56467b762102597ad8a77d47d82d` です。参考 Check の名前は `Autonomous Merge Shadow / PR #番号`、conclusion は常に `neutral` です。

- 設定: [`.github/pr-merge-readiness.toml`](../.github/pr-merge-readiness.toml)
- 生成入口: [`.github/workflows/pr-merge-readiness.yml`](../.github/workflows/pr-merge-readiness.yml)
- 詳細・データ契約・replay: [Action README](https://github.com/nimiusrd/pr-merge-readiness-action/tree/fb9e82eadd7e56467b762102597ad8a77d47d82d)

`CI` の `Lint & Unit (Vitest)` と `E2E (Playwright)` を GitHub Actions App ID 15368 の Check として要求します。承認数 0、スレッド解決必須、変更間隔のレビュー閾値 30 日、Check 有効、ラベル手動です。既存ファイルの base 側の最終変更から 30 日を超える場合は、現在 head に対する所属確認済みの人間レビューを要求します。

CI 開始・PR 状態変更では未観測表示、CI 完了では全 open PR、PR 終了では当該 PR を観測します。タイトル・本文だけの編集、承認、日次実行では起動しません。

Actions の **PR Merge Readiness → Run workflow** で手動観測できます。番号を空にすると全 open PR、指定するとその PR が対象です。ラベル更新は番号を空にして `update-labels` を有効にします。観測 → Check → ラベルの順に実行し、Check 公開失敗時はラベルを更新しません。

artifact は `pr-merge-readiness-RUN_ID-ATTEMPT` に `pr-番号.json`、`manifest.json`、`summary.md` を保存し、保持期間を 30 日に設定します。収集失敗時も今回の JSON と Summary が残ります。同じ run の全 job 再実行では、GitHub 側で前 attempt の artifact が取得できなくなる挙動を実測しました。再観測には新しい **Run workflow** を使い、再実行する場合は必要な artifact を先に Git 外へ保存してください。人間の判断や GitHub 本来のマージ条件を代替しません。

設定を変更したら、固定 SHA の Action を取得し、このリポジトリのルートから `python3 -I -B /path/to/action/cli.py generate-workflow --config .github/pr-merge-readiness.toml --output .github/workflows/pr-merge-readiness.yml` を実行します。生成物の手編集は避け、共通検証 workflow の `--check` で一致を確認します。

[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501) で新入口追加と旧 3 writer workflow の停止を一括で行い、[実測検証](./pr-merge-readiness-validation-499.md) 後に旧 Python・policy・テストを削除しました。ロールバックでは、この整理変更と移行変更の両方を revert した **1 本の PR** で旧実装の復元と入口の切替をまとめます。旧 artifact と新 artifact の変換は行いません。実測 JSON は Git に入れず、文書に run URL・attempt・各 SHA・期待値と実測値を記録します。
