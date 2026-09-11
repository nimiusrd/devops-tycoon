# Autonomous Merge Shadow Mode

Git・PR・CIの共通メタデータから、観測時点で設定条件を満たしているかを記録するPoCです。
ソースの意味、テストの有効性、コードベース固有の重要pathを解析しません。
自動マージ、承認、required checkの登録、PRコメントの継続更新は行いません。
判定結果の表示だけを、専用のPRラベルで更新します。ラベルは自動マージ許可ではなく、直近の観測時点の状態です。

## 判断材料と判定

| 項目 | 観測する事実 | 扱い |
| --- | --- | --- |
| PR状態 | open / closed / merged、Draft | openかつready for reviewを要求 |
| 競合・GitHubの総合状態 | `mergeable`、`mergeStateStatus`、`reviewDecision` | 競合なし・`CLEAN`を要求。GitHubが示す変更要求やレビュー待ちを尊重 |
| 必須CI | check名、発行元、SHA、状態、結論 | policyで明示したすべてのcheckの実行成功を要求 |
| CI定義の変更 | 検証定義の追加・変更・削除・移動 | CI成功でも人間確認。GitHub adapterは共通の`.github/workflows/`配下を旧・新pathで確認 |
| 鮮度 | head / base / test mergeのSHA、PR更新時刻、PR・CI・レビューの再取得結果 | 再取得で差異があれば情報不足。古いSHAのCIや承認は流用しない |
| レビュー | 各人の最新の承認・変更要求、承認時のSHA、未解決スレッド数 | 変更要求を尊重。承認人数とスレッド解決要件はpolicyで指定 |
| 変更量・形態 | 追加・削除行数、ファイル数、追加・変更・削除・移動などのAPI分類 | 観測値として保存。必須条件を相殺しない |
| CI履歴 | 同じSHA・check・発行元に対する履歴、失敗記録の後の成功 | 観測のみ。flaky testなどの原因は推測しない |

`policy.toml`には、必須checkの識別子とレビュー条件だけを指定します。
Check Runは名前とGitHub App ID、legacy commit statusはcontext名と発行者loginで照合します。
このリポジトリの初期設定は`Lint & Unit (Vitest)`と`E2E (Playwright)`、最低承認数0、未解決スレッドなしです。
最低承認数0でも、GitHub側がレビューを要求していれば条件達成にはしません。
この一覧はShadow用の明示的な条件で、branch protectionやrulesetsの全要件を自動取得したものではありません。
GitHub側の設定変更はそれらの総合状態に反映されますが、本PoCはマージ要件を網羅的に証明しません。

出力は以下の4種類です。安全性の点数や事故確率は付けません。

| Decision | 意味 |
| --- | --- |
| `SHADOW_CONDITIONS_MET` | 観測時点で設定した条件をすべて満たした。自動マージ許可ではない |
| `WAITING` | CI未実行・実行中、Draft、必要承認不足、base追随待ちなど |
| `HUMAN_REVIEW_REQUIRED` | CI定義の変更、CI失敗、競合、変更要求、未解決スレッド、GitHub側のブロックなど |
| `INSUFFICIENT_DATA` | API失敗、権限不足、ページング上限、必須情報欠落、再取得時のPR・CI・レビューの変化など |

PR一覧では次のラベルで4判定を区別します。管理対象ラベルは同時に最大1つです。無関係なラベルは変更しません。

| Decision | PRラベル | 次にすること |
| --- | --- | --- |
| `SHADOW_CONDITIONS_MET` | `shadow/要マージ判断` | 自動マージはしない。人がマージ可否を判断する |
| `WAITING` | `shadow/CI・レビュー待ち` | CI完了・Draft解除・承認・base追随などを待つ |
| `HUMAN_REVIEW_REQUIRED` | `shadow/要対応` | 競合・CI失敗・変更要求・未解決スレッドなどを人が解消する |
| `INSUFFICIENT_DATA` | `shadow/再観測が必要` | 再実行するか、次の定期観測を待つ |

ラベル説明とActionsの当該run Summaryから、観測時刻・対象SHA・JSON artifactへ辿れます。
publisherが未作成なら4ラベルを作成します。branch protectionやrulesetsの必須チェックには登録しません。

