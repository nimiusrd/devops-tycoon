# Autonomous Mergeのモジュールとデータ契約

Issue #486で責務を分離した後も、観測と判定結果のJSONはschema version 2、manifestはversion 1を維持します。
正規化した辞書の形は`.github/autonomous-merge/contracts.py`の`TypedDict`で共有します。型注釈は実行時検証ではありません。外部入力を型だけで信頼せず、値の検証と例外処理は従来のまま残します。

## モジュールの責務

| モジュール | 入力と出力 | 依存・担当 |
| --- | --- | --- |
| `contracts.py` | 観測・policy・判定結果・manifestの型、値の検証 | 標準ライブラリだけを使用。`integer`・`string`・`boolean`・`sha`と`EvaluationError`を共有 |
| `collect.py` | GitHub API → `Observations` → artifact | 正規化、2回の取得と鮮度比較、CLIの保存処理。`assess`・`load_policy`・`report.markdown`を呼ぶ |
| `evaluate.py` | `assess(facts, policy)` → `Assessment` | policyの検証と条件判定。通信・Git・ファイル読み込みなしで呼べる。CLIだけがpolicy/JSONの読み込みと表示を担当 |
| `report.py` | `markdown(result)` → Summaryの文字列 | 完了済みの判定結果だけを表示。評価器をimportせず、判定の再計算・収集・保存はしない |
| `publish.py` / `publish_checks.py` | 保存済み`Assessment` → PRラベル / 参考用Check | 各公開先の検証と書込み。判定の再計算はしない |
| `replay.py` | 信頼済みSHAと保存JSON → 一致結果 | 評価器と依存ファイルを同じSHAから読み、保存policyで再評価する |

Summaryの表示変更は`report.py`と`test_report.py`で扱います。GitHub Checkの表示・ラベルの書込み処理は各publisherに残します。GitHubのCI定義配置に関する知識は引き続きcollectorに置きます。

## 観測データ

`Observations`は収集途中の失敗も保存できる型です。`NotRequired`は「取得前または失敗時にキーがない可能性」を示し、判定条件からの免除を意味しません。collectorが返す基本項目は常に存在しますが、手書きJSONや旧artifactの入力は実行時に検証します。

| 項目 | 形と存在条件 | 欠落・null・空の扱い |
| --- | --- | --- |
| `schema_version` | 基本項目。`2` | 未対応の値・欠落は情報不足 |
| `observed_at` | 基本項目。空でない時刻文字列 | 評価器では空・null・欠落を情報不足とする。Check publisherでは日時としても検証 |
| `repository` / `evaluator_sha` | 基本項目。リポジトリ名 / 信頼済みcheckoutの40桁SHA | 収集・公開・再評価の対象照合に使用。評価器の条件判定で対象の信頼性を代用しない |
| `collection_errors` | 基本項目。収集エラー文字列の配列 | `[]`は記録された収集エラーなし。要素があれば情報不足。API失敗を`[]`に置き換えない |
| `stable` | 基本項目。boolean | `false`は`freshness: unknown`、最終判定は情報不足。文字列や数値への型変換は行わない |
| `pr` | PR取得後に存在。`PullRequest` | 判定で参照するキーの欠落・不正値は既存の検証対象。SHA欠落を現在のブランチで補完しない |
| `change` | ファイル一覧取得後に存在。追加・削除行数、ファイル数 | 3つの件数は0以上の整数。欠落・null・負数は情報不足。0は取得済みの0件 |
| `files` | ファイル一覧取得後に存在。`ChangedFile[]` | `[]`は取得済みの空一覧。`previous_path: null`はrename元なし。patch・source本文は保存しない |
| `ci_definition_changes` | ファイル一覧取得後に存在。path文字列の配列 | `[]`はCI定義変更なし。欠落・null・不正な要素は情報不足。値があれば人間確認 |
| `reviews` | 判定メタデータ取得後に存在。`Review[]` | `[]`は取得済みのレビューなし。欠落を0件に置き換えない。レビュー本文は保存しない |
| `unresolved_threads` | 判定メタデータ取得後に存在。0以上の整数 | 0は未解決なし。欠落・null・不正な型は情報不足 |
| `checks` | 判定メタデータ取得後に存在。`CheckRun`または`CommitStatus`の配列 | `[]`は取得済みのCIなし。必須Checkは未実行として待機。欠落・nullは情報不足 |
| `ci_history` | 初回取得完了後の補助情報。`CIHistory[]` | 判定に加点しない。旧データの欠落はSummaryでnull表示 |
| `rechecked` | 再取得完了後の診断情報。各グループの一致boolean | 欠落していても推測で補わない。判定は`stable`を使用 |
| `observation_changes` | 任意の診断情報。`ObservationChange[]`またはnull | 欠落/nullは差分情報なし。`[]`は比較完了・差分なし。要素ありは変更フィールドと前後値。判定はこの配列から再計算しない |

