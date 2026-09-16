# PR Merge Readiness

PR のレビュー・変更履歴は [Python 同梱バイナリ版の独立 Action v0.6.0](https://github.com/nimiusrd/pr-merge-readiness-action/releases/tag/v0.6.0) により観測します。固定 SHA は Immutable Release の配布用コミット `568c7441e16afa46db11bc84f1e4708e6525a404` です。結果は管理ラベルと Actions の実行サマリーに表示します。

- 設定: [`.github/pr-merge-readiness.toml`](../.github/pr-merge-readiness.toml)
- 通常の workflow: [`.github/workflows/pr-merge-readiness.yml`](../.github/workflows/pr-merge-readiness.yml)
- 詳細・設定例: [v0.6.0 の README](https://github.com/nimiusrd/pr-merge-readiness-action/blob/568c7441e16afa46db11bc84f1e4708e6525a404/README.md)
- 移行仕様: [v0.6.0 の運用と移行](https://github.com/nimiusrd/pr-merge-readiness-action/blob/568c7441e16afa46db11bc84f1e4708e6525a404/docs/workflow.md)

このリポジトリでは **1 job・1 step** で Composite Action を呼びます。配布用コミットには Python 3.14 を同梱した Linux x64・arm64 向けバイナリがあり、実行時の Python・uv 導入や依存解決、ビルドは不要です。PR のソースコードを checkout・実行しません。

設定は version 3、承認数 0、スレッド解決必須、変更間隔のレビュー閾値 30 日です。既存ファイルの base 側の最終変更から 30 日を超える場合は、現在 head に対する所属確認済みの人間の承認を要求します。変更要求・未解決スレッド・CI 定義ファイルの変更も対応事項として扱います。CI の実行結果・再実行履歴・`mergeStateStatus` は集約せず、GitHub Checks で確認します。

| タイミング | トリガー | 処理 |
| --- | --- | --- |
| 通常 PR の作成・再開・コミット追加・Draft 切替・base 変更 | `pull_request` | PR head の TOML を検証後、default branch の設定で当該 PR を観測し、サマリー・ラベルを更新 |
| 通常 PR の終了 | `pull_request: closed` | 当該 PR を観測してサマリーを更新し、当該 PR の管理ラベルを除去 |
| タイトル・本文だけの編集 | `pull_request: edited` | 起動後に処理をスキップ |
| fork・Dependabot・作成元リポジトリが削除された PR | `pull_request` | 自動処理をスキップ |
| 設定・workflow の push | パス限定の `push` | push 対象 SHA の TOML 検証のみ |
| 手動実行・PR 番号あり | `workflow_dispatch` | 指定 PR を観測してサマリー・ラベルを更新 |
| 手動実行・PR 番号なし | `workflow_dispatch` | 全 open PR の観測・サマリー・ラベル更新と、終了済み PR の管理ラベル除去 |

通常 PR は、作成元とマージ先が同じリポジトリで、作成者が `dependabot[bot]` 以外の PR です。fork・Dependabot は自動処理の対象外で、手動同期では観測したうえで残っている管理ラベルを除去します。

CI 開始・完了・再実行、承認・スレッド解決、base ブランチへの新しい push、日数経過では再観測を起動しません。競合中の PR でも `pull_request` が起動しないため、最新情報の反映には Run workflow を使います。

| 管理ラベル | 意味 |
| --- | --- |
| `shadow/要対応事項なし` | 自動確認の範囲で、レビュー・変更履歴の条件を満たしている |
| `shadow/レビュー待ち` | 必要な承認を待っている |
| `shadow/要対応` | 変更要求・未解決スレッド・変更履歴・CI 定義の変更への対応が必要 |
| `shadow/再観測が必要` | 情報が不足している、または観測・公開の間にレビュー対象が変わった |

ラベルはレビューと変更履歴だけを表します。Draft・競合・PR の open/closed 状態は実行サマリーで別に確認します。ラベルは人間の判断や GitHub 本来のマージ条件を代替しません。PR ごとの情報不足はサマリーと再観測ラベルで示し、Action は失敗になります。承認待ちだけなら Action は成功します。

Actions の **PR Merge Readiness → Run workflow** で手動観測できます。番号を指定するとその PR、空欄にすると全 open PR と終了済み PR の管理ラベルが同期対象です。実行対象のラベルは毎回更新されます。`update-labels` 入力と `[publication]` 設定は廃止され、観測だけを行うモードはありません。

設定検証 → 全対象の観測 → サマリー生成 → ラベル更新の順で実行します。運用イベントでは default branch の設定 SHA を一度確定し、最後まで同じ設定を使用します。使用した設定コミットは実行サマリーに表示します。通常 PR は先に PR head の TOML を検証し、不正な提案設定では観測へ進みません。`push` は push 対象 SHA の TOML を検証して終了します。

自動観測はイベントの head SHA に固定します。待機中・観測中に追加 push で head が変わった場合は失敗し、ラベルを更新しません。観測後に head が変わった場合も更新を省略します。新しい PR イベントで再評価します。レビュー対象の base の変化は再観測ラベルで示します。PR の `updated_at` だけの変化はサマリーに記録しますが、情報不足や失敗の理由にはしません。

job は `contents: read`・`pull-requests: write`・`issues: write` を持ちます。参考 Check の公開が廃止されたため、`checks: write` は不要です。設定検証時も共通の権限設定ですが、検証経路では読み取りだけを行い、観測・ラベル更新へ進みません。workflow を編集できる書き込み権限者は信頼対象です。

`autonomous-merge-check-writer` で設定検証からラベル更新まで job 全体を直列化します。旧版と同じ group を維持し、`cancel-in-progress: false` と `queue: max` で実行中の job を止めずに待機させます。待機枠が満杯で要求がキャンセルされた場合は、空きができてから再実行してください。

設定と workflow は直接編集します。Action 更新時は `uses:` を、バイナリを含む公開済みの配布用40桁 SHA に固定します。ソースだけの SHA は使用できません。設定は `version` と `[review]` の3項目だけで、`action_ref` や `[publication]` などの旧キーが残ると検証エラーになります。

v0.5.1 からの移行では、設定 version 3 と v0.6.0 の workflow を同じコミットで default branch に反映します。v0.5.1 は version 3 に対応せず、v0.6.0 は version 2 に対応しません。移行 PR で v0.6.0 を実行すると、提案設定の検証後、default branch に残る version 2 の読み取りで失敗します。readiness job は必須 Check に登録しません。反映後、PR 番号を空欄にした Run workflow でラベル同期と実行サマリーを確認します。既存 PR も main を取り込んで workflow と設定をまとめて更新してください。

v0.6.0 では参考 Check `Autonomous Merge Shadow / PR #番号` の公開、JSON artifact・manifest の保存、CLI の `replay` が廃止されました。過去の Check は履歴として残ります。過去 artifact を再評価する場合は、保存レポートの Action SHA と一致する信頼済みの旧版を使用してください。v0.5.1 へ切り戻す場合は workflow と TOML をまとめて戻し、version 2 と `[publication]` を復元します。

[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501) と [Issue #499 の実測検証](./pr-merge-readiness-validation-499.md) は独立 Action 導入時の履歴です。そこに記録された Check・artifact・schema は当時の版の仕様であり、v0.6.0 の検証結果ではありません。独立 Action 導入前へ戻す場合は、旧実装の整理変更と移行変更をともに revert した1本の PR で旧実装の復元と入口の切替をまとめます。artifact の変換は行いません。
