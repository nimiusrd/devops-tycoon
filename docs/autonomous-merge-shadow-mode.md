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

PR一覧では次のラベルで4判定を区別します。更新完了時の管理対象ラベルはopen PRごとに1つです。無関係なラベルは変更しません。

| Decision | PRラベル | 次にすること |
| --- | --- | --- |
| `SHADOW_CONDITIONS_MET` | `shadow/要マージ判断` | 自動マージはしない。人がマージ可否を判断する |
| `WAITING` | `shadow/CI・レビュー待ち` | CI完了・Draft解除・承認・base追随などを待つ |
| `HUMAN_REVIEW_REQUIRED` | `shadow/要対応` | 競合・CI失敗・変更要求・未解決スレッドなどを人が解消する |
| `INSUFFICIENT_DATA` | `shadow/再観測が必要` | 再実行するか、次の定期観測を待つ |

ラベル用の観測時刻・対象SHA・JSON artifactは、Actionsの`Autonomous Merge Labels`のrun Summaryで確認できます。
publisherが未作成のラベル定義を作成します。branch protectionやrulesetsの必須チェックには登録しません。

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
- `.github/workflows/autonomous-merge-shadow.yml`：`CI`完了時・PR終了時・手動でread-onlyで観測し、SummaryとJSON artifactを保存する。
- `.github/workflows/autonomous-merge-labels.yml`：1日1回・手動で全open PRをread-onlyで観測した後、独立した`publish` jobがラベルを更新する。観測開始から公開完了までworkflow全体を直列実行する。
- `.github/workflows/autonomous-merge-tests.yml`：変更中のcollector・評価器・publisherのテスト。PRコードのテストは観測workflowと分離し、read-only権限で実行する。

JSONには正規化した観測事実、条件ごとの結果、観測時刻、head/base/test merge SHA、実行した評価器のSHA、policyとそのSHA-256を保存します。
履歴はActionsのrun IDとattemptで区別したartifactに30日間保持します。

## 観測の目的・トリガー・更新頻度

| workflow | 目的 | トリガー・対象 | 出力 |
| --- | --- | --- | --- |
| `Autonomous Merge Shadow` | 必須CI完了後・PR終了時の状態や、必要な時点の判断材料を記録する | `CI`の完了時は全open PR。PRのclose / merge時は対象PR。手動実行は`pr_number`で指定したPR、空欄なら全open PR | SummaryとJSON artifact。ラベルは変更しない |
| `Autonomous Merge Labels` | PR一覧の参考表示を定期更新し、CI以外の変化も観測する | 毎日09:43 JST（00:43 UTC）と手動実行で全open PR | SummaryとJSON artifact、PRラベル |

Shadowの毎時cronは停止し、定期観測をLabelsの日次実行に集約します。
PRの作成・更新とmainへのpushは通常`CI`を起動するため、PR作成・更新とpushの直接トリガーを削除し、そのCI完了後に観測します。
必須checkを含まない`Autonomous Merge Tests`の完了も購読しません。`CI`と補助テストの両方が動く変更での二重観測を減らします。
CIの成功・失敗・キャンセルを問わず完了時に観測し、実行イベントの古いSHAではなく、その時点の全open PRの状態を取得します。
自身やLabelsの完了は購読しません。観測・評価ロジックとread-only権限は変更しません。

close / mergeは`pull_request_target: closed`で対象PRを観測し、Summary／JSON artifactに終端状態を記録します。日次観測はopen PRだけを対象とするため、この経路を残します。
終了イベントの観測に失敗した場合は、対象PR番号を指定して手動で再観測してください。ラベル削除はLabelsの次回更新が担当します。

レビューの投稿・編集・dismiss、スレッド解決、Draft変更、CI対象外の文書変更などは直接の観測トリガーにしません。
これらの変化は、次の`CI`完了時、日次観測、または手動実行で反映します。通常は次の日次観測までの遅れを許容します。
Actionsの実行遅延・キャンセル・API障害により、24時間以内の反映を保証するものではありません。
直ちに判断材料が必要ならActionsの`Autonomous Merge Shadow`から **Run workflow** を実行し、必要に応じて`pr_number`を指定してください。
ラベルも更新したい場合は`Autonomous Merge Labels`を手動実行します。

