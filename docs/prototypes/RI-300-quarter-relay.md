# RI-300 四半期引き継ぎリレー

対象: [#696](https://github.com/nimiusrd/devops-tycoon/issues/696)。採否: **再試作**。四半期境界一回・固定二期の専用書出し/取込みAPIを試作する。本番統合、受渡しUI、人間のプレイ評価は未実施。Issueはopenを維持する。試作マージは本番採用・Issue完了と区別する。

## 仮説と既存ルール

前任者の投資・負債・余力を読み取り、自分の出荷を増やすか会社を健全にするかを判断できる、という仮説。受領者が既存施策を尊重するか移行費を払って変えるか、その判断が伝わることが評価対象になる。今回、新たな移行費や架空の維持費は導入しない。既存カード・介入・目標修正の利益と代償だけを使う。

通常の途中セーブ共有は `runSaveShare.ts`、保存先と所有権は `runPersistence.ts` / `GameHandle` が管理する。#531・#532は確認時点でclosed。本試作はそれらの書込み・削除・通知・世代所有権へ接続しない。通常の `importRunSaveText` に専用形式を渡しても拒否される。

現行はQ1達成レビューを承認すると勝利終端になる。勝利を解除して二期に伸ばさない。Q1を実際にプレイして `missed_adjustable` に到達したセーブを複製し、実 `chooseGoalAdjustment` を一回実行した直後だけを書き出す。勝利種別は通常の自動判定を維持する。Q1の途中敗北・達成・継続不能はリレー対象外。

## 境界・担当履歴・分岐

`exportQuarterRelay(rawReviewSave, { participant, memo, adjustment })` は元セーブを変更せず、新規 `RunEngine` にhydrateして修正を選ぶ。書出しはQ2 `setup` / `quarterNumber=2` / `sprintIndexInQuarter=0` / `sprintsPlayed=6` / `quarterReview=null`、スプリント・結果・ビート・ドラフト・ショップが空の直後状態だけ。修正前はQ1 `quarterReview` / index=6 / played=6 / 未達 / 修正履歴なしに限定する。二度目の受渡し入口は作らない。

ファイルは修正直前の `before` と直後の `boundary` の実 `RunSave` を保持する。両方を既存 `parseRunSaveShare` の版・BALANCE ruleset・構造・hydrate検査に通す。取込み時にも直前セーブのコピーで同じ修正を再実行し、境界全体の永続状態と一致することを確認する。未知/不正形式、非境界、資源・履歴・要約の矛盾、別rulesetは理由付きで拒否する。

`manifest.before/after` へフェーズ、期、index、本数、実 `reviewHistory`、実修正履歴、予算、組織、全チーム、ロスター、デッキ、レリック、進化、信頼、次期目標、物理キャリーオーバーを明示保存する。実 `reviewHistory` は修正の前後とも `['missed_adjustable']` であり、「修正済み」等の架空レビューは挿入しない。

担当者は `assignments: [{ order:1, quarter:1, participant }]` として本人の明示入力を保存する。レビュー履歴から人や担当期を推測しない。`importQuarterRelay(raw, recipient)` は受領のたびにUUID v4の `branchId` を発行し、親ファイルのSHA-256 `parentFingerprint` と `{order:2,quarter:2,participant:recipient}` をreceiptへ記録する。同じファイルの複数受領は親共通の別分岐になる。専用保存からの再開は同じbranchを維持する。

名前・担当申告・UUID・指紋は本人性、Q1の無編集性、一度だけの受領を保証しない。指紋は署名ではなく整合性確認。正当な別セーブや入力列を作り直すことは可能で、対戦の不正防止・同期・合流・受領取消しは未対応。内包する通常セーブを意図的に抽出して別用途で使うことも防がない。専用APIから通常保存/報酬へ渡す経路はない。

## 形式・上限・進行API

形式は `devops-tycoon-quarter-relay` / version 1、再開は `devops-tycoon-quarter-relay-save` / version 1。専用規則 `ri300-one-boundary-two-quarters-v1` と実BALANCE版・指紋を必須とし、別版の移行は行わない。ゲームルールや乱数消費順の変更ではBALANCE版、専用規則変更では試作rulesetを更新して旧ファイルを拒否する。

上限の正本は `RELAY_LIMITS`。ファイル1,048,576文字、再開2,097,152文字、メモ1,000文字、担当名80文字、seed128文字、一般文字列/キー4,096文字、配列2,048件、構造は受渡しfile 80,000要素・23段、再開envelope 100,000要素・24段。受理したfileへreceiptと最大入力列を加えても再開上限へ収まる余白を確保し、短い指数表記の入力も再直列化後の文字数で検査する。スプリント生成の入力タスク数・各チームの行列/炎上各512、チーム16、ロスターメンバー64、baseConfig最大tick3,600、coding slots/focus最大64。セーブ本体はsprintを内包せず、Q2の盤面は実simが生成する。受理入力2,048件、各入力256文字、tickは1,000ms固定。これらは試作の読取/進行制約であり、通常ランの制限変更ではない。

返すセッションは凍結した `act` / `view` / `save` だけ。エンジンは公開しない。`view` は独立したコピーで、通常の `runKind` / `dailyDate` をトップの状態から除き `mode: 'quarter-relay-prototype'` を返す。操作は準備開始、tick、カード発動、現場介入、結果確認、ドラフト選択/スキップ、進化終了、イベント、カード購入/退店、休息heal/repay、採用hire/skipだけ。編成や全社レバー、進化購入、追加の目標修正等の全操作を揃えた完成UIではない。

```ts
const exported = exportQuarterRelay(JSON.stringify(reviewSave), {
  participant: '担当A', memo: '残余資源と次期目標を確認してください。', adjustment: 'cut_scope',
});
if (!exported.ok) throw new Error(exported.reason);
const opened = importQuarterRelay(exported.value, '担当B');
if (!opened.ok) throw new Error(opened.reason);
opened.value.act(JSON.stringify({ sequence: 0, type: 'begin' }));
opened.value.act(JSON.stringify({ sequence: 1, type: 'tick' }));
const resumed = resumeQuarterRelay(opened.value.save());
```

`sequence` は受理入力数と完全一致する次番号だけを受け付ける。未知キー、矛盾した引数、重複・順序違い、誤フェーズ、無効操作、完了後入力を履歴・資源・RNGの無消費で拒否する。上限到達時は保存・閲覧のみ可能。

Q2レビュー到達時、達成/継続不能なら実 `acknowledgeQuarterReview` が通常の勝敗・WinTypeを決める。Q2未達は `status:playing` のレビューのまま `complete:true` とし、Q3へ進めない。途中敗北もその実状態で停止する。二期完了を勝利に読み替えない。結果は常に `rewardEligible:false` / `metaReward:0` / `dailyReward:0`。通常meta/daily/save/replay/storageへの書込みは行わない。

再開JSONには親ファイル、receipt、全受理入力、実状態と内部frameのSHA-256、現在のスプリントRNG位置を保存する。新規エンジンへ境界を複製し、受理入力を再実行して、累算ms・課金台帳も含む内部状態・RNGを照合する。外部の中間sprint frameは直接hydrateしない。

## 比較と再現

`devcontainer exec --workspace-folder . node scripts/ri300-quarter-relay-evaluation.mjs` で `quarter-relay-comparison.json` を再生成する。UUIDだけは毎回変わる。各 `transfers[].runs[].save` は重複する親fileを省いているため、再開時は `{ ...run.save, file: transfer.file }` をJSON化して `resumeQuarterRelay` に渡す。Q1の初期実状態・seed・入力列・レビューセーブ、修正定義と実前後資源、Q2入力列・実測成果・集中力純消費・RNGを保存する。

共通条件はeasy / default / 試練なし / 優先カードなし / 初期予算60。Q1は手札を可能な限り発動、draft先頭、進化購入なし、即時採用/強制敗北を避ける先頭イベント肢、購入なし、休息heal、採用skipの固定方針。Q1のstepは1,000,000ms（実simが終了まで計算）、Q2は1,000ms刻み。Q2は同じ入力規則の「カードのみ」と「さらに可能時pairReview」を比較する。適応的なプレイヤー行動を表さない。

目標修正の一要因比較は既存の `cut_scope` と `quality_pivot`。いずれも即時予算費用0。前者は顧客信頼−15・Delivery目標×0.8。後者は顧客信頼−5・Delivery目標×0.85・Tech Debt許容+15・Incident許容+3、即時出荷評価×0.9・負債−8、次期coding×0.92・incident率×0.75・毎スプリント品質+4/負債−4。次期目標構築の既存減衰・下限も適用する。係数を手書きでsimへ注入せず、比較JSONに実定義を保存する。

| seed末尾 | Q1結果/予算 | 修正 | Q2のみ出荷: カード/併用 | Q2結果: カード/併用 | 最終予算 |
| --- | --- | --- | ---: | --- | ---: |
| 52 | 未達/50 | cut_scope | 6,345 / 5,957 | 未達 / 未達 | 30 / 30 |
| 52 | 未達/50 | quality_pivot | 6,595 / 5,986 | exceeded・happiness / exceeded・happiness | 30 / 30 |
| 53 | 途中敗北/60 | 受渡し不可 | — | — | — |
| 54 | 未達/53 | cut_scope | 5,876 / 5,856 | 未達 / 未達 | 46 / 46 |
| 54 | 未達/53 | quality_pivot | 6,035 / 5,913 | 未達 / 未達 | 46 / 46 |

seedは `ri134-ma2-52`〜`54`。Q1途中敗北のseed53は履歴を補わず対象外として残す。受渡し可能2seed × 修正2 × Q2方針2の8ランは全て実12スプリントを終了。seed52の品質転換だけ通常勝利し、全8ランの通常報酬は0。出荷はQ2の `quarterReview.progress` の実測で、品質転換は過去累計の出荷評価も減衰するため、最終累計からQ1累計を単純に引かない。集中力純消費は成功操作の直前/直後差を積算し、割引・回復も含む。

品質転換が一例で勝利へつながったことは、全局面の優越や本番の面白さを示さない。移行費の新ルール、次の人へ余力を残すQ1戦略の比較、メモの有無による理解の差は未評価。

## 判断・次の終了条件・検証

**再試作**。境界一回の複製、実前後履歴と担当期、分岐、決定論再開、通常保存/報酬隔離はAPIで確認できる。プレイヤー価値の検証には受渡し画面と人間二人のプレイが必要。次はメモ・資源・次期条件・担当期・新しい複製であることを理解できる最小UIを作り、元セーブ上書きを誤認しないこと、前任の投資と負債を読み取れること、Q1/Q2で判断と機会費用が記録されることを終了条件にする。移行費を追加する場合は既存操作との差分と係数感度を別に試作する。

専用worktreeの標準Dev Container、Node v24.16.0を使用。Docker buildxの活動記録書込みがsandboxで拒否されたため、承認済みの昇格経路で標準 `devcontainer up` を再実行した。GH CLI featureの省略・repo設定変更はない。実Q2完走と再生を含む3テストは、共有環境の負荷で既定15秒を超えたため個別timeoutを30秒に設定した。対象unit 32テスト、型チェックを含むbuild、lint、format:checkは全て終了コード0で成功。比較JSONの8ランも親fileを戻して専用APIで再開し、完了状態・予算・累計出荷の一致を確認した。UI/Pixiは変更していないため、無関係なローカルE2E・gallery・全体coverageは追加せず、全体unit/coverageと必須E2EはCIへ委ねる。
