# Shadow実運用・移植検証（Issue #479）

対象Issue: [#479](https://github.com/nimiusrd/devops-tycoon/issues/479)。手順は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照。

## 状態

参考用Check・manifest・オフライン再評価を実装し、導入前の自動テストと過去の実JSON2件の再評価が完了した段階です。
default branch導入後の実測が揃うまで、Issueの受け入れ条件を完了扱いにしません。
workflow成功、bootstrap、対象PRなしは状態遷移の成功証跡に数えません。

## 既存の実測と確認範囲

| 対象 | 実行URL・対象SHA | 期待・観測 | 証跡の確認範囲 |
| --- | --- | --- | --- |
| devops-tycoon #487 | [run 34679050876 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34679050876)、head `2a5f5f47240713d72f24a5afa49a1d8caa7f01c5`、評価器 `a69573a34d1f2d9eedc825f2338fddd71dd6937d` | CI2件pass、Draftでwaiting、PR再取得の不一致でfreshness unknown。`INSUFFICIENT_DATA`を実JSONで確認 | artifact `shadow-observations-34679050876-1`（ID `10293605681`）を取得。[保存JSON](./shadow-observations/34679050876-1/pr-487.json)を当時の評価器＋保存policyで再評価し、全体一致・終了コード0 |
| devops-tycoon #480 | 同じrun・attempt、同じ評価器SHA | `HUMAN_REVIEW_REQUIRED` | [保存JSON](./shadow-observations/34679050876-1/pr-480.json)を当時の評価器＋保存policyで再評価し、全体一致・終了コード0 |

上記は過去の記録であり、新しい参考用Checkの動作確認ではありません。
ZIPは最初のコンテナからの取得が403でしたが、ホスト側から取得できました。JSONのpolicy指紋は`a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85`。
#487の観測時刻は`2026-09-12T06:47:47.264195+00:00`、再取得の一致はPRのみfalse、CI・レビュー・未解決件数はtrueです。
これらのdevops-tycoonの履歴JSONは、同リポジトリのGit履歴を使って再評価します。

## 導入先の設定

| リポジトリ | default branch | 購読workflow | policy |
| --- | --- | --- | --- |
| nimiusrd/devops-tycoon | main | CI | 既存2 check、承認0、未解決スレッドなし |
| nimiusrd/nimius-player | main | frontend / tauri-rust / css | 7 check、GitHub Actions App ID 15368、承認0、未解決スレッドなし |

nimius-playerの調査時mainは`c337857d2e4a508959b202280c6d94aa4c485efe`。open PRはありませんでした。
Rust・React・CSSのpath filterにより、全7 checkが起動しないPRを`WAITING`とする設定です。評価器の言語・path特例は追加しません。
移植先のPrettierは`.github/**/*`を明示的に検査するため、Python/TOMLだけを`.prettierignore`へ追加します。workflow YAMLは移植先のPrettier書式に合わせます。

## 導入後の実測台帳

各欄にはrun URL・attempt、対象PR、head/base、評価器SHA、policy指紋、期待値、実際のdecisionとconditions、artifact名／JSON名、再評価結果を記録します。
専用PRと専用base branchで検証し、通常PRのレビュー・保護設定は変更しません。

| シナリオ | devops-tycoon | nimius-player | 期待値・確認点 |
| --- | --- | --- | --- |
| PR作成・CI実行中 | 未実測 | 未実測 | 現在headに未観測Check。本観測がCI未完了ならWAITING |
| CI完了・安定した観測 | 未実測 | 未実測 | JSONの条件と判定が一致し、参考用Checkから同じrun／attemptへ辿れる |
| CI再実行開始→完了 | 未実測 | 未実測 | 古い成功を現在の判断として表示しない |
| コメントレビュー・未解決スレッド→解決 | 未実測 | 未実測 | 手動観測で未解決件数と条件の変化を確認 |
| head更新・base更新 | 未実測 | 未実測 | 新headへ旧判定を引き継がない。base不一致は再観測 |
| close / mergeの終端観測 | 未実測 | 未実測 | 対象PRの終端状態がJSONに残り、CI完了経由との表示差を記録 |
| 日次LabelsとCheck公開 | 未実測 | 未実測 | 対象PRを含む日次run、Check公開後のラベル更新を確認 |
| 一部CIが未起動 | 未実測 | 未実測 | policyの欠けたcheckをWAITINGとし、pathから免除しない |
| fork PRの表示 | 未実測 | 未実測 | CheckのAPI上の作成とPR画面への紐付けを区別。見えない場合はActions導線を確認 |
| 保存JSONのオフライン再評価 | 未実測 | 未実測 | 記録SHAの評価器＋保存policyでレポート全体が一致 |

## 自動テストで補うケース

Python unittestで、4判定のneutral表示、古い結果・遅延イベント、同じheadの複数PR、公開直前の変更、API 403、artifact欠落・別attempt、CI再実行、manifestの対象限定、ネットワークなしの再評価、不一致時の失敗を検証します。
collectorの既存テストは、取得失敗、観測中のCI・レビュー・head/base更新、ページング上限、同名checkの発行元・SHA照合も確認します。
これらを実GitHub APIで再現したとは扱いません。

2026-09-13の導入前検証結果（すべてDev Container内）:

| リポジトリ | コマンド | 結果 |
| --- | --- | --- |
| 両リポジトリ | `python3 -B -m unittest discover -s .github/autonomous-merge -p 'test_*.py'` | 84件成功、終了コード0 |
| 両リポジトリ | `npm run lint` / `npm run format:check` | 成功、終了コード0 |
| nimius-player | `npm test -- --maxWorkers=2` | 63ファイル・841件成功、終了コード0 |
| devops-tycoon | actionlint 1.7.12（対象4 workflow、shellcheck連携なし） | 成功、終了コード0 |
| devops-tycoon | `replay.py`による#487・#480の再評価 | 両方`matches=true`、終了コード0 |

nimius-playerの新規Dev ContainerはNode/Python/npm依存の準備後、`cargo fetch`のWindows依存展開中にディスク不足でpostCreateが停止しました。
この検証用コンテナ内の新規Cargoキャッシュを削除し、上記Python/Nodeチェックを実行しました。Rust実装は変更しておらず、Rustビルド成功とは扱いません。