CI完了の観測は同じconcurrency groupで実行中の古い観測をキャンセルし、後続runで全open PRを取得し直します。
終了イベントはPR番号ごとのgroupに分け、別PRの終了やCI完了でキャンセルされないようにします。手動観測もCI完了とは別groupです。日次実行との時間的な重なりやCI再実行による重複は許容し、厳密な即時反映・重複排除のためのrun履歴追跡や複雑なキューは導入しません。
各レポートは観測時点の記録であり、現在の状態は実行時刻と対象SHAを確認して判断します。

## ラベルの更新方針

ラベルは1日1回（日本時間09:43、UTC 00:43）と`Autonomous Merge Labels`の手動実行で全体更新します。
`CI`完了時・PR終了時・手動の`Autonomous Merge Shadow`の観測では、ラベルは変更しません。
ラベルは次回の更新成功まで古くなり得る参考表示です。即時反映や常時の正確性、自動マージ許可は保証しません。
定期実行の遅延やAPI障害もあるため、24時間以内の反映を保証するものではありません。

更新の仕組みは「全open PRの観測 → ラベル公開」の2 jobです。
共通のconcurrency groupでworkflow全体を直列化し、`cancel-in-progress: false`で実行中の更新を後続runがキャンセルしないようにします。
待機runが置き換わっても、次に実行するrunが全open PRを取得し直すため、個別PRのイベントをキューに保存する必要はありません。
runの順番に依存せず、そのrunの実行時点の状態を観測します。過去run・jobの履歴走査やPR別matrixは使いません。

publishは**同じrun ID・同じattempt**のartifactだけを読みます。過去attemptへのフォールバックはしません。
publishだけを再実行すると新attemptの観測artifactが無いため失敗します。復旧には新しい手動実行、または**Re-run all jobs**で観測からやり直してください。
GitHubの[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)と[再実行](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)の仕様を前提とします。

| 状況 | ラベルの扱い |
| --- | --- |
| 観測と現在のhead/base SHA・base ref・open状態・Draftが一致 | 4判定に対応するラベルを表示する |
| 観測後にPRが変化、または対象PRの収集が情報不足 | `shadow/再観測が必要`にする |
| 全体の収集失敗で対象PRが不明 | open PRの既存ラベルを維持し、runを失敗として記録する |
| close / merge | 管理ラベルを取り除く。既にclosedで管理ラベルが残るPRも毎回回収する |
| 追加・削除APIの失敗や手動キャンセル | 一時的に古いラベルや複数ラベルが残り得る。次回の更新で修復する |

書き込み直前にPRを再取得し、新ラベルの追加に成功してから旧管理ラベルだけを削除します。
ラベル更新はトランザクションではなく、PRの再取得後の変更や、人による管理ラベルの同時編集までは排他しません。
管理ラベルの自動更新元はこのworkflowだけとし、ラベル全件を置き換えるAPIは使いません。
closed PRの回収では管理ラベルが残るPRだけを列挙し、削除前に状態を再確認します。通常のIssueは変更しません。

APIは各一覧を100件ずつ最大30ページ、1レスポンス8MBまで読みます。上限超過は失敗として扱います。
ラベルworkflowは各jobに15分の上限があります。大量PRで完走できない場合の分割処理は今回の対象外です。

## 観測中の状態変化・終了コードの診断

collectorは初回と再取得のPR・CI・レビューの正規化メタデータを比較します。
一致しない場合は`stable=false`のまま`INSUFFICIENT_DATA`とし、条件達成には読み替えません。
CIが実行中というだけなら`WAITING`ですが、観測の間にCI状態が変わった場合は鮮度不一致です。