複数条件に該当するときは、情報不足、人間確認、待機の順に優先し、個々の条件をすべてレポートへ記録します。
GitHubの集約状態が`BLOCKED`でも、必要承認不足やCI実行中など明示的な待機条件がある間は、その完了後に再評価します。別にCI失敗・変更要求などがある場合は人間確認を優先します。待機条件が解消しても`BLOCKED`なら人間確認とし、条件達成には引き続き`CLEAN`を要求します。
APIの取得失敗を空配列や0件で代用しません。必須CI一覧が空のpolicyは設定エラーです。

## CIとレビューの鮮度

CIは現在のhead SHAと現在のtest merge SHAに対する結果だけを収集します。
必須checkが現在のtest mergeに存在する場合はそちらを優先し、headの成功でmergeの失敗を覆い隠しません。
同一checkの最新IDを使い、再実行中に以前の成功を採用しません。
`skipped`・`neutral`・`cancelled`は成功とみなしません。必要なcheckが存在しない場合は待機です。
Markdownだけの変更などでCIが起動しないPRも、pathから免除を推測せず待機として記録します。

GitHub ActionsのApp IDは全workflowで共通なので、名前とApp IDだけでは実行内容の信頼性を証明できません。
PRが検証定義を変更する場合は、同名の即時成功jobによる判定成立を防ぐため、必須CIが成功しても人間確認にします。
GitHub adapterは[共通のworkflow配置](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)である`.github/workflows/`配下の変更を`ci_definition_changes`へ正規化し、renameは旧・新pathの両方を調べます。
評価器はこの事実だけを使い、リポジトリ固有のpath一覧やYAMLの意味解析を必要としません。
既存workflowが呼ぶスクリプト・action・テストの実効性や、既存定義内の同名jobの妥当性までは検証しません。CI成功は実行結果の観測であり、安全性の証明ではありません。

承認数は同じ人を重複して数えず、現在のheadに対する承認のみ数えます。
コメントだけのレビューはその人の承認や変更要求を上書きしません。
GitHub上でdismissされたレビューは承認として使いません。変更要求はhead更新だけでは解除しません。
GitHubのレビュー総合状態も併せて確認します。

判定に使うcheck/status、レビュー、未解決スレッド数を2回取得し、PR本体の再取得結果と併せて照合します。差異または再取得の失敗は情報不足とし、照合結果を`rechecked`へ記録します。
これらはAPIを複数回読んだ観測であり、トランザクションでもロックでもありません。各項目の2回目の取得以降の変化や、取得間に変化して元に戻った状態まで検出する保証はありません。
収集後にCI・レビュー・PRは変化し得ます。保存済みレポートを後からマージ許可として再利用しないでください。
また、headに紐づくCI結果だけでは最新baseとの統合テスト実行まで証明できません。

## 実装の分離

- `.github/autonomous-merge/collect.py`：GitHub REST / GraphQL APIから観測事実を正規化するadapter。source本文やartifactの個別取得・実行は行わず、ファイル一覧APIに同梱されるpatchも参照・保存しない。書き込みは行わない。
- `.github/autonomous-merge/evaluate.py`：正規化済みJSONとpolicyから仮判定する純粋な処理。GitHub接続や作業ツリーを必要としない。
- `.github/autonomous-merge/publish.py`：保存済みJSONの`decision`をPRラベルへ写す処理。判定の再計算はしない。
- `.github/autonomous-merge/policy.toml`：リポジトリごとの必須checkとレビュー条件。
- `.github/workflows/autonomous-merge-shadow.yml`：default branchの信頼済みcollectorをread-onlyで実行し、SummaryとJSON artifactを保存する。ラベル更新は独立した`publish` jobだけが行う。
- `.github/workflows/autonomous-merge-tests.yml`：変更中のcollector・評価器・publisherのテスト。PRコードのテストは観測workflowと分離し、read-only権限で実行する。

JSONには正規化した観測事実、条件ごとの結果、観測時刻、head/base/test merge SHA、実行した評価器のSHA、policyとそのSHA-256を保存します。
履歴はActionsのrun IDとattemptで区別したartifactに30日間保持します。
Summaryには当該観測runへのURLを追記します。PRコメントは作成・更新しません。
collectorやpublisherがdefault branchにない初回導入中はbootstrapとして情報不足をSummaryへ記録し、ラベルは更新しません。

## ラベルの失効と後着

ラベルは「今も有効なマージ許可」ではなく、直近に成功したラベル更新です。publisherは書き込み直前にPRを再取得します。

