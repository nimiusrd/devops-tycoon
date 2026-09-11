# Autonomous Merge Shadow Mode

Git・PR・CIの共通メタデータから、観測時点で設定条件を満たしているかを記録するPoCです。
ソースの意味、テストの有効性、コードベース固有の重要pathを解析しません。
自動マージ、承認、required checkの登録、PRコメントやラベルの変更も行いません。

## 判断材料と判定

| 項目 | 観測する事実 | 扱い |
| --- | --- | --- |
| PR状態 | open / closed / merged、Draft | openかつready for reviewを要求 |
| 競合・GitHubの総合状態 | `mergeable`、`mergeStateStatus`、`reviewDecision` | 競合なし・`CLEAN`を要求。GitHubが示す変更要求やレビュー待ちを尊重 |
| 必須CI | check名、発行元、SHA、状態、結論 | policyで明示したすべてのcheckの実行成功を要求 |
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
| `HUMAN_REVIEW_REQUIRED` | CI失敗、競合、変更要求、未解決スレッド、GitHub側のブロックなど |
| `INSUFFICIENT_DATA` | API失敗、権限不足、ページング上限、必須情報欠落、再取得時のPR・CI・レビューの変化など |

複数条件に該当するときは、情報不足、人間確認、待機の順に優先し、個々の条件をすべてレポートへ記録します。
APIの取得失敗を空配列や0件で代用しません。必須CI一覧が空のpolicyは設定エラーです。

## CIとレビューの鮮度

CIは現在のhead SHAと現在のtest merge SHAに対する結果だけを収集します。
必須checkが現在のtest mergeに存在する場合はそちらを優先し、headの成功でmergeの失敗を覆い隠しません。
同一checkの最新IDを使い、再実行中に以前の成功を採用しません。
`skipped`・`neutral`・`cancelled`は成功とみなしません。必要なcheckが存在しない場合は待機です。
Markdownだけの変更などでCIが起動しないPRも、pathから免除を推測せず待機として記録します。

承認数は同じ人を重複して数えず、現在のheadに対する承認のみ数えます。
コメントだけのレビューはその人の承認や変更要求を上書きしません。
GitHub上でdismissされたレビューは承認として使いません。変更要求はhead更新だけでは解除しません。
GitHubのレビュー総合状態も併せて確認します。

判定に使うcheck/status、レビュー、未解決スレッド数を2回取得し、PR本体の再取得結果と併せて照合します。差異または再取得の失敗は情報不足とし、照合結果を`rechecked`へ記録します。
これらはAPIを複数回読んだ観測であり、トランザクションでもロックでもありません。各項目の2回目の取得以降の変化や、取得間に変化して元に戻った状態まで検出する保証はありません。
収集後にCI・レビュー・PRは変化し得ます。保存済みレポートを後からマージ許可として再利用しないでください。
また、headに紐づくCI結果だけでは最新baseとの統合テスト実行まで証明できません。

## 実装の分離

- `.github/autonomous-merge/collect.py`：GitHub REST / GraphQL APIから観測事実を正規化するadapter。PRのsourceやartifactを取得・実行しない。
- `.github/autonomous-merge/evaluate.py`：正規化済みJSONとpolicyから仮判定する純粋な処理。GitHub接続や作業ツリーを必要としない。
- `.github/autonomous-merge/policy.toml`：リポジトリごとの必須checkとレビュー条件。
- `.github/workflows/autonomous-merge-shadow.yml`：default branchの信頼済みcollectorを実行し、SummaryとJSON artifactを保存する。
- `.github/workflows/autonomous-merge-tests.yml`：変更中のcollector・評価器のテスト。PRコードのテストは観測workflowと分離し、read-only権限で実行する。

JSONには正規化した観測事実、条件ごとの結果、観測時刻、head/base/test merge SHA、実行した評価器のSHA、policyとそのSHA-256を保存します。
履歴はActionsのrun IDとattemptで区別したartifactに30日間保持します。
PRに「現在も有効」と見えるコメントを維持しないため、pointer label・コメント探索・古い判定の書き換えは不要です。
このPRを初めて導入する時点では旧workflowはdefault branchにないため、旧コメントの移行処理はありません。

PR更新、レビュー投稿・変更・dismiss、default branch更新、指定CIの完了で観測します。
スレッド解決や外部CIの状態変更など、直接購読しないイベントは毎時の再観測、または手動実行で反映します。
CI完了時はイベントに含まれる古いSHAを使わず、現在openのPRを改めて取得します。
通常ブランチのpushはジョブを実行せず、CI完了トリガーは自身を含めません。
新しいcollectorがdefault branchにない初回導入中はbootstrapとして情報不足をSummaryへ記録します。

APIは各一覧を100件ずつ最大30ページ、1レスポンス8MBまで読みます。上限超過は部分的な成功として扱いません。
workflow全体には15分の実行上限があります。多数のPRがある場合は後続で分割実行を検討します。

## ローカル実行と検証

必要環境はPython 3.11以上です。Pythonの外部依存はありません。
GitHubへのread-only tokenは環境変数`GH_TOKEN`または`GITHUB_TOKEN`で渡します。
必要権限はContents / Pull requests / Checks / Commit statusesのreadです。書き込み・管理者権限は要求しません。

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

1. collector、評価器、テスト、workflowを配置する。
2. 信頼済みdefault branchのpolicyに、対象CIのcheck名と発行元、承認条件を設定する。
3. Shadow workflowの`workflow_run.workflows`を対象CIのworkflow名に合わせる。テストworkflowのpush対象ブランチも合わせる。
4. required checkや自動マージへ接続せず、観測を開始する。
5. 同じ条件で記録した仮判定と、人間の判断や変更後の結果を比較して条件を調整する。

パス一覧、言語別parser、テストファイル名の規約を移植する必要はありません。
別ホスティングサービスへ展開するときは、同じ観測JSONを出力するadapterを追加し、評価器へは正規化した状態を渡します。
現時点のGitHub固有の総合状態を他サービスでどう対応付けるかはadapter側の明示的な契約とします。

## 現段階の観測範囲

バイナリ・実行権限・symlink・submoduleの詳細は、使用中のPRメタデータAPIから確定できないため未収集（`null`）です。
変更行数0をバイナリとみなすなどの推測はしません。将来必要になればGitのtree metadata adapterで追加できます。
revert・修正PR・障害との関連も未収集です。後続では明示的な関連データを使い、コミットメッセージから自動的に事故原因を推定しません。
CIの履歴は返却されたcheck/statusレコードの範囲であり、同じIDを更新する再実行は過去状態まで復元できません。

このPoCの完了条件は、観測した条件と不足情報を再現可能に記録できることです。
テストの意味解析、変更規模による安全性認定、事故確率の算出、あらゆるマージ要件の代替は対象外です。
