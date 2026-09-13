# Shadow実運用・移植検証（Issue #479）

対象Issue: [#479](https://github.com/nimiusrd/devops-tycoon/issues/479)。手順は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照。

## 状態

参考用Check・manifest・オフライン再評価を両リポジトリへ導入し、専用PRで状態遷移を実測しました。
残る実測は日次scheduleです。この実測が完了するまで、Issueの受け入れ条件を完了扱いにしません。
workflow成功、bootstrap、対象PRなしは状態遷移の成功証跡に数えません。

2026-09-13の利用者指定により、fork経由のPRは今回の検証対象・完了条件から外します。
外部協力者の信頼性はShadowの条件判定とは別に判断し、fork経由のPRは原則として自動マージしない運用方針です。
forkでの動作を確認済みとするものではありません。

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
移植先のPrettierは`.github/**/*`を明示的に検査するため、Python/TOMLと生成された`__pycache__`を`.prettierignore`へ追加しました。workflow YAMLは移植先のPrettier書式に合わせます。

## 導入PR

- devops-tycoon: [#493](https://github.com/nimiusrd/devops-tycoon/pull/493)、ラベル権限修正[#495](https://github.com/nimiusrd/devops-tycoon/pull/495)。導入後mainは`c6018ddfe554454df08fbc9b0f4465b562fed8bc`。
- nimius-player: [#224](https://github.com/nimiusrd/nimius-player/pull/224)、順序判定・再評価修正[#226](https://github.com/nimiusrd/nimius-player/pull/226)、ラベル権限修正[#227](https://github.com/nimiusrd/nimius-player/pull/227)。導入後mainは`7c18fc579a2ae7eb8851f4c0c13509ab2548f0e9`。
- 専用PRはdevops-tycoon [#494](https://github.com/nimiusrd/devops-tycoon/pull/494)、nimius-player [#225](https://github.com/nimiusrd/nimius-player/pull/225)。専用baseは両方とも`codex/shadow-validation-base-479`とその`-v2`。

## 導入後の実測台帳

実JSONとケース別の結果は[実測詳細](./autonomous-merge-shadow-measurements-479.md)へ保存します。
実測で見つかったタイトル編集後の遅延イベント、旧メタデータ移行、欠落CheckのJSON再評価を修正し、Python全87件が両リポジトリで成功しました。

各欄にはrun URL・attempt、対象PR、head/base、評価器SHA、policy指紋、期待値、実際のdecisionとconditions、artifact名／JSON名、再評価結果を記録します。
専用PRと専用base branchで検証し、通常PRのレビュー・保護設定は変更しません。

| シナリオ | devops-tycoon | nimius-player | 期待値・確認点 |
| --- | --- | --- | --- |
| PR作成・CI実行中 | #494で実測 | #225で実測 | 未観測CheckとwaitingのCI条件を確認。GitHubがUNSTABLEの場合は既存評価器の優先順位でHUMAN_REVIEW_REQUIRED |
| CI完了・安定した観測 | #494の再観測で確認 | 7件成功で条件達成 | JSONとCheck本文の判定・対象SHAが一致 |
| CI再実行開始→完了 | 共通コードを移植先で実測 | frontend attempt 2で実測 | 条件達成→未観測→条件達成 |
| コメントレビュー・未解決スレッド→解決 | #494で件数1を取得。取得中のCI変更も検出 | #225で1→0、HUMAN_REVIEW_REQUIRED→WAITING | レビュー件数と条件別理由を保存 |
| head更新・base更新 | #494で実測 | #225で実測 | 新headに別Checkを作成し、base変更時は未観測 |
| PR終了 | #494の終了runで確認 | #225の終了runでCLOSEDを保存 | 終了時も現在headのneutral Checkとして記録 |
| Labelsの手動実行 | 既存PRのラベルを検証で変更しないため未実行 | #225で3 job成功・ラベル付与 | Check公開後にラベルpublisherを実行 |
| 日次schedule | 次回09:43 JST待ち | 次回09:43 JST待ち | 手動Labelsを日次scheduleの実測と混同しない |
| 一部CIが未起動 | 共通コードを移植先で実測 | css欠落でWAITING | policyの必須Checkをpathで免除しない |
| fork PRの表示 | 対象外（未実測） | 対象外（未実測） | 外部協力者の信頼性を別途判断し、原則自動マージしない方針により、今回の完了条件から除外 |
| 保存JSONのオフライン再評価 | 保存した各JSONを記録SHAで再評価 | 保存した各JSONを記録SHAで再評価 | 判定・条件・policy指紋を含む全体一致。結果JSONを実測詳細から参照 |

日次の次回予定は2026-09-14 09:43 JST（遅延する場合あり）です。devops-tycoon #494とnimius-player #225を再開して日次の観測対象として残します。次回runに対象PRが含まれることと、観測・Check公開・ラベル更新の成功を確認してから、この欄を更新してください。

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
この検証用コンテナ内の新規Cargoキャッシュを削除し、上記Python/Nodeチェックを実行しました。ローカルRustビルドの成功とは扱いません。GitHub Actionsでは移植PRと修正PRのtauri-rust / Windows compile checkが成功しました（例: [run 34733025070](https://github.com/nimiusrd/nimius-player/actions/runs/34733025070)）。