| 状況 | ラベルの扱い |
| --- | --- |
| 観測のhead/base SHA、base ref、open/closed/merged、Draftが現在のPRと不一致 | 変更しない。新しい観測の表示を残す |
| より新しい開始時刻（`run_started_at`）または`observed_at`の観測がある | 未着手なら変更しない。一度書き始めたら`desired`まで完了する。再実行はrun IDより開始時刻を優先する |
| 観測していない通常ブランチの`push` run | 後着とは扱わない |
| PR指定の`workflow_dispatch` | 指定したPRだけを後着とみなす |
| 全体観測（schedule / `workflow_run` / default branch push / `shadow-all`） | open PRに後着として効く。完了した全体run、および進行中でも対象PRのpublish jobが完了した全体runは、回収対象のclosed PRにも後着として効く |
| 対象PRが分かる収集失敗 | `shadow/再観測が必要`を付け、`shadow/要マージ判断`を残さない |
| 収集失敗だけでPR番号が分からない | どのPRも変更しない |
| close / merge | evaluatorの`HUMAN_REVIEW_REQUIRED`を`shadow/要対応`として反映する |
| 再評価待ち | 既存トリガー（PR更新、レビュー、CI完了、毎時cron、手動）で再観測する |
| ラベル書き込み失敗 | `publish` jobを失敗させる。SummaryとJSONはobserve側に残し、判定成功とは扱わない |

同じPRを対象にする新しいShadow runがある場合も、未着手なら上書きしません。
後着判定は`run_started_at`（なければ`created_at` / 観測時刻）を優先し、古いrunの再実行が新しいIDの失敗runより後なら破棄しません。
`observe` の並行グループだけ `cancel-in-progress: true` です。workflow全体はキャンセルせず、実行中の`publish`を保護します。
`publish` jobは先頭256件をPR番号ごとのmatrixにします。257–512件目もPR番号ごとのoverflow matrixです。同じPRは同じconcurrency groupで直列化し、無関係なPRはpending枠を共有しません。`cancel-in-progress: false` です。対象が512件を超える場合は`GITHUB_RUN_NUMBER`で一覧を回転してから切り出すので、513件目以降も後続の定期観測で先頭側に入ります。
一度ラベル変更を始めた後は、後着判定で途中終了せず管理ラベルが1つになるまで収束します。
後着判定のrun履歴は`prepare-publish`が1回取得して各PRのpublish jobへ渡します。各PRの最初の書き込み直前に進行中runと直近1ページだけ再確認します。再取得した同じrun IDは共有履歴より優先し、履歴がページ上限まで埋まっている場合は部分履歴で続行せず失敗します。鮮度は同じ開始時刻同士で比較し、publisher単独再実行ではより古い`observed_at`を使います。観測artifactに`run_started_at`が無い場合は公開しません。ラベル更新は追加先行で、再追加後も競合ラベルを除去して一意な状態を確認します。公開先のない失敗broadcastと、publish jobが動かなかった成功runは後着にしません。後着になり得るrunだけjobsを`filter=all`で確認し、過去attemptの成功済みpublishも後着とします。結果はrun ID・attempt・status・conclusion単位で再利用します。jobs APIを確認できない場合は未公開と断定せず書き込みません。publisher単独再実行は観測artifactに残した元attemptの開始時刻を使います。書き込み直前のID再取得は、共有snapshot時点で未完了だった既知runだけに限定します。完了済みrunの更新は進行中statusと直近1ページで拾います。1 jobが複数PRを処理する場合、ラベル定義の確認はループ外で一度だけ行います。
`skipped`のrunは後着にしません。`cancelled`でも対象PRのpublish jobが完了していれば後着です。jobsを確認できない`cancelled`は未公開と断定せず書き込みません。`failure`でも観測レポートを出している場合は後着として扱います。publisher単独再実行は選択した観測artifactのattemptと`observed_at`で鮮度を判定します。
`workflow_dispatch` の対象はrun名が`shadow-pr-N`または`shadow-all`に完全一致する場合だけ宣言として扱います。
`workflow_run`とdefault branchの`push`は、RESTの`pull_requests`関連付けより先に全体観測として扱います。
fork由来PRの`pull_request_review`ではwrite tokenが降格されるため`publish`を起動せず、scheduleやCI完了の後続観測でラベルを更新します。
`publish`が単独再実行されたときは、同じrun IDの最新観測artifactへフォールバックします。

