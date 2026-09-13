# Shadow実測詳細（Issue #479）

2026-09-13にActionsのGITHUB_TOKENで収集しました。実行成功とShadowの判定は別々に確認します。本文のSHA・policy・条件は保存JSONから転記しています。

導入状態と未実測項目は[検証台帳](./autonomous-merge-shadow-validation.md)、操作方法は[利用ガイド](./autonomous-merge-shadow-mode.md)を参照してください。

保存ディレクトリは対象PRの抜粋です。manifestは元run全体の対象一覧なので、ここに保存していない他PRが含まれる場合があります。抜粋ディレクトリをpublisherの入力として使わないでください。JSONは内容を変えずPrettierで整形しています。

## nimiusrd/devops-tycoon

| 評価器SHA | Policy SHA-256 |
| --- | --- |
| `0b67f39251b9753f2cf7400d9996dd7688642ba8` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `0d8f67cebfefde2310afd92d2e43a1affeace31a` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `c6018ddfe554454df08fbc9b0f4465b562fed8bc` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |
| `ce102648b69aed73195823188e761977d529e571` | `a5613e48c2cf63fe8c468b3abb09a484fc12adc1429025596df6e6bda91efd85` |

| ケース / 期待 | 実行 / 保存JSON | 観測結果・理由 |
| --- | --- | --- |
| 導入前のCI実行中 / CI条件はwaiting。CI定義変更は人間確認 | [run 34731536809 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34731536809/attempts/1)、[pr-493.json](./shadow-observations/devops-tycoon/34731536809-1/pr-493.json) | `HUMAN_REVIEW_REQUIRED`。unchanged_ci_definitions=blocked（['.github/workflows/autonomous-merge-checks.yml', '.github/workflows/autonomous-merge-labels.yml', '.github/workflows/autonomous-merge-shadow.yml']）; required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=waiting（BLOCKED） |
| 専用PRのCI実行中 / CI条件はwaiting。GitHub総合状態も尊重 | [run 34733205454 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733205454/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34733205454-1/pr-494.json) | `HUMAN_REVIEW_REQUIRED`。required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=blocked（UNSTABLE） |
| 未解決スレッド・取得中のCI完了 / 未解決件数1を記録。取得中の変化は情報不足 | [run 34733401829 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733401829/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34733401829-1/pr-494.json) | `INSUFFICIENT_DATA`。freshness=unknown（PR, CI or reviews changed between samples; recollect）; review_threads=blocked（1）; required_check:Lint & Unit (Vitest)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; github_merge_state=blocked（UNSTABLE） |
| CI完了経由・PR再取得の変化 / CIが成功していても再取得でPRが変わればINSUFFICIENT_DATA | [run 34733942476 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34733942476/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34733942476-1/pr-494.json) | `INSUFFICIENT_DATA`。freshness=unknown（PR, CI or reviews changed between samples; recollect） |
| 新head/base・スレッド解決・CI完了後の再観測 / SHADOW_CONDITIONS_MET、未解決件数0 | [run 34734081199 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34734081199/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34734081199-1/pr-494.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| 専用PR終了 / open_pr=blocked、CLOSEDを過去の観測として表示 | [run 34734163954 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34734163954/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34734163954-1/pr-494.json) | `HUMAN_REVIEW_REQUIRED`。open_pr=blocked（CLOSED）; github_merge_state=blocked（UNSTABLE） |
| 日次schedule / CI条件はpass。GitHub総合状態を尊重し、観測→Check→ラベルを公開 | [run 34740054982 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34740054982/attempts/1)、[pr-494.json](./shadow-observations/devops-tycoon/34740054982-1/pr-494.json) | `HUMAN_REVIEW_REQUIRED`。github_merge_state=blocked（UNSTABLE）。その他の条件はpass。3 job成功、neutral Checkとshadow/要対応ラベルを確認 |

| Run | PR | 観測時刻 | head SHA | base SHA |
| --- | --- | --- | --- | --- |
| 34731536809 / 1 | #493 | `2026-09-13T01:50:52.293635+00:00` | `6b0a1540f048f308fbbd947de4eba1a15ffedc12` | `ce102648b69aed73195823188e761977d529e571` |
| 34733205454 / 1 | #494 | `2026-09-13T02:30:25.281739+00:00` | `13c6a502421b0a05d113e2a3a5223ea21261439b` | `0b67f39251b9753f2cf7400d9996dd7688642ba8` |
| 34733401829 / 1 | #494 | `2026-09-13T02:35:10.268197+00:00` | `13c6a502421b0a05d113e2a3a5223ea21261439b` | `0b67f39251b9753f2cf7400d9996dd7688642ba8` |
| 34733942476 / 1 | #494 | `2026-09-13T02:48:33.906646+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34734081199 / 1 | #494 | `2026-09-13T02:51:59.148873+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34734163954 / 1 | #494 | `2026-09-13T02:54:04.086801+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |
| 34740054982 / 1 | #494 | `2026-09-13T05:20:39.595173+00:00` | `f303d32259e222416ba838624d362e83b3043a73` | `b77b0528e4de4bdcbd27f61e8241675b46efc2f7` |

## nimiusrd/nimius-player

| 評価器SHA | Policy SHA-256 |
| --- | --- |
| `48f7c394e8db39b853f887387624097c8c5f648b` | `76fec5b30fc6c20b025231a5597ebc3564faa2264d9199453af9b907aaec01b9` |
| `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` | `76fec5b30fc6c20b025231a5597ebc3564faa2264d9199453af9b907aaec01b9` |
| `7c18fc579a2ae7eb8851f4c0c13509ab2548f0e9` | `76fec5b30fc6c20b025231a5597ebc3564faa2264d9199453af9b907aaec01b9` |

| ケース / 期待 | 実行 / 保存JSON | 観測結果・理由 |
| --- | --- | --- |
| 専用PRのCI実行中 / CI条件はwaiting。GitHub総合状態も尊重 | [run 34731698963 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34731698963/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34731698963-1/pr-225.json) | `HUMAN_REVIEW_REQUIRED`。required_check:Unit tests (coverage)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; required_check:Windows compile check=waiting（in_progress）; required_check:tauri-rust=waiting（in_progress）; required_check:css=waiting（missing）; github_merge_state=blocked（UNSTABLE） |
| 6件成功・CSS未起動 / WAITING（cssの必須Check欠落） | [run 34731815139 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34731815139/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34731815139-1/pr-225.json) | `WAITING`。required_check:css=waiting（missing） |
| コメントレビュー・未解決スレッド / HUMAN_REVIEW_REQUIRED（未解決件数1） | [run 34731964723 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34731964723/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34731964723-1/pr-225.json) | `HUMAN_REVIEW_REQUIRED`。review_threads=blocked（1）; required_check:css=waiting（missing） |
| スレッド解決 / WAITING（未解決件数0、css欠落） | [run 34732127960 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732127960/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732127960-1/pr-225.json) | `WAITING`。required_check:css=waiting（missing） |
| 新head・取得中のCI完了 / 取得中に変化したらINSUFFICIENT_DATA | [run 34732228918 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732228918/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732228918-1/pr-225.json) | `INSUFFICIENT_DATA`。freshness=unknown（PR, CI or reviews changed between samples; recollect）; required_check:Lint & format=waiting（in_progress）; required_check:Unit tests (coverage)=waiting（in_progress）; required_check:E2E (Playwright)=waiting（in_progress）; required_check:Windows compile check=waiting（in_progress）; required_check:tauri-rust=waiting（in_progress）; github_merge_state=blocked（UNSTABLE） |
| 7件成功 / SHADOW_CONDITIONS_MET | [run 34732406682 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732406682/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732406682-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| CI再実行の完了 / SHADOW_CONDITIONS_MET（新しいCIのIDを採用） | [run 34732617034 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732617034/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732617034-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| base変更後・メタデータ移行 / 新baseを観測し、全条件passならSHADOW_CONDITIONS_MET | [run 34732779391 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732779391/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732779391-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| Labels初回実測 / 観測→Check公開→ラベル更新。公開の成否は判定と別に確認 | [run 34732839373 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732839373/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732839373-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| PR終了 / open_prはblocked（CLOSED）。過去の記録として公開 | [run 34732896011 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34732896011/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34732896011-1/pr-225.json) | `HUMAN_REVIEW_REQUIRED`。open_pr=blocked（CLOSED）; github_merge_state=blocked（UNSTABLE） |
| Labels権限修正後 / 観測→Check公開→ラベル更新が成功 | [run 34733314996 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34733314996/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34733314996-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |
| 再開後・Check本文の導線 / 既存Checkを含んでも鮮度pass。本文リンクから同じrunとartifactへ到達 | [run 34733372023 / attempt 1](https://github.com/nimiusrd/nimius-player/actions/runs/34733372023/attempts/1)、[pr-225.json](./shadow-observations/nimius-player/34733372023-1/pr-225.json) | `SHADOW_CONDITIONS_MET`。全条件pass |

| Run | PR | 観測時刻 | head SHA | base SHA |
| --- | --- | --- | --- | --- |
| 34731698963 / 1 | #225 | `2026-09-13T01:54:54.537728+00:00` | `02ec5d6c4f6f79601b138d5151a65e263f32ddea` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34731815139 / 1 | #225 | `2026-09-13T01:57:35.490580+00:00` | `02ec5d6c4f6f79601b138d5151a65e263f32ddea` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34731964723 / 1 | #225 | `2026-09-13T02:01:02.848123+00:00` | `02ec5d6c4f6f79601b138d5151a65e263f32ddea` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34732127960 / 1 | #225 | `2026-09-13T02:04:53.210715+00:00` | `02ec5d6c4f6f79601b138d5151a65e263f32ddea` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34732228918 / 1 | #225 | `2026-09-13T02:07:12.226555+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34732406682 / 1 | #225 | `2026-09-13T02:11:14.105470+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34732617034 / 1 | #225 | `2026-09-13T02:16:25.443905+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `73626f145b5faa3c6ce47ac45aad4fe9ad88998d` |
| 34732779391 / 1 | #225 | `2026-09-13T02:20:15.593257+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `9af0a27903f5ef9878fc27df682e1ccbcc013cb6` |
| 34732839373 / 1 | #225 | `2026-09-13T02:21:32.577260+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `9af0a27903f5ef9878fc27df682e1ccbcc013cb6` |
| 34732896011 / 1 | #225 | `2026-09-13T02:22:51.960419+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `9af0a27903f5ef9878fc27df682e1ccbcc013cb6` |
| 34733314996 / 1 | #225 | `2026-09-13T02:32:58.661187+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `9af0a27903f5ef9878fc27df682e1ccbcc013cb6` |
| 34733372023 / 1 | #225 | `2026-09-13T02:34:26.639564+00:00` | `f9a19ba9ee087bfba034a96aa23537aa12718368` | `9af0a27903f5ef9878fc27df682e1ccbcc013cb6` |

## Checkの実表示・再実行・公開順序

- nimius-player #225の初期head `02ec5d6c4f6f79601b138d5151a65e263f32ddea`ではCheck ID `103655440199`、更新後head `f9a19ba9ee087bfba034a96aa23537aa12718368`では`103656952944`を確認しました。旧headのCheckは履歴として残り、新headへ判定を移していません。
- [CI run 34732205107 / attempt 2](https://github.com/nimiusrd/nimius-player/actions/runs/34732205107/attempts/2)の開始で、参考用Checkが条件達成から未観測に変わりました。[API記録](./shadow-observations/nimius-player/rerun-check.json)。PR画面でもUnit testsの実行中と未観測を同時に確認しました。完了後のShadow runは34732617034です。
- baseを`codex/shadow-validation-base-479-v2`へ変更すると、同じheadのCheckが未観測になりました。[API記録](./shadow-observations/nimius-player/base-change-check.json)。観測後は新baseを表示しています。
- 旧`shadow-v1`形式のCheck IDを維持したまま`shadow-v2`へ移行しました。[API記録](./shadow-observations/nimius-player/migrated-check.json)。
- Check本文の「このrun・attemptのSummaryとArtifacts」からrun 34733372023 / attempt 1へ移動し、SHADOW_CONDITIONS_METのSummaryとartifact `shadow-observations-34733372023-1`（ID 10309958749）のリンクを画面で確認しました。本文のリンクが指すrunは更新ごとに変わります。
- CI完了経由のobserveはdefault branchに紐づきます。PR終了経由のrun 34732896011はPR headに紐づき、次の観測JSONにはobserve job自体も含まれました。両経路とも参考用CheckはPR headに表示されます。
- 参考用Check自身も収集対象に含まれています。本文を更新した後の再観測でもfreshnessはpassになりました。CI完了と収集が重なった34732228918 / 34733401829では、実際に変わったCIのID・status・conclusionをobservation_changesへ残し、終了コード1で情報不足を報告しました。
- Labels初回はobserveとpublish-checksが成功した後、publishがHTTP 403で失敗しました。[job記録](./shadow-observations/nimius-player/labels-jobs.json)。Issues: write / PullRequests: readだったラベルpublisherへPR書込権限を付け、再実行では3 jobが成功し、`shadow/要マージ判断`が付与されました。[再検証記録](./shadow-observations/nimius-player/labels-retest-jobs.json)。[jobの開始・終了時刻](./shadow-observations/nimius-player/labels-job-times.json)でもCheck公開完了後にラベルpublisherが開始したことを確認しました。観測JSONの判定が条件達成でも、初回のラベル公開成功とは扱いません。

## devops-tycoonの日次schedule

`event=schedule`のrun 34740054982 / attempt 1は2026-09-13 14:20:26 JSTに作成され、14:21:16 JSTに成功しました。定義上の09:43 JSTより遅れて実行されたrunです。artifact `shadow-labels-34740054982-1`（ID `10312013722`）から対象#494のJSONとmanifestを取得しました。対象PRなしのrunではありません。

| Job | ID | 開始（UTC） | 終了（UTC） | 結果 |
| --- | --- | --- | --- | --- |
| observe | 103678130055 | 05:20:29 | 05:20:54 | success |
| publish-checks | 103678179753 | 05:20:56 | 05:21:03 | success |
| publish | 103678195140 | 05:21:05 | 05:21:15 | success |

参考用Check `103660586537`は`completed / neutral`で、JSONと同じ判定、head/base、評価器SHA、policy指紋と同run・attemptへのリンクを表示しました。ラベルは`shadow/要対応`でした。[公開時点のAPI記録](./shadow-observations/devops-tycoon/34740054982-1/publication.json)と[照合結果](./shadow-observations/devops-tycoon/34740054982-1/verification.json)を保存しています。記録SHAの評価器によるオフライン再評価も全体一致・終了コード0でした。保存後に専用PR #494をマージせず閉じています。

必須CI2件とfreshnessはpassですが、GitHub総合状態`UNSTABLE`を尊重し`HUMAN_REVIEW_REQUIRED`となりました。同じheadにはキャンセルされたmarker job `103662661162`も残っていました。`UNSTABLE`との因果はこの実測だけでは断定しません。参考用Check自体はneutralです。

## オフライン再評価

保存JSONのobservationsとpolicyを、上表の信頼済みSHAにあるevaluate.pyへ渡しました。ネットワーク取得は行いません。評価器内部のtupleをcollectorと同じJSON配列へ正規化し、レポート全体を比較します。[devops-tycoonの再評価結果](./shadow-observations/devops-tycoon/replay-results.json)と[nimius-playerの再評価結果](./shadow-observations/nimius-player/replay-results.json)へ結果を保存します。socket.connectとsocket.getaddrinfoを拒否した状態で実行し、終了コード0を確認しました。

## 実測とテストの境界

API権限不足・取得中の変化は上記の実測でも確認しました。古い結果の到着、複数PRが同じheadを持つ場合、別attempt・artifact欠落、公開直前の変化などはPythonテストで補っています。devops-tycoonの日次scheduleは上記runで確認済みです。残る実測はnimius-playerのscheduleイベントによる日次実行です。手動Labelsの成功を日次scheduleの成功として数えません。

fork PRの実表示は未実測ですが、2026-09-13の利用者指定により、今回の検証対象・完了条件から外します。外部協力者の信頼性はShadowの条件判定とは別に判断し、fork経由のPRは原則として自動マージしない方針です。対象外としたケースを実測成功として数えません。