Summaryの「観測間の変化」とJSONの`observations.observation_changes`に、変わった項目だけを記録します。
各項目には`group`、`identity`、`field`、`before`、`after`があります。
PRは`head_sha`・`updated_at`等のフィールド、CIはkind・SHA・IDと名前・producer、レビューはIDとauthorで識別します。
レコードの追加・削除は`field=record`で、存在しない側を`null`にします。未解決スレッドは個々の本文やIDを取得せず、比較対象の件数（`count`）の変化を示します。
値は既存の正規化済みメタデータだけを使い、source本文・patch・レビュー本文・tokenは保存しません。
`[]`は比較対象の変化なし、`null`は再取得未完了です。旧artifactではこのキー自体がありません。
これは既存の比較範囲の診断であり、同じ未解決件数のまま別スレッドが解決・未解決になった場合などを追加検出するものではありません。

jobログはPRごとのJSON行に`decision`と`reason`を出力します。
`reason=freshness_mismatch`は取得を完了した観測間の不一致、`collection_error`はAPI失敗・権限不足・取得データ不正などの収集エラーです。
収集エラーの詳細は`collection_errors`（全体エラーでは`error`）、不一致の分類は`changed_groups`、詳細な前後値は指定されたJSON artifactとSummaryで確認します。
その他の情報不足は`insufficient_data`、通常の判定完了は`evaluated`です。

終了コードは従来どおりです。レポート保存の成功と条件判定の成功は別です。

| 判定・状態 | collector終了コード | Actionsの観測job（他のstepが成功した場合） |
| --- | --- | --- |
| `SHADOW_CONDITIONS_MET` | 0 | success |
| `WAITING` | 0 | success |
| `HUMAN_REVIEW_REQUIRED` | 0 | success |
| `INSUFFICIENT_DATA`（鮮度不一致を含む） | 1 | failure |
| 全体の収集失敗 | 1 | failure |
| 対象PRなし | 0 | success |

複数PRのうち1件でも情報不足なら全体の終了コードは1です。最後のログ行に`collector_exit_code`を記録します。
Summaryとartifactは観測stepの失敗時も保存を試みますが、キャンセル・タイムアウト・保存自体の失敗では生成されないことがあります。
Shadowは必須CIではなく、failureだけでAPI障害やPR自体の不具合とは断定できません。
Labelsの`publish`は従来どおり`observe`のsuccess/failure双方から実行され、同じattemptのレポートを使用します。
対象PRの情報不足は`shadow/再観測が必要`、対象不明の全体収集失敗では既存ラベルを維持します。公開が成功しても観測jobのfailureは残ります。

状態が落ち着いた後、Actionsの`Autonomous Merge Shadow`で **Run workflow** を実行し、`pr_number`を指定して再観測してください。
ラベルも更新したい場合は`Autonomous Merge Labels`の新しい手動実行、または **Re-run all jobs** を使います。publishだけの再実行は使いません。
次のCI完了時のShadow観測や、Labelsの日次観測を待つこともできます。自動リトライ・過去run走査は導入していません。

## ローカル実行と検証

必要環境はPython 3.11以上です。Pythonの外部依存はありません。
GitHub tokenは環境変数`GH_TOKEN`または`GITHUB_TOKEN`で渡します。CLI引数には含めません。
collectorの必要権限はContents / Pull requests / Checks / Commit statusesのreadです。
publisherにはContents / Pull requestsのreadとIssuesのwriteを付けます。ラベル定義の作成とPRラベル更新は`publish` jobだけが行います。
両jobともdefault branchのコードだけを実行し、PRのコードをwrite権限で実行しません。

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
```

## 他コードベースへの展開

1. collector、評価器、publisher、テスト、workflowを配置する。
2. 信頼済みdefault branchのpolicyに、対象CIのcheck名と発行元、承認条件を設定する。
3. Shadow workflowの`workflow_run.workflows`を対象CIのworkflow名に合わせる。テストworkflowのpush対象ブランチも合わせる。
4. ラベルworkflowの`publish` jobにだけIssuesのwriteを付ける。4つの`shadow/`ラベルは初回更新で作成する。branch protectionの必須チェックや自動マージには接続しない。
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
