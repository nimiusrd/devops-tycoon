# Shadow実測詳細（Issue #479）

> これは旧実装による Issue #479 の履歴です。現在の操作は[利用案内](./pr-merge-readiness.md)、独立 Action の実測は[Issue #499 検証記録](./pr-merge-readiness-validation-499.md)を参照してください。旧実装は削除済みで、この文書の旧形式を新 Action に入力することはできません。

2026-09-13にActionsのGITHUB_TOKENで収集しました。実行成功とShadowの判定は別々に確認します。本文のSHA・policy・条件は保存JSONから転記しています。

導入状態と未実測項目は[検証台帳](./autonomous-merge-shadow-validation.md)、操作方法は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照してください。

対象は`nimiusrd/devops-tycoon`のみです。本文には当時の実測結果の要約と取得元を残し、観測JSON・API応答・再評価結果JSONはGitで管理しません。取得・保管方法は[利用ガイドの保存方針](./autonomous-merge-shadow-mode.md#証跡の保存方針)を参照してください。

## nimiusrd/devops-tycoon

下表の観測JSONの取得元は、各runの`shadow-observations-<run ID>-<attempt>`です。日次scheduleのrun 34740054982だけは`shadow-labels-34740054982-1`から取得しました。

| 評価器SHA | Policy SHA-256 |
| --- | --- |
| `0b67f39251b9753f2cf7400d9996dd7688642ba8` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `0d8f67cebfefde2310afd92d2e43a1affeace31a` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `c6018ddfe554454df08fbc9b0f4465b562fed8bc` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `ce102648b69aed73195823188e761977d529e571` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |

| ケース / 期待 | 実行 / artifact内のJSON | 観測結果・理由 |
| --- | --- | --- |
| 導入前のCI実行中 / CI条件はwaiting。CI定義変更は人間確認 | [run 34731536809 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34731536809/attempts/1)、`pr-493.json` | `HUMAN_REVIEW_REQUIRED`。unchanged_ci_definitions=blocked（['.github/workflows/autonomous-merge-checks.yml', '.github/workflows/autonomous-merge-labels.yml', '.github/workflows/autonomous-merge-shadow.yml']）; required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=waiting（BLOCKED） |
| 専用PRのCI実行中 / CI条件はwaiting。GitHub総合状態も尊重 | [run 34733205454 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733205454/attempts/1)、`pr-494.json` | `HUMAN_REVIEW_REQUIRED`。required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=blocked（UNSTABLE） |
| 未解決スレッド・取得中のCI完了 / 未解決件数1を記録。取得中の変化は情報不足 | [run 34733401829 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733401829/attempts/1)、`pr-494.json` | `INSUFFICIENT_DATA`。freshness=unknown（PR, CI or reviews changed between samples; recollect）; review_threads=blocked（1）; required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=blocked（UNSTABLE） |
| CI完了経由・PR再取得の変化 / CIが成功していても再取得でPRが変わればINSUFFICIENT_DATA | [run 34733942476 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733942476/attempts/1)、`pr-494.json` | `INSUFFICIENT_DATA`。freshness=unknown（PR, CI or reviews changed between samples; recollect） |
| 新head/base・スレッド解決・CI完了後の再観測 / SHADOW_CONDITIONS_MET、未解決件数0 | [run 34734081199 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34734081199/attempts/1)、`pr-494.json` | `SHADOW_CONDITIONS_MET`。全条件pass |
| 専用PR終了 / open_pr=blocked、CLOSEDを過去の観測として表示 | [run 34734163954 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34734163954/attempts/1)、`pr-494.json` | `HUMAN_REVIEW_REQUIRED`。open_pr=blocked（CLOSED）; github_merge_state=blocked（UNSTABLE） |
| 日次schedule / CI条件はpass。GitHub総合状態を尊重し、観測→Check→ラベルを公開 | [run 34740054982 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34740054982/attempts/1)、`pr-494.json` | `HUMAN_REVIEW_REQUIRED`。github_merge_state=blocked（UNSTABLE）。その他の条件はpass。3 job成功、neutral Checkとshadow/要対応ラベルを確認 |

| Run | PR | 観測時刻 | head SHA | base SHA |
| --- | --- | --- | --- | --- |
| 34731536809 / 1 | #493 | `2026-09-13T01:50:52.293635+00:00` | `6b0a1540f048f308fbbd947de4eba1a15ffedc12` | `ce102648b69aed73195823188e761977d529e571` |
| 34733205454 / 1 | #494 | `2026-09-13T02:30:25.281739+00:00` | `13c6a502421b0a05d113e2a3a5223ea21261439b` | `0b67f39251b9753f2cf7400d9996dd7688642ba8` |
| 34733401829 / 1 | #494 | `2026-09-13T02:35:10.268197+00:00` | `13c6a502421b0a05d113e2a3a5223ea21261439b` | `0b67f39251b9753f2cf7400d9996dd7688642ba8` |
| 34733942476 / 1 | #494 | `2026-09-13T02:48:33.906646+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34734081199 / 1 | #494 | `2026-09-13T02:51:59.148873+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34734163954 / 1 | #494 | `2026-09-13T02:54:04.086801+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34740054982 / 1 | #494 | `2026-09-13T05:20:39.595173+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |

## Checkの実表示・取得中の変化

以下は当時取得したCheck API応答と観測JSONの確認結果です。リンクは対応するrunを示します。

- #494の初期headではCheck ID `103659352170`が未観測を表示しました。[PR作成後のrun 34733064189](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733064189/attempts/1)。head更新後は別のCheck ID `103660586537`で新headの判定を表示しました。[head更新後のrun 34733504589](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733504589/attempts/1)。
- baseを`codex/shadow-validation-base-479-v2`へ変更すると、同じheadのCheckが未観測になりました。[base変更後のrun 34733649981](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733649981/attempts/1)。観測後の新baseと判定はrun 34734081199に保存しています。
- PR終了後も現在headのCheckに`open_pr=blocked（CLOSED）`を表示しました。[終了後のrun 34734163954](https://github.com/nimiusrd/devops-tycoon/actions/runs/34734163954/attempts/1)。
- CI完了と収集が重なったrun 34733401829では、CIのstatus・conclusionなどの変化を`observation_changes`へ残し、`INSUFFICIENT_DATA`を記録しました。

## devops-tycoonの日次schedule（廃止前の実測）

`event=schedule`のrun 34740054982 / attempt 1は2026-09-13 14:20:26 JSTに作成され、14:21:16 JSTに成功しました。定義上の09:43 JSTより遅れて実行されたrunです。artifact `shadow-labels-34740054982-1`（ID `10312013722`）から対象#494のJSONとmanifestを取得しました。対象PRなしのrunではありません。

| Job | ID | 開始（UTC） | 終了（UTC） | 結果 |
| --- | --- | --- | --- | --- |
| observe | 103678130055 | 05:20:29 | 05:20:54 | success |
| publish-checks | 103678179753 | 05:20:56 | 05:21:03 | success |
| publish | 103678195140 | 05:21:05 | 05:21:15 | success |

参考用Check `103660586537`は`completed / neutral`で、JSONと同じ判定、head/base、評価器SHA、policy指紋と同run・attemptへのリンクを表示しました。ラベルは`shadow/要対応`でした。公開時点に別途取得したAPI応答で照合しました。公開順序と照合結果は上記の要約に記録しています。記録SHAの評価器によるオフライン再評価も全体一致・終了コード0でした。保存後に専用PR #494をマージせず閉じています。

必須CI2件とfreshnessはpassですが、GitHub総合状態`UNSTABLE`を尊重し`HUMAN_REVIEW_REQUIRED`となりました。同じheadにはキャンセルされたmarker job `103662661162`も残っていました。`UNSTABLE`との因果はこの実測だけでは断定しません。参考用Check自体はneutralです。

## オフライン再評価

保存JSONのobservationsとpolicyを、上表の信頼済みSHAにあるevaluate.pyへ渡しました。ネットワーク取得は行いません。評価器内部のtupleをcollectorと同じJSON配列へ正規化し、レポート全体を比較します。上表の7件と[検証台帳の#480・#487](./autonomous-merge-shadow-validation.md#既存の実測と確認範囲)を合わせた9件すべてで、判定・条件・policy指紋を含むレポート全体が一致しました。socket.connectとsocket.getaddrinfoを拒否した状態で実行し、終了コード0を確認しました。

## 実測とテストの境界

取得中の変化は上記の実測で確認しました。API権限不足、CI再実行開始→完了、必須Check欠落、古い結果の到着、複数PRが同じheadを持つ場合、別attempt・artifact欠落、公開直前の変化などはPythonテストで補っています。日次scheduleは廃止前に上記runで確認しました。2026-09-13の利用者指定により日次実行を廃止しています。Labelsの手動実行は未実測であり、日次schedule経由の成功と区別します。

fork PRの実表示は未実測ですが、2026-09-13の利用者指定により、今回の検証対象・完了条件から外します。外部協力者の信頼性はShadowの条件判定とは別に判断し、fork経由のPRは原則として自動マージしない方針です。対象外としたケースを実測成功として数えません。