PR更新、レビュー投稿・変更・dismiss、default branch更新、指定CIの完了で観測します。
スレッド解決や外部CIの状態変更など、直接購読しないイベントは毎時の再観測、または手動実行で反映します。
CI完了時はイベントに含まれる古いSHAを使わず、現在openのPRと、close処理が未完了のclosed PR（`shadow/要マージ判断`・`shadow/CI・レビュー待ち`・`shadow/再観測が必要`）を改めて取得します。正常に`shadow/要対応`へ更新済みのclosed PRは再収集しません。`observe`はActions read権限で現在runの開始時刻をartifactへ残します。開始時刻はPRループの前に一度だけ取得し、収集失敗の`collection-error.json`にも残します。取得失敗は`collection_errors`に記録し、publisherは開始時刻なしの観測も収集失敗も公開しません。
通常ブランチのpushはジョブを実行せず、CI完了トリガーは自身を含めません。

APIは各一覧を100件ずつ最大30ページ、1レスポンス8MBまで読みます。上限超過は部分的な成功として扱いません。
workflow全体には15分の実行上限があります。多数のPRがある場合は後続で分割実行を検討します。

## ローカル実行と検証

必要環境はPython 3.11以上です。Pythonの外部依存はありません。
GitHub tokenは環境変数`GH_TOKEN`または`GITHUB_TOKEN`で渡します。CLI引数には含めません。
collectorの必要権限はContents / Pull requests / Checks / Commit statusesのreadです。
publisherの必要権限はPull requestsとIssuesのwrite、Actionsのreadです。書き込み権限は`publish` jobだけに付けます。

本リポジトリではDev Container内から実行します。

```bash
devcontainer exec --workspace-folder . python3 -B -m unittest discover \
  -s .github/autonomous-merge -p 'test_*.py'

devcontainer exec --workspace-folder . python3 -B .github/autonomous-merge/collect.py \
  --repository nimiusrd/devops-tycoon --pr 465 \
  --policy .github/autonomous-merge/policy.toml \
  --evaluator-sha <実行する評価器の40桁コミットSHA> \
  --output /tmp/shadow-report
```

tokenはDev Containerへ環境変数として渡してください。CLI引数には含めません。
保存した`pr-465.json`の`observations`オブジェクトをJSONとして取り出すと、ネットワークなしで再評価できます。

```bash
python3 -B .github/autonomous-merge/evaluate.py \
  --facts /tmp/observations.json \
  --policy .github/autonomous-merge/policy.toml --format markdown

python3 -B .github/autonomous-merge/publish.py \
  --repository nimiusrd/devops-tycoon \
  --report-dir /tmp/shadow-report \
  --run-id 1 --run-attempt 1 \
  --run-url https://github.com/nimiusrd/devops-tycoon/actions/runs/1
```

## 他コードベースへの展開

1. collector、評価器、publisher、テスト、workflowを配置する。
2. 信頼済みdefault branchのpolicyに、対象CIのcheck名と発行元、承認条件を設定する。
3. Shadow workflowの`workflow_run.workflows`を対象CIのworkflow名に合わせる。テストworkflowのpush対象ブランチも合わせる。
4. `publish` jobにだけPull requests / Issuesのwriteを付け、4つの`shadow/`ラベルは初回実行で作成する。branch protectionの必須チェックや自動マージには接続しない。
5. required checkや自動マージへ接続せず、観測とラベル表示を開始する。
6. 同じ条件で記録した仮判定と、人間の判断や変更後の結果を比較して条件を調整する。

コードベース固有のパス一覧、言語別parser、テストファイル名の規約を移植する必要はありません。
別ホスティングサービスへ展開するときは、同じ観測JSONを出力するadapterを追加し、評価器へは正規化した状態を渡します。
現時点のGitHub固有の総合状態やCI定義の配置を他サービスでどう対応付けるかはadapter側の明示的な契約とします。

## 現段階の観測範囲

バイナリ・実行権限・symlink・submoduleの詳細は、使用中のPRメタデータAPIから確定できないため未収集（`null`）です。
変更行数0をバイナリとみなすなどの推測はしません。将来必要になればGitのtree metadata adapterで追加できます。
revert・修正PR・障害との関連も未収集です。後続では明示的な関連データを使い、コミットメッセージから自動的に事故原因を推定しません。
CIの履歴は返却されたcheck/statusレコードの範囲であり、同じIDを更新する再実行は過去状態まで復元できません。

このPoCの完了条件は、観測した条件と不足情報を再現可能に記録できることです。
テストの意味解析、変更規模による安全性認定、事故確率の算出、あらゆるマージ要件の代替は対象外です。
