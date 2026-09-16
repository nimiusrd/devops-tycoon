# PR Merge Readiness

PR の準備状況は [Python 同梱バイナリ版の独立 Action v0.5.1](https://github.com/nimiusrd/pr-merge-readiness-action/releases/tag/v0.5.1) により観測します。固定 SHA は Immutable Release の配布用コミット `38abf77191ca0801d10dd6bd8c9d387bdad4b911` です。参考 Check の名前は `Autonomous Merge Shadow / PR #番号`、conclusion は常に `neutral` です。

- 設定: [`.github/pr-merge-readiness.toml`](../.github/pr-merge-readiness.toml)
- 通常の workflow: [`.github/workflows/pr-merge-readiness.yml`](../.github/workflows/pr-merge-readiness.yml)
- 詳細・設定例・replay: [Action の最新 README](https://github.com/nimiusrd/pr-merge-readiness-action#readme)

Python 3.14 と開発・ビルド依存は独立 Action 側で uv 0.12.13 により管理します。リリース時に PyInstaller で Linux x64・arm64 向けのバイナリを生成し、このリポジトリでは **1 job・1 step** で Composite Action を呼びます。実行時は固定した配布用コミットのバイナリを使うため、uv・Python の導入、依存解決、ビルドは不要です。既定の `run` が設定検証・観測・公開・artifact 保存を選び、順序を管理します。Action の開発検証は pytest・Ruff・mypy strict を使用します。

CI の実行状態は GitHub Checks で確認します。この Action は CI の結果・再実行履歴・`mergeStateStatus` を集約しません。設定は version 2、承認数 0、スレッド解決必須、変更間隔のレビュー閾値 30 日、Check 有効、ラベル自動更新です。既存ファイルの base 側の最終変更から 30 日を超える場合は、現在 head に対する所属確認済みの人間レビューを要求します。CI 定義ファイルの変更もレビュー条件として扱います。

| タイミング | トリガー | 処理 |
| --- | --- | --- |
| 通常 PR の作成・再開・コミット追加・Draft 切替・base 変更 | `pull_request` | PR head の TOML を検証後、default branch の設定で当該 PR を観測し、レポート・参考 Check・ラベルを更新 |
| 通常 PR の終了 | `pull_request: closed` | 当該 PR を観測してレポート・参考 Check を更新し、当該 PR の管理ラベルを除去 |
| タイトル・本文だけの編集 | `pull_request: edited` | 起動後に処理をスキップ |
| fork・Dependabot・作成元リポジトリが削除された PR | `pull_request` | 設定取得・観測・公開をスキップ |
| 設定・workflow の push | パス限定の `push` | push 対象 SHA の TOML 検証のみ |
| 手動実行・PR 番号あり | `workflow_dispatch` | 指定 PR を観測してレポート・参考 Check を更新 |
| 手動実行・PR 番号なし | `workflow_dispatch` | 全 open PR を観測してレポート・参考 Check を更新 |
| 手動実行・`update-labels = true` | `workflow_dispatch` | 全 open PR の観測・参考 Check・ラベル同期と、終了済み PR の管理ラベル除去 |

通常 PR は、作成元とマージ先が同じリポジトリで、作成者が `dependabot[bot]` 以外の PR です。fork・Dependabot は人間が実行した場合も自動処理の対象外です。手動実行ではこれらの PR のレポートも保存できますが、参考 Check は作成・更新しません。ラベル同期では残っている管理ラベルを除去します。

CI 開始・完了・再実行、承認・スレッド解決、base ブランチへの新しい push、日数経過では再観測を起動しません。競合中の PR では `pull_request` が起動しないため、最新情報の反映には Run workflow を使います。open PR の競合判定が `UNKNOWN` の場合、観測開始時と最終確認時に2秒間隔で最大5回追加取得します。上限後も未確定なら、その状態をレポートに残します。

ラベルは `shadow/レビュー条件充足`・`shadow/レビュー待ち`・`shadow/要対応`・`shadow/再観測が必要` です。レビューと変更履歴だけを表し、CI の実行状態や Draft・競合・open/closed 状態をラベル判定に含めません。head・base・レビュー内容の変化は再観測対象です。PR 状態を含む判定は参考 Check・レポートで確認できます。

`publication.labels = "auto"` により、自動実行はイベント元 PR だけのラベルを同期します。他の PR の一括更新・終了済み PR の清掃は手動同期で行います。自動更新を止める場合は `"manual"`、手動同期も止める場合は `"off"` に変更します。設定変更だけでは既存ラベルを除去しません。

Actions の **PR Merge Readiness → Run workflow** で手動観測できます。番号を空にすると全 open PR、指定するとその PR が対象です。手動のラベル更新は `auto` 設定でも番号を空にして `update-labels` を有効にします。Action が実イベントから入力を読み、観測 → artifact 保存 → Check → ラベルの順に実行します。保存失敗時は公開を止め、Check 公開失敗時はラベルを更新しません。

job は観測と公開に必要な権限をまとめて持ちます。設定検証時も共通の権限設定ですが、Action は検証経路で読み取りだけを行い、観測・公開へ進みません。PR のソースコードを checkout・実行しません。

workflow を編集できる書き込み権限者は信頼対象です。GitHub ではこの権限者が `permissions` 自体も編集できるため、Action の検証経路や同じ workflow 内の job 分離は workflow 定義の改変を防ぐ境界ではありません。外部 fork の `pull_request` は GitHub の読み取り専用 token 制限に従います。[GitHub の権限設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)を参照してください。

`autonomous-merge-check-writer` で設定検証から公開まで job 全体を直列化します。`cancel-in-progress: false` と `queue: max` により、実行中の job を止めず、手動ラベル要求を含む最大100件を待機させます。後続の通常イベントは既存の待機要求を置き換えません。待機枠が満杯の場合は追加の要求がキャンセルされるため、その手動要求は空きができてから再実行してください。[GitHub のキュー仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)に従います。

artifact は `pr-merge-readiness-RUN_ID-ATTEMPT` に `pr-番号.json`、`manifest.json`、`summary.md` を保存し、保持期間を 30 日に設定します。収集失敗時も今回の JSON と Summary が残ります。同じ run の全 job 再実行では、GitHub 側で前 attempt の artifact が取得できなくなる挙動を実測しました。再観測には新しい **Run workflow** を使い、再実行する場合は必要な artifact を先に Git 外へ保存してください。人間の判断や GitHub 本来のマージ条件を代替しません。

観測・レポートは schema version 2、manifest は version 1 です。JSON と Summary には PR 状態を含む判定と、レビュー・変更履歴だけのラベル用判定を記録します。旧 schema version 1 のレポートを新しい Action で再評価することはできません。

設定と workflow は直接編集します。Action 更新時は1か所の `uses:` を、バイナリを含む公開済みの配布用 SHA に変更します。TOML の `action_ref` は不要で、既存設定に残っていても読み捨てます。設定の互換性は `version` と各項目で検証します。ソースだけの main の SHA は使用できません。Action 自身の SHA は実際の参照から取得するため、`action-ref` 入力は不要です。通常 PR の `pull_request` は PR head の TOML を検証後、default branch の設定で観測・公開します。不正な提案設定では観測へ進みません。`push` は push 対象 SHA の TOML を検証して終了します。運用イベントでは default branch の設定 SHA を一度確定し、最後まで同じ設定を使用します。生成 CLI と再利用可能 workflow は使いません。

自動観測と Check・ラベル公開は、設定を検証したイベントの head SHA に固定します。待機中・観測中の追加 push で head が変わった場合は診断を保存して判定・公開を止め、観測後に変わった場合も Check・ラベル公開を省略します。新しい PR イベントで再評価します。

v0.5.1 は設定と Action の SHA の一致を要求しないため、default branch に旧 `action_ref` が残る更新 PR でも観測・公開できます。自動ラベル設定は default branch への反映後に有効になります。更新 PR では CI・readiness の成功を確認し、マージ後の通常 PR 作成・更新でラベル付与を確認します。readiness job は必須 Check に登録しません。v0.4.0 / v0.5.0 へ切り戻す場合は、workflow と TOML をまとめて戻し、旧版が必要とする `action_ref` も復元します。

移行前に作成した既存 PR は、main を取り込んで workflow を新しい SHA に更新してください。v0.5.1 では TOML に旧 `action_ref` が残っていても検証は成功します。取り込み前の観測には main の Run workflow を使えます。

[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501) で新入口追加と旧 3 writer workflow の停止を一括で行い、[実測検証](./pr-merge-readiness-validation-499.md) 後に旧 Python・policy・テストを削除しました。ロールバックでは、この整理変更と移行変更の両方を revert した **1 本の PR** で旧実装の復元と入口の切替をまとめます。旧 artifact と新 artifact の変換は行いません。実測 JSON は Git に入れず、文書に run URL・attempt・各 SHA・期待値と実測値を記録します。

version 2 への切替を戻す場合は、Action SHA・TOML・workflow をまとめて revert し、設定 version 1 と CI イベントを使う旧実装の構成へ戻します。旧ラベルが必要な場合は旧版の手動同期を実行します。artifact の変換は行いません。