`PullRequest`の判定用項目は`state`、`draft`、`head_sha`、`base_sha`、`merge_sha`、`mergeable`、`merge_state`、`review_decision`です。`number`は対象識別、`base_ref`と`updated_at`は公開時の状態照合にも使います。collectorは取得した変更件数も保存します。
`merge_sha: null`はtest merge commitなし、`review_decision: null`はGitHubの集約レビュー判定なしを意味します。後者でも個別レビューとpolicyの必要承認数は別に評価します。

Check Runの発行元は`app_id`、legacy statusの発行元は`creator`です。両者は`kind`で区別し、`name`・発行元・`sha`・最新`id`を照合します。実行中の`conclusion: null`を成功へ補完しません。レビューの`submitted_at`・`commit_sha`・`author`はAPIでnullになり得ますが、公開済みレビューを判定する際は既存の必須値検証とhead照合を行います。`PENDING`は公開済みレビューに含めません。

任意項目の欠落は、必須条件の欠落とは扱いが異なります。型に記述した項目を一括でデフォルト値へ変換する処理は追加していません。既存の実行時検証を新しい厳格なschema validatorへ置き換える変更も、この分離には含めません。

## policy・判定結果・artifact

`Policy`の必須項目は`version: 2`、`mode: shadow`、`minimum_approvals`、`require_resolved_threads`、`required_checks`です。
`required_checks`は空にできず、Check Runには正の`app_id`、statusには空でない`creator`を指定します。policy不正は設定エラーとして従来どおり例外にし、観測が条件達成した結果は返しません。

`Assessment`は`schema_version`、`mode`、4種類の`decision`、`conditions`、入力を保持する`observations`と`policy`、`policy_sha256`を持ちます。
各conditionは`name`・`status`・`detail`です。statusは`pass` / `waiting` / `blocked` / `unknown`、detailは理由文・件数・CI記録など条件ごとに異なります。欠落を検出するまでに評価した条件も残し、`data_integrity: unknown`を追加します。
policy指紋は従来どおりキーをソートしたJSONのSHA-256です。タプルをJSON配列へ変換する既存の保存形式も維持します。

`Manifest`の`reports`はPR番号の配列です。`[]`は対象なし、`collection_failed`は全体収集の失敗を表します。PR単位の情報不足は当該PRのJSONに残り、manifestの対象から除外しません。
`run_id`と`run_attempt`はActions環境変数の文字列で、ローカルで未指定ならnullになります。Check publisherは同じrun・attempt・artifact名の一致を要求します。全体収集の失敗時は`collection-error.json`を保存し、`Assessment`として成功扱いにしません。

collectorの終了コードは、全体収集失敗またはいずれかのPRが`INSUFFICIENT_DATA`なら1、それ以外（対象なしを含む）は0です。人間確認・待機は収集処理の失敗とは区別します。

## 互換性の確認

- 分割前のmain（`90c6ac5136011de264cd3c2413e20b3e24fde48b`）で、4判定・診断情報の欠落/null/空配列・不正入力のJSON/Markdown CLI出力を採取しています。
- `test_compatibility.py`は固定した入力・時刻・run/attemptで、標準出力・artifact全ファイルのSHA-256と終了コードを`fixtures/compatibility-486.json`と比較します。採取時の完全な出力から算出した値であり、変更後の実装から期待値を生成しません。
- `test_evaluate.py`は条件判定、`test_contracts.py`は共有検証、`test_report.py`は表示、`test_collect.py`はAPI正規化・鮮度・収集失敗を担当します。共通入力例は`test_support.py`に置きます。
- `replay.py`はローカルGitの信頼済みSHAから`evaluate.py`と同じ版の`contracts.py`・`report.py`を取り出し、現在のcheckoutや`PYTHONPATH`を除外したPythonプロセスで評価します。分割前の単独評価器も実行でき、依存ファイルが欠けた分割後の評価器は失敗します。fetch・API通信は行いません。

運用・再観測・artifact取得の手順は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照してください。
