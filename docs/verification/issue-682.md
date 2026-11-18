# #682 緊急対応で鎮火したPRの識別

## 判断と採否

プレイヤーは、集中力とシニアHPを払ってどのPRを鎮火したかを確認し、残る炎上へ次の介入を使うか判断する。

**採用範囲は緊急対応1種の直接処理の識別。** 既存の `InterventionOutcome.ok` と `InterventionEffect.containedTaskId` から、`PR #N を鎮火 → レビュー待ち` と表示する。保持後の履歴も同じIDを残す。通常の緊急鎮火は成功トーン、余裕のある先消しはコンボ切断・消耗を伴う既存の警告トーンを維持する。

自然出荷・期限達成・機能完成の因果は記録されていないため表示しない。#1020のPR分割の粒強調とは別の変更であり、対象選択・盤面強調は追加しない。

失敗は既存の理由表示を使う。成功フラグだけで鎮火IDがない場合、部分的な記録（適用IDや処理件数のみ）、不正ID、別介入のeffectは、鎮火結果を確認できない警告にする。ID 0 は有効な実対象として扱う。

シミュレーション、乱数、資源消費、保存・再開・リプレイ形式には変更がない。既存イベントの表示だけを読むため、ルールセット変更や独立ルール試作は不要。

## 比較条件と得られる情報

| 条件 | 従来 | 今回 |
| --- | --- | --- |
| 同じ `ri34-burn` / Hard / 初回炎上から緊急鎮火の条件まで公開step / 同じ緊急対応 | 1件鎮火と実測消耗 | 実鎮火PRのID、レビュー待ちへの復帰、同じ実測消耗 |
| 同じタスク列（炎上 #7・#42、出荷済み #88）/ 固定乱数0.5 | 鎮火件数のみ | 最も延焼が近い #42 だけを識別。#88の出荷は含めない |
| 先消し | コンボ切断とHP・士気・集中力の消耗 | 同じ代償と実対象ID |
| 実行直前に対象消滅 | 炎上なし | 同じ失敗理由。成功や対象IDを補わない |

表示領域は既存の `EventTicker` / `SprintEventView`、クラス、semantic tone、2.5秒の保持を再利用する。CSS・token・Pixiは変更しない。連続介入は最新のnonceへ更新し、新しい点火・延焼・自動鎮火・コンボ切断の優先順位は#536のまま。

## 検証と残評価

対象はスプリント内ティッカーの緊急鎮火・先消し・失敗・記録欠落・連続介入・重要障害。HTML要約と実WebGL盤面を組み合わせ、320×568、390×844、768×1024、1024×768、1440×900を通常／reduced motionで検証する。読み上げは既存のpolite statusを使い、折り畳み／展開中とも対象結果のlive regionが1つであることを確認する。

2026-11-18、専用Dev Container（Node 24.16.0 / Chromium 158.0.8127.18）で以下を確認し、すべて終了コード0。

- `npm run lint`、`npm run format:check`、`npm run build`（型チェックを含む）。最終編集したファイルにも個別のESLint・Prettier確認を実施。
- `npm test -- tests/unit/render/sprintInterventionFeedback.test.ts tests/unit/render/sprintEventView.test.ts tests/unit/render/sprintEventViewCoverage.test.ts --maxWorkers=1`：3ファイル69件成功。
- `npm run test:e2e -- tests/e2e/firefight-feedback.spec.ts --workers=1 --max-failures=1`：11件成功。5 viewport × 通常／reduced motionの10画像を目視し、対象・直接結果・消耗が切れないことを確認。全条件でPR #1を鎮火、シニアHP -2、集中力 -1、出荷差分0。
- `npm run test:e2e -- tests/e2e/intervention-panel.spec.ts tests/e2e/sprint-layout.spec.ts --grep '通常スプリントの5 viewport|介入オーラとHTML|12件以上のReview Hell|連続する成功|結果保持中でも|touchとreduced' --workers=1`：7件成功。5 viewportの通常・Review Hell・介入オーラ、連続成功／失敗の保持、点火／延焼の優先、touch＋reduced motionを確認。

上記はすべて `devcontainer exec --workspace-folder .` 経由。E2Eには `--remote-env PLAYWRIGHT_HOST=127.0.0.1 --remote-env PLAYWRIGHT_PORT=5232` を指定。全体カバレッジの重複測定は行わない。変更はスプリントのHTMLティッカーだけのため、Pixi視覚回帰の更新・複数画面galleryは対象外。画像は `evidence/issue-682/firefight/` に保存（gitignored）。

初回E2Eは盤面の起動待ちで失敗し、2 workersから1 workerへ下げても5秒では足りなかった。共通fixtureの盤面待ちを既存のPixiテストと同じ30秒に揃えて解消した。追加テストで見つかった100ms先への時計停止の競合は、#536と同じ固定時計に修正。集中力消費の固定値期待も実測差分への照合に修正し、上記の全11ケースを再実行して成功した。これらはゲーム側の挙動や待ち時間を変更しない。

人間による比較プレイは未実施。対象を追いやすくなったか、2.5秒で対象と代償を読めるか、連続介入時に次の判断へつながるかは未評価であり、自動検証を面白さ・理解度の証明とは扱わない。次は同じseedと資源制約で従来表示と比較し、読取時間・対象の正答・次の介入判断を記録する。この残評価のためIssueはopenを維持する。
