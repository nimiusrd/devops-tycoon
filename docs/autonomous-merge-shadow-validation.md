# Shadow実運用検証（Issue #479）

対象Issue: [#479](https://github.com/nimiusrd/devops-tycoon/issues/479)。手順は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照。

## 状態

この台帳は`nimiusrd/devops-tycoon`の検証結果だけを扱います。参考用Check・manifest・オフライン再評価を導入し、専用PRで状態遷移を実測しました。
観測・Check・ラベル公開とオフライン再評価の実測を記録しています。実測したケースと未実測のケースは下表で区別します。2026-09-13の指定により日次実行を廃止しました。
workflow成功、bootstrap、対象PRなしは状態遷移の成功証跡に数えません。

2026-09-13の利用者指定により、fork経由のPRは今回の検証対象・完了条件から外します。
外部協力者の信頼性はShadowの条件判定とは別に判断し、fork経由のPRは原則として自動マージしない運用方針です。
forkでの動作を確認済みとするものではありません。

## 既存の実測と確認範囲

| 対象 | 実行URL・対象SHA | 期待・観測 | 証跡の確認範囲 |
| --- | --- | --- | --- |
| devops-tycoon #487 | [run 34679050876 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34679050876)、head `2a5f5f47240713d72f24a5afa49a1d8caa7f01c5`、評価器 `a69573a34d1f2d9eedc825f2338fddd71dd6937d` | CI2件pass、Draftでwaiting、PR再取得の不一致でfreshness unknown。`INSUFFICIENT_DATA`を実JSONで確認 | artifact `shadow-observations-34679050876-1`（ID `10293605681`）を取得。取得した`pr-487.json`を当時の評価器＋保存policyで再評価し、全体一致・終了コード0 |
| devops-tycoon #480 | 同じrun・attempt、同じ評価器SHA | `HUMAN_REVIEW_REQUIRED` | 取得した`pr-480.json`を当時の評価器＋保存policyで再評価し、全体一致・終了コード0 |

上記は過去の記録であり、新しい参考用Checkの動作確認ではありません。
ZIPは最初のコンテナからの取得が403でしたが、ホスト側から取得できました。JSONのpolicy指紋は`a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85`。
#487の観測時刻は`2026-09-12T06:47:47.264195+00:00`、再取得の一致はPRのみfalse、CI・レビュー・未解決件数はtrueです。
これらの履歴JSONは、記録SHAの評価器をこのリポジトリのGit履歴から読み出して再評価しました。観測JSONはGitで管理せず、元artifactまたはGit外に保管したコピーから取得します。

## このリポジトリの設定

| リポジトリ | default branch | 購読workflow | policy |
| --- | --- | --- | --- |
| nimiusrd/devops-tycoon | main | CI | 必須2 check、通常の承認0、未解決スレッドなし。変更間隔30日超は現在headへの人間承認1件 |

## 導入PR

- devops-tycoon: [#493](https://github.com/nimiusrd/devops-tycoon/pull/493)、ラベル権限修正[#495](https://github.com/nimiusrd/devops-tycoon/pull/495)。導入後mainは`c6018ddfe554454df08fbc9b0f4465b562fed8bc`。
- 専用PRは[#494](https://github.com/nimiusrd/devops-tycoon/pull/494)。専用baseは`codex/shadow-validation-base-479`とその`-v2`。

## 導入後の実測台帳

ケース別の結果の要約と取得元は[実測詳細](./autonomous-merge-shadow-measurements-479.md)へ記録します。証跡JSONはGitで管理せず、[利用ガイドの保存方針](./autonomous-merge-shadow-mode.md#証跡の保存方針)に従います。
タイトル編集後の遅延イベント、旧メタデータ移行、欠落CheckのJSON再評価の修正後、2026-09-13にPython全87件がこのリポジトリで成功しました。

各欄にはrun URL・attempt、対象PR、head/base、評価器SHA、policy指紋、期待値、実際のdecisionとconditions、artifact名／JSON名、再評価結果を記録します。
専用PRと専用base branchで検証し、通常PRのレビュー・保護設定は変更しません。

| シナリオ | 実測状況 | 期待値・確認点 |
| --- | --- | --- |
| PR作成・CI実行中 | #494で実測 | 未観測CheckとwaitingのCI条件を確認。GitHubがUNSTABLEの場合は既存評価器の優先順位でHUMAN_REVIEW_REQUIRED |
| CI完了・安定した観測 | #494の再観測で確認 | JSONとCheck本文の判定・対象SHAが一致 |
| CI再実行開始→完了 | 未実測。Pythonテストで補う | 条件達成→未観測→条件達成 |
| コメントレビュー・未解決スレッド→解決 | #494で件数1→0を取得。取得中のCI変更も検出 | レビュー件数と条件別理由を保存 |
| head更新・base更新 | #494で実測 | 新headに別Checkを作成し、base変更時は未観測 |
| PR終了 | #494の終了runで確認 | 終了時も現在headのneutral Checkとして記録 |
| Labelsの手動実行 | 既存PRのラベルを検証で変更しないため未実行 | Check公開後にラベルpublisherを実行 |
| 日次schedule（廃止） | 廃止前のrun 34740054982 / attempt 1で#494の観測・Check・ラベル更新と再評価を確認 | 2026-09-13の利用者指定で定期実行を廃止 |
| 一部CIが未起動 | 未実測。Pythonテストで補う | policyの必須Checkをpathで免除しない |
| fork PRの表示 | 対象外（未実測） | 外部協力者の信頼性を別途判断し、原則自動マージしない方針により、今回の完了条件から除外 |
| 保存JSONのオフライン再評価 | 保存した各JSONを記録SHAで再評価 | 9件すべてで判定・条件・policy指紋を含む全体が一致。実測詳細に結果を要約 |

devops-tycoonでは2026-09-13 14:20:26 JSTに作成された`event=schedule`の[run 34740054982 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34740054982/attempts/1)を実測しました。定義は09:43 JSTで、実際のrun作成は遅れていました。対象#494のJSON・Check・ラベル更新とオフライン再評価を確認し、専用PRはマージせず閉じました。公開順序とAPI応答の照合結果は[実測詳細](./autonomous-merge-shadow-measurements-479.md#devops-tycoonの日次schedule廃止前の実測)に要約しています。

日次廃止後のCheckは対象CI完了時・PR終了時・手動実行で更新し、ラベルはLabelsの手動実行時だけ更新します。

## 変更間隔30日のレビュー条件

`stale_change_review_days = 30`を追加し、base側の最終変更から30日超の既存ファイルを含むPRで、人間の承認を要求します。詳細は[利用ガイド](./autonomous-merge-shadow-mode.md#変更間隔と人間レビュー)を参照してください。

Dev ContainerでPython全110件が成功しました。新しい条件では30日ちょうど・直後、rename・新規追加、人間/Bot・所属・head・dismissの違い、履歴欠落・API失敗・上限、baseやレビュー情報の取得中の変化を検証しています。collectorが出力したartifact形式のJSONを、保存policy・時刻・履歴で別Pythonプロセスから再評価し、ネットワークを禁止した状態で全体一致を確認しました。

この条件を有効にした実GitHub Actionsでの観測・Check・ラベル公開は未実測です。上記の導入時の実測記録と保存JSONは、この条件を追加する前のpolicyによる結果です。

## 自動テストで補うケース

Python unittestで、4判定のneutral表示、古い結果・遅延イベント、同じheadの複数PR、公開直前の変更、API 403、artifact欠落・別attempt、CI再実行、manifestの対象限定、ネットワークなしの再評価、不一致時の失敗を検証します。
collectorの既存テストは、取得失敗、観測中のCI・レビュー・head/base更新、ページング上限、同名checkの発行元・SHA照合も確認します。
これらを実GitHub APIで再現したとは扱いません。

2026-09-13のこのリポジトリでの導入前検証結果（すべてDev Container内）:

| コマンド | 結果 |
| --- | --- |
| `python3 -B -m unittest discover -s .github/autonomous-merge -p 'test_*.py'` | 84件成功、終了コード0 |
| `npm run lint` / `npm run format:check` | 成功、終了コード0 |
| actionlint 1.7.12（対象4 workflow、shellcheck連携なし） | 成功、終了コード0 |
| `replay.py`による#487・#480の再評価 | 両方`matches=true`、終了コード0 |
